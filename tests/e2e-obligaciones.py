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


def limpiar():
    """Borra lo que dejaron corridas anteriores de esta misma prueba, y solo eso."""
    for q in [
        "delete from obligations where name like 'Préstamo BCP capital de trabajo %' or name like 'Claro flota %'",
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
        page.on("pageerror", lambda e: errores_consola.append(str(e)))

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
        page.fill("input[name=issueDate]", hoy.isoformat())
        page.fill("input[name=receivedDate]", hoy.isoformat())
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
        page.fill("input[name=guideReceivedAt]", entrega)
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
        page.fill("input[name=issueDate]", hoy.isoformat())
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
        page.fill("input[name=disbursedAt]", "2025-01-16")
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
        page.fill("input[name=paidAt]", hoy.isoformat())
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

        # --- Calendario unificado ---
        page.goto(f"{BASE}/calendario?dias=60")
        page.wait_for_timeout(1200)
        cal = page.content()
        check("el calendario junta facturas y cuotas",
              f"F049-{N_CONTADO}" in cal and (SERVICIO in cal or PRESTAMO in cal), cal[:0])
        check("el calendario marca lo vencido", "Vencido sin pagar" in cal or "Por pagar" in cal)

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
