"""
Recorrido de extremo a extremo de los plazos de pago y del módulo de obligaciones.
Usa el navegador de verdad contra la aplicación construida.

    python3 tests/e2e-obligaciones.py
"""
import os, re, subprocess, sys, time
from datetime import date, timedelta
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")

DB = os.environ.get("E2E_DB", "epp")


def psql(q):
    """Una consulta de lectura contra la base de la prueba."""
    return subprocess.check_output(["su", "postgres", "-c", f'psql -d {DB} -tAc "{q}"']).decode().strip()


def ejecutar(q):
    subprocess.run(["su", "postgres", "-c", f'psql -q -d {DB} -c "{q}"'], check=True, stdout=subprocess.DEVNULL)


def limpiar():
    """Borra lo que dejaron corridas anteriores de esta misma prueba, y solo eso."""
    for q in [
        "delete from obligations where name like 'Préstamo BCP capital de trabajo %' or name like 'Claro flota %'",
        # Las cocheras, seguros y líneas de la prueba de tipos y segmentación: solo las que
        # llevan el sello de seis dígitos que pone esta prueba, nunca una de verdad.
        r"""delete from obligations where name ~ '^(Cochera|Seguro|Linea|Mal tipeada) [0-9]{6}'""",
        "delete from supplier_invoices where supplier_id in (select id from suppliers where business_name like 'AUTOESPAR PRUEBA %')",
        "delete from suppliers where business_name like 'AUTOESPAR PRUEBA %'",
    ]:
        subprocess.run(["su", "postgres", "-c", f'psql -q -d {DB} -c "{q}"'], check=True, stdout=subprocess.DEVNULL)


fails = []
def check(nombre, cond, extra=""):
    if cond:
        print("OK   ", nombre)
    else:
        fails.append(nombre)
        print("FALLA", nombre, extra)

# Cada corrida usa números y nombres propios: así la prueba se puede repetir sin
# tropezar con lo que dejó la anterior, que es lo que pasaría con un número fijo.
SELLO = str(int(time.time()))[-6:]
N_CREDITO = f"9{SELLO[:4]}"
N_CONTADO = f"8{SELLO[:4]}"
PRESTAMO = f"Préstamo BCP capital de trabajo {SELLO}"
SERVICIO = f"Claro flota {SELLO}"
# RUC propio de cada corrida: con uno fijo, la segunda vez el alta fallaría por duplicado.
RUC = "20" + SELLO.rjust(9, "1")[:9]

def fecha(page, campo, iso):
    """Escribe una fecha en el campo visible, que ahora va en día/mes/año."""
    a, m, d = iso.split("-")
    page.fill(f"input#{campo}", f"{d}/{m}/{a}")
    page.wait_for_timeout(120)


def proveedor_opcion(page):
    """La opción del desplegable que corresponde al proveedor de esta corrida."""
    return [o for o in page.locator("select[name=supplierId] option").all_inner_texts() if SELLO in o][0]


def enviar(page, etiqueta, timeout=15000):
    """Pulsa un botón de formulario y espera a que el modal se cierre de verdad.

    Con una espera fija se cae en una carrera: el aviso emergente aparece antes de que la
    página se recargue, así que una comprobación inmediata podría leer la pantalla vieja.
    """
    page.click(f"button:has-text('{etiqueta}')")
    page.wait_for_selector("div.fixed.inset-0.z-50", state="detached", timeout=timeout)
    page.wait_for_timeout(600)


CRONOGRAMA_BCP = """160225 250,000.00 8,699.63 3,339.62 232.50 0.00 0.00 12,271.75
160325 241,300.38 9,266.24 2,802.82 202.69 0.00 0.00 12,271.75
160425 232,034.14 9,072.00 2,983.95 215.79 0.00 0.00 12,271.75
160525 222,962.14 9,296.29 2,774.79 200.67 0.00 0.00 12,271.75"""


def main():
    limpiar()
    hoy = date.today()
    with sync_playwright() as p:
        nav = p.chromium.launch()
        page = nav.new_page()
        errores_consola = []
        # Con la URL al lado: un error suelto al final de un recorrido largo no dice en qué
        # pantalla saltó, y sin eso hay que volver a correr toda la prueba para encontrarlo.
        page.on("pageerror", lambda e: errores_consola.append(f"{page.url} → {e}"))

        # --- Entrar ---
        page.goto(f"{BASE}/login")
        page.fill("input[name=identifier]", USER)
        page.fill("input[name=password]", PASS)
        page.click("button[type=submit]")
        page.wait_for_url(re.compile(r"/(dashboard|facturas)"), timeout=15000)
        check("inicia sesión", "/login" not in page.url, page.url)

        # --- El menú trae las secciones nuevas ---
        page.goto(f"{BASE}/dashboard")
        check("el menú muestra Préstamos y servicios", page.locator("a[href='/obligaciones']").first.is_visible())
        check("el menú muestra el calendario de pagos", page.locator("a[href='/calendario']").first.is_visible())
        check("el dashboard ya no habla de viernes", "viernes" not in page.content().lower())

        # --- Proveedor con condición a crédito ---
        page.goto(f"{BASE}/proveedores")
        page.click("text=Nuevo proveedor")
        page.fill("input[name=ruc]", RUC)
        page.fill("input[name=businessName]", f"AUTOESPAR PRUEBA {SELLO}")
        page.select_option("select[name=defaultPaymentTerm]", "CREDITO")
        check("al elegir crédito el plazo pasa a 7 días",
              page.input_value("input[name=defaultTermDays]") == "7",
              page.input_value("input[name=defaultTermDays]"))
        enviar(page, "Registrar proveedor")
        check("el proveedor queda registrado", RUC in page.content())

        # --- Factura a crédito: sin guía no tiene fecha de pago ---
        page.goto(f"{BASE}/facturas")
        check("la columna dice Vence y no Viernes de pago",
              "Vence" in page.content() and "Viernes de pago" not in page.content())

        page.click("text=Nueva factura")
        page.select_option("select[name=supplierId]", label=proveedor_opcion(page))
        page.wait_for_timeout(300)
        check("el proveedor propone su condición pactada",
              page.locator("select[name=paymentTerm]").input_value() == "CREDITO",
              page.locator("select[name=paymentTerm]").input_value())
        check("el formulario avisa que falta la guía",
              "entregue la guía en físico" in page.content())

        page.fill("input[name=series]", "F049")
        page.fill("input[name=number]", N_CREDITO)
        fecha(page, "issueDate", hoy.isoformat())
        fecha(page, "receivedDate", hoy.isoformat())
        page.fill("input[name=subtotal]", "753.35")
        page.wait_for_timeout(200)
        check("el IGV se calcula solo",
              page.input_value("input[name=igv]") == "135.60",
              page.input_value("input[name=igv]"))
        page.fill("input[name=total]", "888.95")
        enviar(page, "Registrar factura")
        check("la factura a crédito queda registrada", f"F049-{N_CREDITO}" in page.content())
        check("aparece esperando la guía", "Esperando la guía" in page.content(), page.content()[:0])

        # --- Anotar la guía arranca el plazo ---
        page.click(f"a:has-text('F049-{N_CREDITO}')")
        page.wait_for_timeout(1200)
        check("la ficha explica que el plazo no ha empezado",
              "empieza a correr recién cuando el proveedor entregue la guía" in page.content())
        page.click("button:has-text('Anotar guía')")
        entrega = hoy.isoformat()
        fecha(page, "guideReceivedAt", entrega)
        enviar(page, "Guardar")
        # El aviso emergente ya trae la fecha, así que leer el contenido de inmediato podría
        # dar por buena la página vieja. Se espera a que el botón desaparezca: eso solo pasa
        # cuando la página ya se recargó con la guía anotada.
        cuerpo = page.locator("main, body").first
        esperado = (hoy + timedelta(days=7)).strftime("%d/%m/%Y")
        check("tras anotar la guía vence en 7 días", esperado in cuerpo.inner_text(), esperado)
        check("ya no dice que espera la guía", "Esperando la guía" not in cuerpo.inner_text())

        # --- Factura al contado: vence al día siguiente ---
        page.goto(f"{BASE}/facturas")
        page.click("text=Nueva factura")
        page.select_option("select[name=supplierId]", label=proveedor_opcion(page))
        page.wait_for_timeout(200)
        page.select_option("select[name=paymentTerm]", "CONTADO")
        page.wait_for_timeout(200)
        check("al contado el plazo pasa a 1 día",
              page.input_value("input[name=termDays]") == "1")
        manana = (hoy + timedelta(days=1)).strftime("%d/%m/%Y")
        check("el formulario ya anuncia la fecha límite", manana in page.content(), manana)
        page.fill("input[name=series]", "F049")
        page.fill("input[name=number]", N_CONTADO)
        fecha(page, "issueDate", hoy.isoformat())
        page.fill("input[name=total]", "500.00")
        enviar(page, "Registrar factura")
        check("la factura al contado queda registrada", f"F049-{N_CONTADO}" in page.content())

        # --- Préstamo con el cronograma del BCP ---
        page.goto(f"{BASE}/obligaciones")
        page.click("text=Nueva obligación")
        page.select_option("select[name=type]", "PRESTAMO")
        page.fill("input[name=name]", PRESTAMO)
        page.fill("input[name=creditor]", "BCP")
        page.fill("input[name=reference]", "100-191-0000-30000006902184")
        page.fill("input[name=principal]", "250000.00")
        page.fill("input[name=annualRate]", "16.00")
        fecha(page, "disbursedAt", "2025-01-16")
        enviar(page, "Registrar")
        check("el préstamo queda registrado", PRESTAMO in page.content())
        check("avisa que falta el cronograma", "no tiene cronograma" in page.content() or "Sin cronograma" in page.content())

        page.click(f"a:has-text('{PRESTAMO}')")
        page.wait_for_timeout(1200)
        page.click("button:has-text('Cargar cronograma')")
        page.fill("#pegado", CRONOGRAMA_BCP)
        page.wait_for_timeout(600)
        contenido = page.content()
        check("reconoce las 4 cuotas pegadas", "4 cuotas" in contenido, contenido[:0])
        check("toma la cuota y no el saldo", "12,271.75" in contenido or "12271.75" in contenido)
        check("no confunde el saldo con la cuota", "250,000.00" not in contenido.split("Total a pagar")[-1][:200])
        enviar(page, "Guardar 4 cuotas")
        check("el cronograma queda guardado", "0 de 4 cuotas pagadas" in page.content(), page.content()[:0])

        # --- Pagar una cuota ---
        page.locator("button:has-text('Pagar')").first.click()
        page.wait_for_timeout(600)
        fecha(page, "paidAt", hoy.isoformat())
        enviar(page, "Confirmar pago")
        check("la cuota queda pagada", "1 de 4 cuotas pagadas" in page.content(), page.content()[:0])
        # El BCP imprime el saldo ANTES de la cuota; tras pagar la primera, lo que queda
        # debido es 250,000 − 8,699.63. Si se guardara el saldo tal cual, la ficha diría que
        # aún se deben los 250,000 completos después de haber pagado.
        check("el saldo de capital descuenta la cuota pagada",
              "241,300.37" in page.content(), page.content()[:0])
        check("no muestra el capital entero tras pagar", "S/ 250,000.00" not in page.inner_text("aside"))

        # --- Servicio de monto variable ---
        page.goto(f"{BASE}/obligaciones")
        page.click("text=Nueva obligación")
        page.select_option("select[name=type]", "SERVICIO")
        page.fill("input[name=name]", SERVICIO)
        page.fill("input[name=creditor]", "Claro")
        page.fill("input[name=billingDay]", "15")
        enviar(page, "Registrar")
        check("el servicio genera sus vencimientos solo", SERVICIO in page.content())

        page.click(f"a:has-text('{SERVICIO}')")
        page.wait_for_timeout(1200)
        check("las cuotas del servicio esperan el recibo", "falta el recibo" in page.content())
        page.locator("button:has-text('Importe')").first.click()
        page.wait_for_timeout(600)
        page.fill("input[name=total]", "382.50")
        enviar(page, "Guardar importe")
        check("el importe del recibo queda anotado", "382.50" in page.content())

        # --- Servicio que arranca en una fecha concreta ---
        # Antes el calendario siempre empezaba este mes: un servicio que arranca el mes que
        # viene, o uno que viene atrasado, no se podía registrar tal cual.
        from datetime import date as _date
        arranque = "2027-03-20"
        page.goto(f"{BASE}/obligaciones")
        page.click("text=Nueva obligación")
        page.select_option("select[name=type]", "ALQUILER")
        page.fill("input[name=name]", f"{SERVICIO} local")
        page.fill("input[name=creditor]", "Arrendador")
        page.locator("input#firstDueDate").fill("20/03/2027")
        page.wait_for_timeout(400)
        check("el día de pago sale solo de la fecha",
              page.input_value("input[name=billingDay]") == "20",
              page.input_value("input[name=billingDay]"))
        page.locator("label:has-text('El importe cambia cada mes') input[type=checkbox]").uncheck()
        page.wait_for_timeout(300)
        page.fill("input[name=fixedAmount]", "1800")
        enviar(page, "Registrar")

        primera = psql(f"select min(i.due_date)::text from obligation_installments i "
                       f"join obligations o on o.id = i.obligation_id where o.name = '{SERVICIO} local'")
        check("la primera cuota del servicio vence en la fecha indicada", primera == arranque, primera)
        check("y no arranca este mes como antes", primera > _date.today().isoformat())

        # --- Editar la fecha rehace el calendario ---
        # El fallo era este: se guardaba la fecha nueva y los vencimientos seguían donde
        # estaban, así que la pantalla mostraba las fechas viejas.
        page.click(f"a:has-text('{SERVICIO} local')")
        page.wait_for_timeout(1200)
        page.locator("button:has-text('Editar')").first.click()
        page.wait_for_timeout(700)
        page.locator("input#firstDueDate").fill("31/05/2027")
        page.wait_for_timeout(400)
        check("el día de pago acepta el 31", page.input_value("input[name=billingDay]") == "31",
              page.input_value("input[name=billingDay]"))
        enviar(page, "Guardar cambios")

        primera = psql(f"select min(i.due_date)::text from obligation_installments i "
                       f"join obligations o on o.id = i.obligation_id where o.name = '{SERVICIO} local'")
        check("al cambiar la fecha se rehacen los vencimientos", primera == "2027-05-31", primera)
        febrero = psql(f"select count(*) from obligation_installments i "
                       f"join obligations o on o.id = i.obligation_id "
                       f"where o.name = '{SERVICIO} local' and i.due_date = '2028-02-29'")
        check("el día 31 cae en el último día de febrero", febrero == "1", febrero)

        # --- Vigencia ---
        page.locator("button:has-text('Editar')").first.click()
        page.wait_for_timeout(700)
        page.locator("input#endsAt").fill("31/10/2027")
        enviar(page, "Guardar cambios")

        ultima = psql(f"select max(i.due_date)::text from obligation_installments i "
                      f"join obligations o on o.id = i.obligation_id where o.name = '{SERVICIO} local'")
        check("la vigencia corta el calendario", ultima == "2027-10-31", ultima)
        check("la ficha muestra la vigencia", "Vigencia" in page.content())

        page.locator("button:has-text('Editar')").first.click()
        page.wait_for_timeout(700)
        page.locator("input#endsAt").fill("01/01/2027")
        page.locator("div.fixed.inset-0.z-50").locator("button:has-text('Guardar cambios')").last.click()
        page.wait_for_timeout(1500)
        check("no acepta una vigencia anterior a la primera cuota",
              "no puede terminar antes" in page.content(), page.content()[:0])
        page.locator("div.fixed.inset-0.z-50").locator("button:has-text('Cancelar')").last.click()
        page.wait_for_timeout(600)

        # --- Eliminar lo registrado por error ---
        check("un servicio sin pagos ofrece eliminarse",
              page.locator("button:has-text('Eliminar')").count() > 0)
        page.locator("button:has-text('Eliminar')").first.click()
        page.wait_for_timeout(500)
        page.locator("div.fixed.inset-0.z-50").locator("button:has-text('Eliminar')").last.click()
        page.wait_for_timeout(2000)
        check("el servicio desaparece de la base",
              psql(f"select count(*) from obligations where name = '{SERVICIO} local'") == "0")
        check("y se lleva su cronograma",
              psql("select count(*) from obligation_installments i "
                   "left join obligations o on o.id = i.obligation_id where o.id is null") == "0")
        check("queda constancia en auditoría",
              int(psql("select count(*) from audit_logs where module = 'OBLIGACIONES' and action = 'ELIMINAR'")) > 0)

        # --- Con pagos registrados no se borra: se anula ---
        page.goto(f"{BASE}/obligaciones")
        page.click(f"a:has-text('{PRESTAMO}')")
        page.wait_for_timeout(1200)
        check("un préstamo con cuotas pagadas no ofrece eliminar",
              page.locator("button:has-text('Eliminar')").count() == 0)
        check("en su lugar ofrece anular", page.locator("button:has-text('Anular')").count() > 0)

        # --- El listado va partido por tipo ---
        page.goto(f"{BASE}/obligaciones"); page.wait_for_timeout(1500)
        cuerpo = page.content()
        check("hay una tabla de préstamos", "Préstamos</h3>" in cuerpo or ">Préstamos<" in cuerpo, cuerpo[:0])
        check("y otra de servicios", ">Servicios<" in cuerpo)
        check("el plural está bien escrito", "Alquilers" not in cuerpo)
        check("cada tabla dice cuánto falta pagar", "falta pagar" in cuerpo)
        # Las columnas propias de cada tipo: el préstamo muestra capital y tasa, el
        # servicio el día de pago. Antes era una sola tabla con una columna "Tipo".
        prestamos = page.locator("section, div").filter(has_text="Crédito bancario con cronograma").last.inner_text()
        check("la tabla de préstamos muestra capital y TEA", "Capital" in prestamos and "TEA" in prestamos, prestamos[:150])
        check("y cuántas cuotas van pagadas", "Cuotas" in prestamos)
        servicios = page.locator("section, div").filter(has_text="Luz, agua, internet").last.inner_text()
        check("la tabla de servicios muestra el día de pago", "Vence cada mes" in servicios, servicios[:150])
        check("la de servicios no habla de capital ni de TEA", "TEA" not in servicios, servicios[:150])
        check("ya no existe la columna Tipo repetida en cada fila",
              page.locator("th", has_text="Tipo").count() == 0)

        # --- Tipos propios, totales del mes y segmentación por concepto ---
        # Cochera, seguro y línea tienen tipo propio en vez de caer todos en "Servicio",
        # que es lo que pidió la empresa: mezclados con la luz y el internet no se leía
        # cuánto se va en cada cosa. Dentro de un tipo se sigue agrupando por concepto,
        # así que las dos cocheras del mismo concepto van juntas aunque sean placas
        # distintas y se le pague a playas distintas.
        for nombre, entidad, tipo, concepto, importe in [
            (f"Cochera {SELLO} BYH716", "Playa Central", "COCHERA", f"Cochera {SELLO}", 450.00),
            (f"Cochera {SELLO} D4T551", "Estacionamiento Sur", "COCHERA", f"Cochera {SELLO}", 380.00),
            (f"Cochera {SELLO} patio", "Inmobiliaria", "COCHERA", f"Patio {SELLO}", 900.00),
            (f"Seguro {SELLO} BYH716", "Pacifico", "SEGURO", f"Seguro {SELLO}", 620.50),
            (f"Linea {SELLO} 922783263", "Claro", "LINEA", f"Linea {SELLO}", 79.90),
        ]:
            ejecutar("insert into obligations (type, name, creditor, category, currency, billing_day, fixed_amount) "
                     f"values ('{tipo}', '{nombre}', '{entidad}', '{concepto}', 'PEN', 5, {importe})")
            ejecutar("insert into obligation_installments (obligation_id, number, due_date, total) "
                     f"select id, 1, date_trunc('month', current_date) + interval '4 days', {importe} "
                     f"from obligations where name = '{nombre}'")
        page.goto(f"{BASE}/obligaciones"); page.wait_for_timeout(1500)
        cuerpo = page.content()

        check("dice cuánto falta pagar este mes", "Falta pagar este mes" in cuerpo)
        check("y cuánto cuesta el mes completo", "Total del mes, pagado o no" in cuerpo)
        check("explica lo que viene arrastrado", "meses anteriores" in cuerpo)
        check("cada tipo dice su total del mes", "total del mes" in cuerpo)

        # El total del mes no se encoge a medida que se paga: eso es lo que antes no se
        # podía ver, porque el único número que había era el saldo.
        ejecutar("update obligation_installments set status = 'PAGADA', paid_at = current_date, "
                 "paid_amount = total where obligation_id in "
                 f"(select id from obligations where name like '%{SELLO}%') and total is not null")
        page.goto(f"{BASE}/obligaciones"); page.wait_for_timeout(1500)
        pagado = page.content()
        check("pagado todo, el total del mes sigue a la vista",
              "Total del mes, pagado o no" in pagado and "ya pagado" in pagado)
        # Se deshace el pago: lo que sigue mira los saldos pendientes de estas mismas
        # obligaciones, y dejarlas pagadas haría fallar comprobaciones que no tienen
        # nada que ver con esto.
        ejecutar("update obligation_installments set status = 'PENDIENTE', paid_at = null, "
                 "paid_amount = null where obligation_id in "
                 f"(select id from obligations where name like '%{SELLO}%')")
        page.goto(f"{BASE}/obligaciones"); page.wait_for_timeout(1500)
        cuerpo = page.content()

        # Cada tipo nuevo tiene su propia tabla, con su plural bien escrito.
        for plural in ["Cocheras", "Seguros", "Líneas móviles"]:
            check(f"hay una tabla de {plural.lower()}", f">{plural}<" in cuerpo)
        check("las cocheras ya no salen bajo servicios",
              "Cochera" not in page.locator("section, div").filter(has_text="Luz, agua, internet").last.inner_text())

        cocheras = page.locator("section, div").filter(has_text="Estacionamiento de las unidades").last.inner_text()
        # Dos conceptos dentro del tipo: las dos placas de un lado, el patio del otro.
        check("las cocheras se agrupan por concepto", "obligación(es) · este mes" in cocheras, cocheras[:300])
        check("las dos placas caen en un solo bloque",
              re.search(rf"Cochera {SELLO}\s+2 obligación\(es\)", cocheras) is not None, cocheras[:400])
        # 450 + 380 = 830: el total del bloque suma las dos placas.
        check("y el bloque suma las dos placas", "830.00" in cocheras, cocheras[:400])
        check("el patio va en su propio bloque",
              re.search(rf"Patio {SELLO}\s+1 obligación\(es\)", cocheras) is not None, cocheras[:400])

        seguros = page.locator("section, div").filter(has_text="SOAT y pólizas").last.inner_text()
        check("el seguro está en la tabla de seguros", "620.50" in seguros, seguros[:300])
        check("y no en la de cocheras", "620.50" not in cocheras, cocheras[:400])

        # --- El tipo se puede corregir desde la ficha ---
        # Una cochera que se cargó como servicio tiene que poder arreglarse sin anularla.
        ejecutar("insert into obligations (type, name, creditor, currency, billing_day, fixed_amount) "
                 f"values ('SERVICIO', 'Mal tipeada {SELLO}', 'Playa Norte', 'PEN', 5, 200)")
        mal = psql(f"select id from obligations where name = 'Mal tipeada {SELLO}'")
        page.goto(f"{BASE}/obligaciones/{mal}"); page.wait_for_timeout(1000)
        page.get_by_role("button", name="Editar").click(); page.wait_for_timeout(600)
        check("editando se puede cambiar el tipo", not page.locator("select[name=type]").is_disabled())
        check("pero no se ofrece convertirla en préstamo",
              "PRESTAMO" not in page.eval_on_selector_all("select[name=type] option", "o => o.map(x => x.value)"))
        page.select_option("select[name=type]", "COCHERA")
        page.get_by_role("button", name="Guardar cambios").click(); page.wait_for_timeout(2500)
        check("el tipo corregido queda guardado",
              psql(f"select type from obligations where id = '{mal}'") == "COCHERA")

        # El préstamo sí queda bloqueado: su cronograma depende de que lo siga siendo.
        prestamo_id = psql(f"select id from obligations where name = '{PRESTAMO}'")
        page.goto(f"{BASE}/obligaciones/{prestamo_id}"); page.wait_for_timeout(1000)
        page.get_by_role("button", name="Editar").click(); page.wait_for_timeout(600)
        check("un préstamo no deja cambiar de tipo", page.locator("select[name=type]").is_disabled())
        page.keyboard.press("Escape"); page.wait_for_timeout(400)

        # --- Calendario, con forma de calendario ---
        page.goto(f"{BASE}/calendario")
        page.wait_for_timeout(1500)
        cal = page.content()
        columnas = page.eval_on_selector_all("thead th", "e => e.map(x => x.innerText.trim().toUpperCase())")
        check("el calendario tiene los siete días de la semana",
              columnas == ["DOM.", "LUN.", "MAR.", "MIÉ.", "JUE.", "VIE.", "SÁB."], columnas)
        check("y encabeza el mes que se está mirando",
              re.search(r"(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Setiembre|Octubre|Noviembre|Diciembre) de \d{4}", cal) is not None)
        check("marca el día de hoy", page.locator("td.bg-brand-soft").count() >= 1)
        check("el calendario muestra las cuotas de este mes", f"Cochera {SELLO}" in cal, cal[:0])
        # Las facturas de proveedores quedaron fuera a propósito: tienen su propia
        # pantalla, y mezcladas aquí tapaban los compromisos fijos del mes.
        check("y ya no mezcla las facturas de proveedores",
              not re.search(r"\bF0\d{2}-\d+\b", cal), re.findall(r"\bF0\d{2}-\d+\b", cal)[:3])
        check("avisa de lo que viene vencido de antes", "Viene vencido de antes" in cal)

        # Moverse de mes cambia lo que se muestra, no la página.
        mes_actual = page.locator("h2").first.inner_text()
        page.click("a[aria-label='Mes siguiente']"); page.wait_for_timeout(1200)
        check("se puede pasar al mes siguiente",
              page.locator("h2").first.inner_text() != mes_actual and "mes=" in page.url, page.url)
        page.click("a[aria-label='Mes anterior']"); page.wait_for_timeout(1200)
        check("y volver al anterior", page.locator("h2").first.inner_text() == mes_actual)

        # --- Permisos: finanzas ve el módulo, almacén no ---
        check("sin errores de JavaScript en toda la sesión",
              len(errores_consola) == 0, errores_consola[:2])

        nav.close()

    print()
    if fails:
        print(f"{len(fails)} FALLAS:")
        for f in fails:
            print(" -", f)
        sys.exit(1)
    print("E2E OBLIGACIONES: todas las verificaciones superadas")


main()
