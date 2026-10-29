"""
Recorrido de las pantallas nuevas: campo de fecha, resumen de EPP, servicio de transporte,
detracciones y menú por secciones.

    E2E_DB=transjer python3 tests/e2e-detracciones.py
"""
import os, re, subprocess, sys, time
from datetime import date
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
# Sin ceros a la izquierda: el sistema los quita del número de factura y la prueba
# buscaría una etiqueta que no existe.
SELLO = str(int(time.time()))[-6:].lstrip("0").rjust(6, "7")

fails = []
def check(nombre, cond, extra=""):
    if cond:
        print("OK   ", nombre)
    else:
        fails.append(nombre)
        print("FALLA", nombre, extra)

def psql(q):
    return subprocess.check_output(["su", "postgres", "-c", f'psql -d {DB} -tAc "{q}"']).decode().strip()

def ejecutar(q):
    subprocess.run(["su", "postgres", "-c", f'psql -q -d {DB} -c "{q}"'], check=True, stdout=subprocess.DEVNULL)


def limpiar():
    ejecutar(f"delete from supplier_invoices where series='F0{SELLO[:2]}'")
    ejecutar("delete from users where username like 'detra%'")
    ejecutar("delete from obligations where name like 'PRUEBA deuda%'")


def sembrar_obligacion():
    """El resumen de deuda solo aparece si hay algo que deber: se crea una obligación propia."""
    ejecutar(
        "insert into obligations (type, name, creditor, currency, billing_day, fixed_amount) "
        f"values ('SERVICIO', 'PRUEBA deuda {SELLO}', 'Claro', 'PEN', 15, 450.00)")
    ejecutar(
        "insert into obligation_installments (obligation_id, number, due_date, total) "
        f"select id, 1, current_date + 10, 450.00 from obligations where name='PRUEBA deuda {SELLO}'")

def pdf_valido(ruta, kb=12):
    """Un PDF completo y con páginas: lo que el sistema acepta como constancia."""
    cuerpo = (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        b"trailer << /Root 1 0 R >>\n"
    )
    open(ruta, "wb").write(cuerpo + b"% " + b"r" * (kb * 1024) + b"\n%%EOF")
    return ruta


os.makedirs("/tmp/e2e-files", exist_ok=True)
CONSTANCIA = pdf_valido("/tmp/e2e-files/constancia.pdf")


def enviar(page, etiqueta, timeout=15000):
    page.click(f"button:has-text('{etiqueta}')")
    page.wait_for_selector("div.fixed.inset-0.z-50", state="detached", timeout=timeout)
    page.wait_for_timeout(600)


def main():
    limpiar()
    sembrar_obligacion()
    hoy = date.today()
    with sync_playwright() as p:
        nav = p.chromium.launch()
        # Navegador en inglés a propósito: es justo donde el campo de fecha nativo mostraba
        # mm/dd/aaaa y hacía registrar el 10 de marzo cuando se escribía el 3 de octubre.
        ctx = nav.new_context(locale="en-US", viewport={"width": 1440, "height": 950})
        page = ctx.new_page()
        errores = []
        page.on("pageerror", lambda e: errores.append(f"{page.url} → {str(e)[:140]}"))

        page.goto(f"{BASE}/login")
        page.fill("input[name=identifier]", USER)
        page.fill("input[name=password]", PASS)
        page.click("button[type=submit]")
        page.wait_for_url(re.compile(r"/(dashboard|facturas)"), timeout=15000)
        check("inicia sesión", "/login" not in page.url)

        # --- Menú por secciones ---
        page.goto(f"{BASE}/dashboard"); page.wait_for_timeout(800)
        for seccion in ["Almacén", "Proveedores", "Finanzas", "Administración"]:
            check(f"el menú tiene la sección {seccion}", page.locator(f"button:has-text('{seccion}')").count() > 0)
        # El menú pliega solo las secciones largas, así que "Administración" puede empezar
        # abierta o cerrada según dónde esté el usuario: se mira antes de pulsar.
        boton = page.locator("button:has-text('Administración')").first
        abierta_antes = boton.get_attribute("aria-expanded") == "true"
        boton.click(); page.wait_for_timeout(400)
        check("al pulsar el título, la sección cambia de estado",
              (page.locator("a[href='/usuarios']").count() > 0) != abierta_antes)
        boton.click(); page.wait_for_timeout(400)
        check("y al pulsarlo otra vez, vuelve a como estaba",
              (page.locator("a[href='/usuarios']").count() > 0) == abierta_antes)

        # --- El campo de fecha ya no depende del idioma del navegador ---
        page.goto(f"{BASE}/facturas"); page.wait_for_timeout(600)
        page.click("text=Nueva factura"); page.wait_for_timeout(500)
        emision = page.locator("input#issueDate")
        check("la fecha se muestra en día/mes/año", "/" in emision.input_value() and len(emision.input_value()) == 10, emision.input_value())
        emision.fill("")
        emision.type("03102026", delay=30)
        page.wait_for_timeout(300)
        check("al teclear se ponen las barras solas", emision.input_value() == "03/10/2026", emision.input_value())
        check("el foco no se escapa del campo", page.evaluate("document.activeElement.id") == "issueDate",
              page.evaluate("document.activeElement.id"))
        check("se guarda como 3 de octubre, no 10 de marzo",
              page.locator("input[type=hidden][name=issueDate]").input_value() == "2026-10-03",
              page.locator("input[type=hidden][name=issueDate]").input_value())
        emision.fill("")
        emision.type("31022026", delay=20)
        page.wait_for_timeout(300)
        check("avisa de una fecha que no existe", "Esa fecha no existe" in page.content())
        emision.fill("")
        emision.type("03102026", delay=20)

        # --- Factura con datos del servicio y detracción ---
        page.select_option("select[name=supplierId]", index=1)
        page.wait_for_timeout(300)
        serie = f"F0{SELLO[:2]}"
        page.fill("input[name=series]", serie)
        page.fill("input[name=number]", SELLO)
        page.fill("input[name=subtotal]", "4100")
        page.wait_for_timeout(300)
        check("el IGV sale solo", page.input_value("input[name=igv]") == "738.00", page.input_value("input[name=igv]"))
        check("el total sale solo", page.input_value("input[name=total]") == "4838.00", page.input_value("input[name=total]"))
        check("anuncia la detracción antes de guardar", "S/ 194.00" in page.content(), page.content()[:0])
        check("y lo que queda para el proveedor", "S/ 4,644.00" in page.content())

        page.click("summary:has-text('Datos del servicio')")
        page.wait_for_timeout(300)
        page.fill("input[name=clientName]", "Winter")
        page.fill("input[name=plate]", "D7S943")
        page.fill("input[name=originCity]", "Lima")
        page.fill("input[name=destinationCity]", "Trujillo")
        page.fill("input[name=volumeM3]", "50")
        page.fill("input[name=weightTn]", "8")
        enviar(page, "Registrar factura")
        check("la factura queda registrada", f"{serie}-{SELLO}" in page.content())
        check("la lista muestra el cliente y la placa", "Winter" in page.content() and "D7S943" in page.content())

        # --- La detracción calculada ---
        detra = psql(f"select detraction_amount::int, detraction_status from supplier_invoices where series='{serie}'")
        check("la detracción guardada es 194 y queda pendiente", detra == "194|PENDIENTE", detra)

        page.click(f"a:has-text('{serie}-{SELLO}')")
        page.wait_for_timeout(1200)
        check("la ficha muestra el servicio", "Trujillo" in page.content() and "50 m³" in page.content())
        check("la ficha muestra la detracción", "S/ 194.00" in page.content())

        # --- Registrar el depósito ---
        page.click("button:has-text('Detracción')")
        page.wait_for_timeout(500)
        page.select_option("select[name=detractionStatus]", "PAGADA")
        page.wait_for_timeout(400)
        page.fill("input[name=detractionReceipt]", "301536291")

        # Sin la imagen de la constancia no se da por depositada: es el papel que después
        # permite cuadrar el depósito con el Banco de la Nación.
        page.click("button:has-text('Guardar')")
        page.wait_for_timeout(2200)
        check("sin la imagen de la constancia no se da por depositada",
              "Falta la imagen de la constancia" in page.content())
        check("y la detracción sigue pendiente",
              psql(f"select detraction_status from supplier_invoices where series='{serie}'") == "PENDIENTE")

        page.set_input_files("input[name=voucher]", CONSTANCIA)
        enviar(page, "Guardar")
        check("la detracción queda pagada", "Pagada" in page.content() and "301536291" in page.content())
        check("y la constancia quedó guardada como comprobante de pago",
              psql("select kind from invoice_attachments where id = "
                   f"(select detraction_proof_id from supplier_invoices where series='{serie}')") == "VOUCHER")
        guardado = psql(f"select detraction_status from supplier_invoices where series='{serie}'")
        check("y así consta en la base", guardado == "PAGADA", guardado)

        # --- Pantalla de detracciones ---
        page.goto(f"{BASE}/detracciones"); page.wait_for_timeout(1200)
        check("la pantalla de detracciones carga", "Detracciones" in page.content())
        check("muestra el total pendiente", "Pendientes de depositar" in page.content())
        pendientes = int(psql("select count(*) from supplier_invoices where detraction_status='PENDIENTE' and status<>'ANULADA'"))
        # Sin la fila de "no hay nada con esos filtros", que también es un <tr> del tbody
        # y haría contar 1 cuando no se ve ninguna factura.
        filas = page.locator("tbody tr:not(:has(td[colspan]))").count()
        check("por defecto lista solo las pendientes", filas == min(pendientes, 25), (filas, pendientes))
        page.goto(f"{BASE}/detracciones?detraccion=PAGADA"); page.wait_for_timeout(1000)
        check("el filtro de pagadas funciona", "Pagada" in page.content())

        # --- Resumen de EPP ---
        page.goto(f"{BASE}/entregas"); page.wait_for_timeout(800)
        check("el listado ofrece el resumen", page.locator("a[href='/entregas/resumen']").count() > 0)
        page.goto(f"{BASE}/entregas/resumen"); page.wait_for_timeout(1200)
        check("el resumen carga", "Resumen de EPP entregados" in page.content())
        for bloque in ["EPP entregados", "Trabajadores con entregas", "Por tipo de EPP", "Por trabajador"]:
            check(f"el resumen muestra «{bloque}»", bloque in page.content())
        unidades = psql("select coalesce(sum(quantity),0) from epp_deliveries where voided_at is null")
        check("el total de unidades cuadra con la base", unidades in page.content().replace(",", ""), unidades)

        # --- Deuda por tipo ---
        # El resumen en dos paneles se reemplazó por una tabla por tipo, con el total
        # pendiente en la cabecera de cada una.
        page.goto(f"{BASE}/obligaciones"); page.wait_for_timeout(1500)
        cuerpo = page.content()
        check("préstamos agrupa por tipo", ">Servicios<" in cuerpo, cuerpo[:0])
        check("cada tipo dice cuánto falta pagar", "falta pagar" in cuerpo)
        check("la deuda sembrada aparece sumada", "S/ 450.00" in cuerpo, cuerpo[:0])

        # --- Rol de detracciones ---
        page.goto(f"{BASE}/usuarios"); page.wait_for_timeout(800)
        page.click("text=Nuevo usuario"); page.wait_for_timeout(500)
        page.fill("input[name=name]", "Encargada de detracciones")
        page.fill("input[name=username]", f"detra{SELLO}")
        page.fill("input[name=email]", f"detra{SELLO}@transjer.pe")
        page.select_option("select[name=role]", "DETRACCIONES")
        page.wait_for_timeout(300)
        check("el formulario explica el rol nuevo", "Solo detracciones" in page.content())
        page.fill("input[name=password]", "Detrac123!")
        enviar(page, "Crear usuario")
        check("el usuario de detracciones se crea", "Encargada de detracciones" in page.content())

        ctx2 = nav.new_context(locale="es-PE")
        p2 = ctx2.new_page()
        p2.goto(f"{BASE}/login")
        p2.fill("input[name=identifier]", f"detra{SELLO}")
        p2.fill("input[name=password]", "Detrac123!")
        p2.click("button[type=submit]")
        p2.wait_for_timeout(2000)
        p2.goto(f"{BASE}/detracciones"); p2.wait_for_timeout(1000)
        check("la encargada entra a detracciones", "Detracciones" in p2.content())
        check("su menú no tiene almacén", p2.locator("a[href='/inventario']").count() == 0)
        check("ni usuarios", p2.locator("a[href='/usuarios']").count() == 0)
        p2.goto(f"{BASE}/obligaciones"); p2.wait_for_timeout(1000)
        check("no puede entrar a préstamos", "/obligaciones" not in p2.url, p2.url)
        ctx2.close()

        check("sin errores de JavaScript", len(errores) == 0, errores[:2])
        nav.close()

    print()
    if fails:
        print(f"{len(fails)} FALLAS:")
        for f in fails:
            print(" -", f)
        sys.exit(1)
    print("E2E DETRACCIONES: todas las verificaciones superadas")


main()
