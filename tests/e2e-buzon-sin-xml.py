"""
Buzón: los correos sin XML pasan por el monto, los archivos que faltan se dicen, al aceptar
se le avisa al proveedor, y las notas de crédito se ven desde la lista.

  - Un correo sin XML cae en "Por verificar monto" (ya no hay pestaña "Por revisar"),
    marcado "Sin XML" y con lo que le falta: factura, XML o guía de remisión.
  - Su importe se escribe mirando el PDF y se compara con lo pactado. Recién con el monto
    conforme se puede registrar, y al registrarlo se le avisa al proveedor.
  - Al aceptar uno con XML también se le avisa. Si el correo no sale, la aceptación igual
    vale y queda a la vista que no se avisó.
  - En "Esperan nota de crédito", en rojo las que la esperan y en amarillo las que ya la
    tienen, con un botón para verla sin entrar a la factura.

    python3 tests/e2e-buzon-sin-xml.py
"""
import json, os, re, subprocess, time
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=15000)
BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
RUC = f"20{SELLO}777"
PROVEEDOR = f"Buzon Prueba {SELLO} SAC"
SERIE = "E077"

fails = []
def check(nombre, cond, extra=""):
    if cond:
        print("OK   ", nombre)
    else:
        fails.append(nombre)
        print("FALLA", nombre, extra)


def ejecutar(q):
    subprocess.run(["su", "postgres", "-c", f'psql -q -d {DB} -c "{q}"'], check=True, stdout=subprocess.DEVNULL)


def psql(q):
    return subprocess.check_output(["su", "postgres", "-c", f'psql -d {DB} -tAc "{q}"']).decode().strip()


def limpiar():
    ejecutar("delete from invoice_emails where message_id like 'e2e-buzon-%'")
    ejecutar(f"delete from supplier_invoices where supplier_id in (select id from suppliers where ruc = '{RUC}')")
    ejecutar(f"delete from suppliers where ruc = '{RUC}'")


def adjunto(dueño, columna, nombre, tipo="application/pdf"):
    contenido = "%PDF-1.4 prueba" if tipo == "application/pdf" else "<Invoice/>"
    ejecutar("insert into invoice_attachments (" + columna + ", kind, filename, content_type, size_bytes, storage_driver, content) "
             f"values ('{dueño}', 'OTRO', '{nombre}', '{tipo}', 20, 'db', convert_to('{contenido}', 'UTF8'))")


def correo(sufijo, estado, asunto, parsed=None, desde="cobranzas@prueba.pe"):
    datos = "NULL" if parsed is None else "'" + json.dumps(parsed).replace("'", "''").replace('"', '\\"') + "'::jsonb"
    ejecutar("insert into invoice_emails (message_id, subject, from_address, from_name, received_at, status, attachment_count, parsed, detail) "
             f"values ('e2e-buzon-{SELLO}-{sufijo}', '{asunto}', '{desde}', 'Prueba SAC', now() - interval '1 hour', "
             f"'{estado}', 1, {datos}, {'NULL' if parsed else chr(39) + 'No se encontró el XML del comprobante entre los archivos.' + chr(39)})")
    return psql(f"select id from invoice_emails where message_id = 'e2e-buzon-{SELLO}-{sufijo}'")


limpiar()
ejecutar(f"insert into suppliers (business_name, ruc) values ('{PROVEEDOR}', '{RUC}')")
SIN_XML = f"Factura sin XML {SELLO}"
sin_xml = correo("sinxml", "REVISAR", SIN_XML)
adjunto(sin_xml, "email_id", f"factura-F001-{SELLO}.pdf")
COMPLETO = f"Factura completa {SELLO}"
completo = correo("completo", "POR_APROBAR", COMPLETO, {
    "docType": "FACTURA", "series": SERIE, "number": f"{SELLO}1", "issueDate": "2026-11-02", "currency": "PEN",
    "subtotal": "1000.00", "igv": "180.00", "total": "1180.00", "supplierRuc": RUC, "supplierName": PROVEEDOR,
    "description": "Servicio de almacenaje",
}, desde="facturas@proveedor.test")
adjunto(completo, "email_id", f"{RUC}-01-{SERIE}-{SELLO}1.xml", "application/xml")
adjunto(completo, "email_id", f"{RUC}-01-{SERIE}-{SELLO}1.pdf")
adjunto(completo, "email_id", f"{RUC}-31-EG03-{SELLO}.pdf")
adjunto(completo, "email_id", f"20100055237-09-T001-{SELLO}.pdf")

# Dos facturas anuladas: una espera la NC, la otra ya la tiene, con su PDF.
def factura(numero, extra):
    ejecutar("insert into supplier_invoices (supplier_id, series, number, issue_date, total, status, status_reason, detraction_status"
             + (", " + ", ".join(extra.keys()) if extra else "") + ") "
             f"select id, 'F001', '{numero}', current_date - 10, 500, 'ANULADA', 'Rechazada', 'NO_APLICA'"
             + (", " + ", ".join(extra.values()) if extra else "")
             + f" from suppliers where ruc = '{RUC}'")
    return psql(f"select id from supplier_invoices where number = '{numero}'")

espera = factura(f"9{SELLO}", {"awaiting_credit_note": "true"})
con_nc = factura(f"8{SELLO}", {"credit_note_number": "'E001-71'", "credit_note_date": "current_date - 2", "credit_note_amount": "500"})
adjunto(con_nc, "invoice_id", f"{RUC}-07-E001-71.pdf")

with sync_playwright() as p:
    nav = p.chromium.launch()
    page = nav.new_page(viewport={"width": 1440, "height": 950})
    errores = []
    page.on("pageerror", lambda e: errores.append(f"{page.url} → {str(e)[:140]}"))
    page.goto(f"{BASE}/login")
    page.fill("input[name=identifier]", USER)
    page.fill("input[name=password]", PASS)
    page.click("button[type=submit]")
    page.wait_for_url(re.compile("/dashboard"), timeout=30000)

    # --- 1. El correo sin XML está en Por verificar monto ---
    page.goto(f"{BASE}/facturas/correos"); page.wait_for_timeout(1500)
    check("ya no hay pestaña Por revisar", "Por revisar" not in page.locator("main").inner_text())
    fila = page.locator("tbody tr").filter(has_text=SIN_XML)
    check("el correo sin XML aparece en Por verificar monto", fila.count() == 1)
    texto = fila.inner_text() if fila.count() else ""
    check("marcado Sin XML", "Sin XML" in texto)
    faltan = fila.locator("li").all_inner_texts() if fila.count() else []
    check("dice qué no se encontró", "No se encontró:" in texto)
    check("el XML", "XML" in faltan, faltan)
    check("la guía de remisión", "Guía de remisión" in faltan, faltan)
    check("y la guía transportista", "Guía transportista" in faltan, faltan)
    check("con la frase completa al pasar el mouse",
          "No se encontró la guía transportista entre los archivos." in (fila.locator("[title*='guía transportista']").first.get_attribute("title") or ""))
    check("pero no la factura, que sí vino", "Factura (PDF)" not in faltan)
    fila2 = page.locator("tbody tr").filter(has_text=PROVEEDOR).filter(has_text=f"{SERIE}-{SELLO}1")
    check("el que trae factura, XML y las dos guías no reclama nada", fila2.count() == 1 and "No se encontró" not in fila2.inner_text(),
          fila2.inner_text() if fila2.count() else "")
    check("sin XML todavía no se puede registrar: primero el monto",
          fila.get_by_role("button", name=re.compile("^Registrar")).count() == 0)

    page.goto(f"{BASE}/facturas/correos?estado=REVISAR"); page.wait_for_timeout(1300)
    check("un enlace viejo a Por revisar muestra Por verificar monto",
          page.locator("tbody tr").filter(has_text=SIN_XML).count() == 1)

    # --- 2. Verificar el monto escribiendo el importe del PDF ---
    page.goto(f"{BASE}/facturas/correos"); page.wait_for_timeout(1300)
    fila = page.locator("tbody tr").filter(has_text=SIN_XML)
    fila.get_by_role("button", name=re.compile("Verificar monto|Verificar el monto")).click(); page.wait_for_timeout(500)
    d = page.locator("[role=dialog]")
    check("el formulario dice que no vino XML y pide el importe del PDF",
          "No vino" in d.inner_text() and d.locator("input[name=manualAmount]").count() == 1)
    d.locator("input[name=agreedAmount]").fill("1000")
    d.get_by_role("button", name=re.compile("Guardar|Dejar")).click(); page.wait_for_timeout(1500)
    check("sin el importe no se guarda", psql(f"select amount_status from invoice_emails where id = '{sin_xml}'") == "PENDIENTE")
    d.locator("input[name=manualAmount]").fill("1000")
    check("compara en el momento", "Coincide con lo pactado" in d.inner_text())
    d.get_by_role("button", name="Guardar la verificación").click(); page.wait_for_timeout(2000)
    check("queda conforme, con el importe escrito",
          psql(f"select amount_status || '|' || manual_amount || '|' || manual_currency from invoice_emails where id = '{sin_xml}'") == "CONFORME|1000.00|PEN")

    # --- 3. Por aprobar: se registra y se avisa ---
    page.goto(f"{BASE}/facturas/correos?estado=POR_APROBAR"); page.wait_for_timeout(1300)
    fila = page.locator("tbody tr").filter(has_text=SIN_XML)
    check("pasa a Por aprobar, con el importe del PDF", fila.count() == 1 and "1,000.00" in fila.inner_text())
    fila.get_by_role("button", name=re.compile("^Registrar")).click(); page.wait_for_timeout(600)
    d = page.locator("[role=dialog]")
    check("el total viene propuesto con IGV", d.locator("input[name=total]").input_value() == "1180.00")
    check("y la casilla de avisar al proveedor viene marcada", d.locator("input[name=avisar]").is_checked())
    d.locator("select[name=supplierId]").select_option(psql(f"select id from suppliers where ruc = '{RUC}'"))
    d.locator("input[name=series]").fill("F001")
    d.locator("input[name=number]").fill(f"7{SELLO}")
    d.locator("select[name=serviceType]").select_option("SERVICIO")
    d.get_by_role("button", name="Registrar factura").click(); page.wait_for_timeout(2500)
    check("la factura queda registrada desde el correo",
          psql(f"select status from invoice_emails where id = '{sin_xml}'") == "PROCESADO"
          and psql(f"select count(*) from supplier_invoices where number = '7{SELLO}'") == "1")
    check("se intentó avisar al proveedor, y lo que se le mandó queda guardado",
          psql(f"select reply_to from invoice_emails where id = '{sin_xml}'") == "cobranzas@prueba.pe"
          and "aceptamos el comprobante F001-7" + SELLO in psql(f"select reply_body from invoice_emails where id = '{sin_xml}'"))
    enviado = psql(f"select reply_sent_at is not null from invoice_emails where id = '{sin_xml}'") == "t"
    check("si el correo no salió, queda dicho por qué",
          enviado or psql(f"select reply_error is not null from invoice_emails where id = '{sin_xml}'") == "t")

    # --- 4. Aceptar uno con XML también avisa ---
    page.goto(f"{BASE}/facturas/correos"); page.wait_for_timeout(1300)
    fila = page.locator("tbody tr").filter(has_text=f"{SERIE}-{SELLO}1")
    fila.get_by_role("button", name=re.compile("Verificar monto|Verificar el monto")).click(); page.wait_for_timeout(500)
    page.locator("[role=dialog]").get_by_role("button", name="Guardar la verificación").click(); page.wait_for_timeout(2000)
    page.goto(f"{BASE}/facturas/correos?estado=POR_APROBAR"); page.wait_for_timeout(1300)
    fila = page.locator("tbody tr").filter(has_text=f"{SERIE}-{SELLO}1")
    fila.get_by_role("button", name=re.compile("Aceptar")).click(); page.wait_for_timeout(600)
    d = page.locator("[role=dialog]")
    check("al aceptar, la casilla de avisar viene marcada con el remitente",
          d.locator("input[name=avisar]").is_checked() and "facturas@proveedor.test" in d.inner_text())
    d.locator("select[name=serviceType]").select_option("SERVICIO"); page.wait_for_timeout(200)
    d.get_by_role("button", name="Aceptar y registrar").click(); page.wait_for_timeout(2500)
    check("aceptado, y el aviso queda guardado para el remitente",
          psql(f"select status || '|' || coalesce(reply_to, '-') from invoice_emails where id = '{completo}'") == "PROCESADO|facturas@proveedor.test")
    page.goto(f"{BASE}/facturas/correos?estado=PROCESADO&q={SELLO}"); page.wait_for_timeout(1300)
    fila = page.locator("tbody tr").filter(has_text=f"{SERIE}-{SELLO}1")
    check("en Aceptados se ve si el aviso salió o no",
          "Aceptación avisada" in fila.inner_text() or "aceptación sin avisar" in fila.inner_text(), fila.inner_text())

    # --- 5. Notas de crédito ---
    page.goto(f"{BASE}/facturas?estado=SIN_NC&q={SELLO}"); page.wait_for_timeout(1500)
    f_espera = page.locator("tbody tr").filter(has_text=f"F001-9{SELLO}")
    f_con = page.locator("tbody tr").filter(has_text=f"F001-8{SELLO}")
    check("la pestaña muestra las dos: la que espera y la que ya la tiene", f_espera.count() == 1 and f_con.count() == 1)
    check("la que espera la NC, en rojo", "bg-red-50" in (f_espera.get_attribute("class") or ""))
    check("la que ya la tiene, en amarillo", "bg-amber-50" in (f_con.get_attribute("class") or ""))
    check("solo la que la tiene trae el botón para verla",
          f_con.get_by_role("button", name=re.compile("Ver la nota de crédito")).count() == 1
          and f_espera.get_by_role("button", name=re.compile("Ver la nota de crédito")).count() == 0)
    f_con.get_by_role("button", name=re.compile("Ver la nota de crédito")).click(); page.wait_for_timeout(500)
    d = page.locator("[role=dialog]")
    check("se ve la nota sin entrar a la factura", "E001-71" in d.inner_text() and "500.00" in d.inner_text())
    enlace = d.get_by_role("link", name=re.compile("Abrir el PDF")).get_attribute("href")
    check("y su PDF se abre", page.evaluate("(u) => fetch(u).then((r) => r.status)", enlace) == 200, enlace)

    check("sin errores de JavaScript", not errores, errores[:3])
    nav.close()

limpiar()
print("\n" + ("Todo en orden." if not fails else f"{len(fails)} FALLAS: {fails}"))
raise SystemExit(1 if fails else 0)
