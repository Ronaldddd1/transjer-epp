"""
Pago masivo de detracciones con el archivo de SUNAT.

  1. En Detracciones se marcan las pendientes y se arma el TXT de Depósitos Masivos.
     Si a un proveedor le falta la cuenta del Banco de la Nación, se escribe ahí mismo.
  2. (Se sube en SUNAT y se paga: eso pasa fuera del sistema.)
  3. Con la constancia, el lote entero queda pagado de una vez.
  Y un lote que no se pagó se anula: sus detracciones vuelven a pendientes.

    python3 tests/e2e-pago-masivo.py
"""
import os, re, subprocess, time
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=15000)
BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
RUC_EMPRESA = f"20{SELLO}111"
CON_CUENTA = f"Pago Masivo {SELLO} Con Cuenta SAC"
SIN_CUENTA = f"Pago Masivo {SELLO} Sin Cuenta SAC"
SIN_RUC = f"Pago Masivo {SELLO} Sin RUC"
RUC_A, RUC_B = f"20{SELLO}201", f"20{SELLO}202"
CUENTA_A, CUENTA_B = "00011122233", "00044455566"
AA = time.strftime("%y")

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
    ejecutar(f"delete from supplier_invoices where supplier_id in (select id from suppliers where business_name like 'Pago Masivo %')")
    ejecutar(f"delete from detraction_batches where payer_ruc like '20%111' and length(payer_ruc) = 11 and payer_name like '%PRUEBA%'")
    ejecutar(f"delete from suppliers where business_name like 'Pago Masivo %'")
    ejecutar("delete from users where username like 'solodetra%'")


def factura(proveedor, numero, monto):
    ejecutar(f"insert into supplier_invoices (supplier_id, series, number, issue_date, total, detraction_amount, detraction_status, service_type) "
             f"select id, 'F001', '{numero}', current_date - 3, {monto * 25}, {monto}, 'PENDIENTE', 'TRANSPORTE' "
             f"from suppliers where business_name = '{proveedor}'")


def pdf(ruta):
    cuerpo = (b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
              b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\ntrailer << /Root 1 0 R >>\n")
    open(ruta, "wb").write(cuerpo + b"% " + b"r" * (12 * 1024) + b"\n%%EOF")
    return ruta


os.makedirs("/tmp/e2e-files", exist_ok=True)
CONSTANCIA = pdf("/tmp/e2e-files/constancia-lote.pdf")

limpiar()
ejecutar(f"insert into suppliers (business_name, ruc, detraction_account) values ('{CON_CUENTA}', '{RUC_A}', '{CUENTA_A}')")
ejecutar(f"insert into suppliers (business_name, ruc) values ('{SIN_CUENTA}', '{RUC_B}')")
ejecutar(f"insert into suppliers (business_name) values ('{SIN_RUC}')")
factura(CON_CUENTA, f"1{SELLO}", 25)
factura(CON_CUENTA, f"2{SELLO}", 118)
factura(SIN_CUENTA, f"3{SELLO}", 40)
factura(SIN_RUC, f"4{SELLO}", 30)
estado = lambda numero: psql(f"select detraction_status from supplier_invoices where number = '{numero}{SELLO}'")

with sync_playwright() as p:
    nav = p.chromium.launch()
    ctx = nav.new_context(viewport={"width": 1440, "height": 950}, accept_downloads=True)
    page = ctx.new_page()
    errores = []
    page.on("pageerror", lambda e: errores.append(f"{page.url} → {str(e)[:140]}"))
    page.goto(f"{BASE}/login")
    page.fill("input[name=identifier]", USER)
    page.fill("input[name=password]", PASS)
    page.click("button[type=submit]")
    page.wait_for_url(re.compile("/dashboard"), timeout=30000)

    # --- La ficha del proveedor tiene su cuenta de detracciones ---
    page.goto(f"{BASE}/proveedores?q={SELLO}"); page.wait_for_timeout(1500)
    check("la lista de proveedores muestra la cuenta del Banco de la Nación",
          f"Cta. BN {CUENTA_A}" in page.locator("body").inner_text())
    page.get_by_role("row").filter(has_text=SIN_CUENTA).get_by_role("button", name=re.compile("Editar")).first.click()
    page.wait_for_timeout(500)
    check("y el formulario del proveedor la pide", page.locator("[role=dialog] input[name=detractionAccount]").count() == 1)
    page.keyboard.press("Escape"); page.wait_for_timeout(400)

    # --- 1. Marcar y armar el archivo ---
    page.goto(f"{BASE}/detracciones?q=Pago Masivo {SELLO}"); page.wait_for_timeout(1500)
    casilla = lambda numero: page.locator(f"input[name=ids][data-factura='F001-{numero}{SELLO}']")
    check("cada pendiente tiene su casilla", all(casilla(n).count() == 1 for n in "1234"))
    check("la de un proveedor sin RUC no se puede marcar", casilla("4").is_disabled())
    check("y dice que falta la cuenta del que no la tiene", "Sin cuenta del Banco de la Nación" in page.locator("body").inner_text())
    page.get_by_label("Marcar todas las de esta página").check(); page.wait_for_timeout(400)
    barra = page.locator("text=marcada(s)").locator("..")
    check("marcar todas marca las tres que se pueden, por S/ 183",
          "3 marcada(s)" in barra.inner_text() and "183" in barra.inner_text(), barra.inner_text())
    check("y avisa del proveedor sin cuenta", "1 proveedor(es) sin cuenta" in barra.inner_text())

    page.get_by_role("button", name="Armar archivo para SUNAT").click(); page.wait_for_timeout(500)
    dialogo = page.locator("[role=dialog]")
    check("el lote propuesto es el primero del año", dialogo.locator("input[name=lote]").input_value().startswith(AA))
    dialogo.locator("input[name=rucPagador]").fill(RUC_EMPRESA)
    dialogo.locator("input[name=razonSocialPagador]").fill("Transportes Jer S.A.C. prueba")
    dialogo.locator("input[name=lote]").fill(f"{AA}0001")
    check("pide la cuenta del proveedor que no la tiene", dialogo.locator(f"label:has-text('{SIN_CUENTA}')").count() == 1)
    dialogo.locator("input[name^=cuenta_]").fill("123")
    dialogo.get_by_role("button", name="Armar y descargar").click(); page.wait_for_timeout(1500)
    check("una cuenta que no tiene 11 dígitos se rechaza", "11 dígitos" in dialogo.inner_text())
    check("y no se arma nada", estado("1") == "PENDIENTE" and psql(f"select count(*) from detraction_batches where payer_ruc = '{RUC_EMPRESA}'") == "0")

    dialogo.locator("input[name^=cuenta_]").fill("000-444-55566")
    with page.expect_download(timeout=30000) as dl:
        dialogo.get_by_role("button", name="Armar y descargar").click()
    descarga = dl.value
    nombre = descarga.suggested_filename
    contenido = open(descarga.path(), "rb").read().decode("ascii")
    lineas = contenido.split("\r\n")
    check("se descarga D + RUC + lote", nombre == f"D{RUC_EMPRESA}{AA}0001.txt", nombre)
    check("con la cabecera y tres detalles", len(lineas) == 4 and len(lineas[0]) == 68 and all(len(l) == 107 for l in lineas[1:]),
          [len(l) for l in lineas])
    check("la cabecera lleva el total de S/ 183", lineas[0].endswith("000000000018300") and lineas[0][47:53] == f"{AA}0001", lineas[0])
    check("cada detalle con su cuenta, su monto y su comprobante",
          any(l[1:12] == RUC_B and l[59:70] == "00044455566" and l[70:85] == "000000000004000" and l[99:] == f"03{SELLO}".rjust(8, "0") for l in lineas[1:]),
          lineas[1:])
    check("la cuenta escrita queda guardada en la ficha del proveedor, solo con números",
          psql(f"select detraction_account from suppliers where business_name = '{SIN_CUENTA}'") == "00044455566")
    page.wait_for_timeout(1500)
    check("las tres pasan a En proceso", all(estado(n) == "EN_PROCESO" for n in "123"))
    check("la de sin RUC sigue pendiente", estado("4") == "PENDIENTE")

    # --- El lote queda a la vista y su TXT se vuelve a bajar ---
    page.goto(f"{BASE}/detracciones"); page.wait_for_timeout(1500)
    lote = page.locator("li", has_text=f"Lote {AA}0001")
    check("el lote aparece en Pagos masivos, por pagar", lote.count() == 1 and "Falta pagar" in lote.inner_text())
    with page.expect_download() as dl2:
        lote.get_by_role("link", name="TXT").click()
    check("y su archivo se puede volver a bajar igual",
          open(dl2.value.path(), "rb").read().decode("ascii") == contenido)

    # --- 3. Registrar el pago con la constancia ---
    lote.get_by_role("button", name="Registrar pago").click(); page.wait_for_timeout(500)
    dialogo = page.locator("[role=dialog]")
    dialogo.locator("input[name=operacion]").fill(f"77{SELLO}")
    dialogo.get_by_role("button", name="Registrar el pago").click(); page.wait_for_timeout(1500)
    check("sin la constancia no se registra", estado("1") == "EN_PROCESO")
    page.set_input_files("[role=dialog] input[name=voucher]", CONSTANCIA)
    dialogo.locator("summary").click()
    dialogo.get_by_label(f"Constancia de F001-2{SELLO}").fill(f"55{SELLO}")
    dialogo.get_by_role("button", name="Registrar el pago").click(); page.wait_for_timeout(2500)
    check("las tres quedan pagadas de una vez", all(estado(n) == "PAGADA" for n in "123"), [estado(n) for n in "123"])
    check("con la fecha y el número de operación",
          psql(f"select count(*) from supplier_invoices where number in ('1{SELLO}','2{SELLO}','3{SELLO}') "
               f"and detraction_paid_at = (now() at time zone 'America/Lima')::date and detraction_operation = '77{SELLO}'") == "3")
    check("la constancia propia de una se respeta; las demás llevan la operación",
          psql(f"select detraction_receipt from supplier_invoices where number = '2{SELLO}'") == f"55{SELLO}"
          and psql(f"select detraction_receipt from supplier_invoices where number = '1{SELLO}'") == f"77{SELLO}")
    check("la constancia se guarda una vez y queda enlazada en las tres",
          psql(f"select count(distinct detraction_proof_id) || '|' || count(detraction_proof_id) from supplier_invoices where number in ('1{SELLO}','2{SELLO}','3{SELLO}')") == "1|3")
    check("el lote queda pagado", psql(f"select status from detraction_batches where payer_ruc = '{RUC_EMPRESA}' and lot = '{AA}0001'") == "PAGADO")
    page.reload(); page.wait_for_timeout(1200)
    lote = page.locator("li", has_text=f"Lote {AA}0001")
    check("y así se ve, con su operación", "Pagado" in lote.inner_text() and f"op. 77{SELLO}" in lote.inner_text())
    enlace = lote.get_by_role("link", name="Constancia").get_attribute("href")
    estado_http = page.evaluate("(u) => fetch(u).then((r) => r.status)", enlace)
    check("la constancia se abre", estado_http == 200, (enlace, estado_http))
    check("queda en auditoría",
          psql(f"select count(*) from audit_logs where module = 'DETRACCIONES' and description like '%pago del lote {AA}0001%operación 77{SELLO}%'") == "1")

    # La ficha de la factura dice en qué lote fue
    fid = psql(f"select id from supplier_invoices where number = '1{SELLO}'")
    page.goto(f"{BASE}/facturas/{fid}"); page.wait_for_timeout(1200)
    cuerpo = page.locator("body").inner_text()
    check("la factura dice en qué lote fue y enlaza la constancia", f"lote {AA}0001" in cuerpo and "Ver la constancia" in cuerpo)

    # --- Un lote que no se pagó se anula ---
    ejecutar(f"update suppliers set ruc = '20{SELLO}203', detraction_account = '00077788899' where business_name = '{SIN_RUC}'")
    page.goto(f"{BASE}/detracciones?q=Pago Masivo {SELLO}"); page.wait_for_timeout(1500)
    casilla("4").check(); page.wait_for_timeout(300)
    page.get_by_role("button", name="Armar archivo para SUNAT").click(); page.wait_for_timeout(500)
    dialogo = page.locator("[role=dialog]")
    check("el siguiente lote se propone solo, con la empresa de antes",
          dialogo.locator("input[name=lote]").input_value() == f"{AA}0002"
          and dialogo.locator("input[name=rucPagador]").input_value() == RUC_EMPRESA,
          dialogo.locator("input[name=lote]").input_value())
    dialogo.locator("input[name=lote]").fill(f"{AA}0001")
    dialogo.get_by_role("button", name="Armar y descargar").click(); page.wait_for_timeout(1500)
    check("un número de lote ya usado no se repite", "ya se usó" in dialogo.inner_text() and estado("4") == "PENDIENTE")
    dialogo.locator("input[name=lote]").fill(f"{AA}0002")
    with page.expect_download():
        dialogo.get_by_role("button", name="Armar y descargar").click()
    page.wait_for_timeout(1200)
    page.goto(f"{BASE}/detracciones"); page.wait_for_timeout(1200)
    lote = page.locator("li", has_text=f"Lote {AA}0002")
    lote.get_by_role("button", name=re.compile("Anular")).click(); page.wait_for_timeout(400)
    page.locator("[role=dialog]").get_by_role("button", name="Anular el lote").click(); page.wait_for_timeout(2000)
    check("al anular, su detracción vuelve a pendiente", estado("4") == "PENDIENTE")
    check("el lote queda anulado", psql(f"select status from detraction_batches where payer_ruc = '{RUC_EMPRESA}' and lot = '{AA}0002'") == "ANULADO")
    page.goto(f"{BASE}/detracciones?q=Pago Masivo {SELLO}"); page.wait_for_timeout(1500)
    casilla("4").check(); page.wait_for_timeout(300)
    page.get_by_role("button", name="Armar archivo para SUNAT").click(); page.wait_for_timeout(500)
    check("y su número no se vuelve a proponer",
          page.locator("[role=dialog] input[name=lote]").input_value() == f"{AA}0003")
    page.keyboard.press("Escape")

    # --- Quien solo lleva Detracciones también abre la constancia ---
    ejecutar(f"insert into users (name, username, email, password_hash, role, module_access) "
             f"select 'Solo Detracciones', 'solodetra{SELLO}', 'solodetra{SELLO}@transjer.test', password_hash, 'USUARIO', "
             f"'{{\\\"detracciones\\\": \\\"edit\\\"}}'::jsonb from users where username = '{USER}'")
    otro = nav.new_context(viewport={"width": 1280, "height": 900})
    p2 = otro.new_page()
    p2.goto(f"{BASE}/login")
    p2.fill("input[name=identifier]", f"solodetra{SELLO}")
    p2.fill("input[name=password]", PASS)
    p2.click("button[type=submit]")
    p2.wait_for_timeout(3000)
    p2.goto(f"{BASE}/detracciones"); p2.wait_for_timeout(1500)
    check("un usuario solo de Detracciones ve los lotes", f"Lote {AA}0001" in p2.locator("body").inner_text())
    check("y abre la constancia del lote aunque no vea Facturas",
          p2.evaluate("(u) => fetch(u).then((r) => r.status)", enlace) == 200)
    otro_pdf = psql("select id from invoice_attachments where kind = 'VOUCHER' and id not in "
                    "(select detraction_proof_id from supplier_invoices where detraction_proof_id is not null) "
                    "and invoice_id is not null limit 1")
    if otro_pdf:
        check("pero no otros comprobantes de Facturas",
              p2.evaluate("(u) => fetch(u).then((r) => r.status)", f"/api/facturas/adjuntos/{otro_pdf}") == 403)
    otro.close()

    # --- En el celular ---
    movil = ctx.new_page(); movil.set_viewport_size({"width": 390, "height": 844})
    movil.goto(f"{BASE}/detracciones"); movil.wait_for_timeout(1500)
    ancho = movil.evaluate("document.documentElement.scrollWidth")
    check("en el celular la página no se sale de ancho", ancho <= 400, ancho)

    check("sin errores de JavaScript", not errores, errores[:3])
    nav.close()

limpiar()
print("\n" + ("Todo en orden." if not fails else f"{len(fails)} FALLAS: {fails}"))
raise SystemExit(1 if fails else 0)
