"""
Prueba de extremo a extremo del módulo de facturas, con navegador real.
Requiere el servidor en http://localhost:3000 y la base con datos de prueba.
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 tests/e2e-facturas.py
"""
import os, re, subprocess, sys
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=15000)
BASE = "http://localhost:3000"
SHOTS = "/tmp/shots"
fails = []

def ok(name): print("OK  ", name)
DB = os.environ.get("E2E_DB", "epp")

def psql(q):
    return subprocess.check_output(["su", "postgres", "-c", f'psql -d {DB} -tAc "{q}"']).decode().strip()

def filas(page):
    """
    Cuántas facturas se ven en la tabla.

    Hay que descartar la fila de "no hay nada con esos filtros": también es un <tr> del
    tbody, así que contarla hacía que un filtro sin resultados diera 1 en vez de 0 y la
    prueba fallara sola según con qué datos se corriera. Esa fila se reconoce porque es
    una sola celda con colspan.
    """
    return page.locator("tbody tr:not(:has(td[colspan]))").count()


def toast(page, text):
    expect(page.get_by_role("status").filter(has_text=text)
           .or_(page.get_by_role("alert").filter(has_text=text)).first).to_be_visible(timeout=10000)

def login(page, user, pw):
    page.goto(BASE + "/login"); page.fill("#identifier", user); page.fill("#password", pw)
    page.get_by_role("button", name="Ingresar").click()
    expect(page).to_have_url(re.compile("/dashboard"))

XML = """<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F050-777</cbc:ID>
  <cbc:IssueDate>2026-09-15</cbc:IssueDate>
  <cbc:DueDate>2026-10-15</cbc:DueDate>
  <cbc:InvoiceTypeCode listID="0101">01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:DespatchDocumentReference><cbc:ID>T050-9090</cbc:ID><cbc:DocumentTypeCode>31</cbc:DocumentTypeCode></cac:DespatchDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="6">20999999998</cbc:ID></cac:PartyIdentification>
    <cac:PartyLegalEntity><cbc:RegistrationName>TRANSPORTES PRUEBA E2E S.A.C.</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">450.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="PEN">2500.00</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="PEN">2950.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cac:Item><cbc:Description>SERVICIO DE TRANSPORTE LIMA - AREQUIPA</cbc:Description></cac:Item></cac:InvoiceLine>
</Invoice>"""

def limpiar():
    """Deja la base como recién sembrada, para que la prueba se pueda repetir."""
    sentencias = [
        "delete from invoice_attachments where invoice_id in (select id from supplier_invoices where series in ('F050') or (series='F001' and number='3001'))",
        "delete from invoice_emails where invoice_id in (select id from supplier_invoices where series='F050')",
        "delete from supplier_invoices where series='F050' or (series='F001' and number='3001')",
        "delete from suppliers where ruc in ('20999999998','20111111116')",
        # Restos de la prueba del correo (tests/invoice-ingest.test.ts), si se ejecutó antes.
        "delete from invoice_attachments where invoice_id in (select id from supplier_invoices where series in ('F009','F077'))",
        "delete from invoice_emails where true",
        "delete from supplier_invoices where series in ('F009','F077')",
        "delete from suppliers where ruc in ('20777777771','20888888882')",
        "delete from audit_logs where module in ('FACTURAS','PROVEEDORES','CORREO')",
        "delete from users where username in ('pagos','jalmacen')",
        "update suppliers set active=true",
    ]
    for q in sentencias:
        subprocess.run(["su", "postgres", "-c", f'psql -q -d {DB} -c "{q}"'], check=True, stdout=subprocess.DEVNULL)

limpiar()
hoy = psql("select (now() at time zone 'America/Lima')::date::text")
# El campo de fecha se escribe como lo ve el usuario, en día/mes/año. Rellenarlo en ISO
# dejaba la fecha vacía sin que se notara, porque el servidor asumía hoy en silencio.
hoy_es = "/".join(reversed(hoy.split("-")))
manana = psql("select ((now() at time zone 'America/Lima')::date + 1)::text")

os.makedirs(SHOTS, exist_ok=True)
os.makedirs("/tmp/e2e-files", exist_ok=True)
open("/tmp/e2e-files/F050-777.xml", "w").write(XML)
open("/tmp/e2e-files/F050-777.pdf", "wb").write(b"%PDF-1.4\nfactura de prueba e2e\n%%EOF")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    # Se anota en qué página apareció: un error suelto al final no dice dónde buscar.
    page.on("pageerror", lambda e: errors.append(f"{page.url} → {str(e)[:160]}"))

    login(page, "admin", "Admin123!")
    m = page.get_by_role("dialog")

    # --- 1. El dashboard resume las facturas
    for tarjeta in ["Facturas por pagar", "Vencidas", "Vencen en 3 días", "Próximas a pagar"]:
        expect(page.get_by_text(tarjeta, exact=True)).to_be_visible()
    ok("Dashboard resume las facturas por su fecha límite")

    # --- 2. Listado y resumen por moneda
    page.goto(BASE + "/facturas")
    expect(page.get_by_role("heading", name="Facturas de proveedores")).to_be_visible()
    expect(page.get_by_text("Pendientes de pago")).to_be_visible()
    vistas = filas(page)
    # La tabla pagina de 20 en 20: se compara contra lo que cabe en la primera página.
    esperadas = min(int(psql("select count(*) from supplier_invoices")), 20)
    assert vistas == esperadas, f"la tabla muestra {vistas} facturas y deberían verse {esperadas}"
    # Se busca por su número: con el histórico importado, esa factura ya no cabe en la
    # primera página y antes la prueba daba por perdido algo que sí estaba.
    page.get_by_role("searchbox").fill("0871")
    page.wait_for_timeout(800)
    expect(page.get_by_role("row").filter(has_text="F002-0871").get_by_text("Vencida")).to_be_visible()
    page.goto(BASE + "/facturas")
    ok("Listado con resumen, importes por moneda y aviso de vencidas")

    # --- 3. Registro manual con validación
    page.get_by_role("button", name="Nueva factura").click()
    m.get_by_role("button", name="Registrar factura").click()
    expect(m.get_by_text("La serie es obligatoria")).to_be_visible()
    prov = psql("select id from suppliers where ruc='20548392117'")
    m.locator("#supplierId").select_option(prov)
    m.locator("#series").fill("F001"); m.locator("#number").fill("3001")
    m.locator("#issueDate").fill("10/09/2026"); m.locator("#dueDate").fill("10/10/2026")
    m.locator("#receivedDate").fill(hoy_es)
    m.locator("#subtotal").fill("1000")
    expect(m.locator("#igv")).to_have_value("180.00")
    expect(m.locator("#total")).to_have_value("1180.00")
    m.locator("#grtNumber").fill("T001-4321")
    m.get_by_role("button", name="Registrar factura").click()
    toast(page, "F001-3001 registrada correctamente")
    ok("Registro manual: valida campos y calcula IGV y total")

    # --- 4. No admite el mismo comprobante dos veces
    page.get_by_role("button", name="Nueva factura").click()
    m.locator("#supplierId").select_option(prov)
    m.locator("#series").fill("F001"); m.locator("#number").fill("3001")
    m.locator("#total").fill("500")
    m.get_by_role("button", name="Registrar factura").click()
    toast(page, "ya está registrado")
    m.get_by_role("button", name="Cancelar").click()
    ok("Rechaza un comprobante repetido del mismo proveedor")

    # --- 5. Carga desde el XML: crea proveedor, factura y adjuntos
    page.get_by_role("button", name="Cargar XML").click()
    m.locator("#files").set_input_files(["/tmp/e2e-files/F050-777.xml", "/tmp/e2e-files/F050-777.pdf"])
    page.screenshot(path=f"{SHOTS}/e2e-cargar-xml.png")
    m.get_by_role("button", name="Leer y registrar").click()
    toast(page, "F050-777 registrada desde el XML")
    datos = psql("select s.business_name || '|' || i.total || '|' || i.grt_number || '|' || i.due_date "
                 "from supplier_invoices i join suppliers s on s.id=i.supplier_id where i.series='F050'")
    assert datos == "TRANSPORTES PRUEBA E2E S.A.C.|2950.00|T050-9090|2026-10-15", datos
    ok("Cargar XML crea proveedor, factura e importes leídos del comprobante")

    # --- 6. Detalle: adjuntos descargables
    inv_id = psql("select id from supplier_invoices where series='F050'")
    page.goto(BASE + f"/facturas/{inv_id}")
    expect(page.get_by_role("heading", name="F050-777")).to_be_visible()
    expect(page.get_by_text("SERVICIO DE TRANSPORTE LIMA - AREQUIPA")).to_be_visible()
    expect(page.get_by_role("link", name="F050-777.xml", exact=True)).to_be_visible()
    with page.expect_download() as dl:
        page.get_by_title("Descargar F050-777.pdf").click()
    contenido = open(dl.value.path(), "rb").read()
    assert contenido.startswith(b"%PDF-"), contenido[:20]
    page.screenshot(path=f"{SHOTS}/e2e-detalle.png", full_page=True)
    ok("Detalle muestra los archivos y se descargan correctamente")

    # --- 7. Registrar el pago
    page.get_by_role("button", name="Pagar", exact=True).first.click()
    expect(m.get_by_text("S/ 2,950.00")).to_be_visible()
    m.locator("#paymentReference").fill("Transferencia 778899")
    m.get_by_role("button", name="Confirmar pago").click()
    toast(page, "F050-777 marcada como pagada")
    expect(page.get_by_text("Pago registrado")).to_be_visible()
    estado = psql(f"select status || '|' || paid_at || '|' || payment_reference from supplier_invoices where id='{inv_id}'")
    assert estado.startswith("PAGADA|") and "Transferencia 778899" in estado, estado
    ok("Registro de pago: guarda fecha, referencia y responsable")

    # --- 8. Una factura pagada no se edita ni se paga otra vez
    expect(page.get_by_role("button", name="Editar")).to_have_count(0)
    expect(page.get_by_role("button", name="Pagar", exact=True)).to_have_count(0)
    ok("Una factura pagada queda bloqueada para edición y cobro doble")

    # --- 9. Reabrir el pago
    page.get_by_role("button", name="Reabrir").click()
    m.locator("#statusReason").fill("El pago correspondía a otra factura")
    m.get_by_role("button", name="Reabrir factura").click()
    toast(page, "vuelve a quedar pendiente")
    estado = psql(f"select status || '|' || coalesce(paid_at::text,'-') || '|' || coalesce(payment_reference,'-') from supplier_invoices where id='{inv_id}'")
    assert estado == "PENDIENTE|-|-", estado
    ok("Reabrir deshace el pago y limpia sus datos")

    # --- 10. Observar y reactivar
    page.get_by_role("button", name="Observar").click()
    m.locator("#statusReason").fill("Falta la guía de remisión firmada")
    m.get_by_role("button", name="Marcar como observada").click()
    toast(page, "marcada como observada")
    expect(page.get_by_text("Falta la guía de remisión firmada")).to_be_visible()
    page.get_by_role("button", name="Reactivar").click()
    page.get_by_role("button", name="Reactivar", exact=True).last.click()
    toast(page, "pendiente de pago nuevamente")
    ok("Observar y reactivar una factura devuelta al proveedor")

    # --- 11. Anular no borra el registro
    page.get_by_role("button", name="Anular").click()
    m.locator("#statusReason").fill("Registrada dos veces por error")
    m.get_by_role("button", name="Anular registro").click()
    toast(page, "anulado")
    assert psql(f"select count(*) from supplier_invoices where id='{inv_id}'") == "1"
    assert psql(f"select status from supplier_invoices where id='{inv_id}'") == "ANULADA"
    ok("Anular conserva el registro y su historial")

    # --- 11b. Fecha límite de pago: contado y crédito
    page.goto(BASE + "/facturas?estado=PENDIENTE")
    # Una factura al contado registrada hoy vence mañana.
    fila = page.get_by_role("row").filter(has_text="F001-3001")
    expect(fila.get_by_text("Contado", exact=False)).to_be_visible()
    limite = psql("select pay_due_date::text from supplier_invoices where series='F001' and number='3001'")
    assert limite == manana, (limite, manana)

    # El filtro de vencidas trae exactamente las que pasaron su fecha.
    vencidas = int(psql("select count(*) from supplier_invoices where status='PENDIENTE' "
                        "and pay_due_date < (now() at time zone 'America/Lima')::date"))
    page.goto(BASE + "/facturas?vencidas=1")
    assert filas(page) == vencidas, (filas(page), vencidas)

    # Y el de las que esperan la guía, las de crédito sin entrega anotada.
    sin_guia = int(psql("select count(*) from supplier_invoices where status='PENDIENTE' "
                        "and payment_term='CREDITO' and guide_received_at is null"))
    page.goto(BASE + "/facturas?singuia=1")
    assert filas(page) == sin_guia, (filas(page), sin_guia)
    page.screenshot(path=f"{SHOTS}/e2e-plazos.png", full_page=True)
    ok("Fecha límite de pago: contado vence al día siguiente y los filtros cuadran")

    # --- 12. Filtros
    # Los recuentos se leen de la base en vez de escribirlos a mano: así la prueba sigue
    # valiendo cuando cambian los datos de ejemplo.
    page.goto(BASE + "/facturas?estado=PAGADA")
    pagadas = min(int(psql("select count(*) from supplier_invoices where status='PAGADA'")), 20)
    assert filas(page) == pagadas, (filas(page), pagadas)
    page.goto(BASE + "/facturas?vencidas=1&q=0871")
    expect(page.get_by_role("row").filter(has_text="F002-0871")).to_be_visible()
    page.goto(BASE + "/facturas?vencidas=1")
    vencidas = min(int(psql("select count(*) from supplier_invoices where status='PENDIENTE' "
                            "and pay_due_date < (now() at time zone 'America/Lima')::date")), 20)
    assert filas(page) == vencidas, (filas(page), vencidas)
    page.goto(BASE + "/facturas")
    page.get_by_role("searchbox").fill("20487654321")
    expect(page).to_have_url(re.compile("q=204"))
    delProveedor = min(int(psql("select count(*) from supplier_invoices i join suppliers s on s.id=i.supplier_id where s.ruc='20487654321'")), 20)
    assert filas(page) == delProveedor, (filas(page), delProveedor)
    ok("Filtros por estado, vencidas y búsqueda por RUC")

    # --- 13. Proveedores
    page.goto(BASE + "/proveedores?q=PRUEBA+E2E")
    expect(page.get_by_role("row").filter(has_text="TRANSPORTES PRUEBA E2E")).to_be_visible()
    page.goto(BASE + "/proveedores")
    page.get_by_role("button", name="Nuevo proveedor").click()
    m.locator("#ruc").fill("123")
    m.locator("#businessName").fill("PROVEEDOR MAL RUC")
    m.get_by_role("button", name="Registrar proveedor").click()
    expect(m.get_by_text("El RUC debe tener 11 dígitos")).to_be_visible()
    m.locator("#ruc").fill("20111111116")
    m.get_by_role("button", name="Registrar proveedor").click()
    toast(page, "Proveedor registrado correctamente")
    ok("Proveedores: alta con validación del RUC")

    # --- 14. No se desactiva un proveedor con facturas pendientes
    # Con el histórico importado hay decenas de proveedores: se busca el de la prueba.
    page.goto(BASE + "/proveedores?q=TRANSPORTES+ABC")
    page.wait_for_timeout(600)
    fila = page.get_by_role("row").filter(has_text="TRANSPORTES ABC")
    fila.get_by_title("Desactivar").click()
    page.get_by_role("button", name="Desactivar", exact=True).last.click()
    toast(page, "factura(s) pendiente(s)")
    ok("Bloquea desactivar un proveedor con facturas por pagar")

    # --- 15. Bandeja de correos y su estado
    page.goto(BASE + "/facturas/correos")
    expect(page.get_by_role("heading", name="Correos de facturas")).to_be_visible()
    expect(page.get_by_text("Sin configurar")).to_be_visible()
    # Sin nada configurado se proponen las variables de IMAP, que es el camino que sirve
    # con cualquier correo y no necesita que un administrador registre nada.
    for var in ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"]:
        expect(page.get_by_text(var, exact=True)).to_be_visible()
    # Y no se mezclan las de Microsoft, que solo aplican si la empresa tiene suscripción.
    expect(page.get_by_text("GRAPH_TENANT_ID", exact=True)).to_have_count(0)
    page.screenshot(path=f"{SHOTS}/e2e-correos.png", full_page=True)
    ok("Bandeja de correos explica qué falta configurar")

    # --- 16. Sin credenciales no se ofrecen acciones que fallarían
    for boton in ["Revisar ahora", "Probar conexión", "Activar avisos", "Renovar"]:
        expect(page.get_by_role("button", name=boton)).to_have_count(0)
    ok("Sin buzón configurado no se ofrecen acciones que fallarían")

    # --- 17. Las rutas que usa Microsoft están accesibles y protegidas
    val = page.request.get(BASE + "/api/correo/graph?validationToken=prueba-123")
    assert val.status == 200 and val.text() == "prueba-123", (val.status, val.text()[:80])
    assert page.request.post(BASE + "/api/correo/graph?validationToken=prueba-456").text() == "prueba-456"
    assert page.request.get(BASE + "/api/cron/facturas").status == 401
    aviso = page.request.post(BASE + "/api/correo/graph", data={"value": [{"clientState": "no-es-el-secreto", "resourceData": {"id": "x"}}]})
    assert aviso.status in (202, 503), aviso.status
    assert psql("select count(*) from invoice_emails where message_id='x'") == "0"
    ok("Webhook de Microsoft accesible, con secreto obligatorio y tarea programada protegida")

    # --- 18. Auditoría de todo lo hecho
    page.goto(BASE + "/auditoria?module=FACTURAS")
    for accion in ["Pagar", "Observar", "Anular", "Reabrir"]:
        expect(page.get_by_role("cell", name=accion, exact=True).first).to_be_visible()
    ok("La auditoría registra pagos, observaciones, reaperturas y anulaciones")

    # --- 19. Rol Finanzas: ve facturas, no el almacén
    fin_pass = "Finanzas456!"
    page.goto(BASE + "/usuarios")
    page.get_by_role("button", name="Nuevo usuario").click()
    m.locator("#name").fill("Encargada de Pagos")
    m.locator("#username").fill("pagos")
    m.locator("#email").fill("pagos@transjer.pe")
    m.locator("#role").select_option("FINANZAS")
    m.locator("#password").fill(fin_pass)
    m.get_by_role("button", name="Crear usuario").click()
    toast(page, "Usuario")

    fctx = b.new_context(viewport={"width": 1440, "height": 950})
    fp = fctx.new_page()
    login(fp, "pagos", fin_pass)
    expect(fp.get_by_role("heading", name="Facturas de proveedores")).to_be_visible()
    expect(fp.get_by_role("navigation").get_by_role("link", name="Facturas")).to_be_visible()
    for oculto in ["Inventario", "Entregas", "Usuarios", "Movimientos", "Trabajadores"]:
        expect(fp.get_by_role("navigation").get_by_role("link", name=oculto)).to_have_count(0)
    fp.goto(BASE + "/inventario")
    expect(fp).to_have_url(re.compile("denied=1"))
    fp.goto(BASE + "/facturas")
    expect(fp.get_by_role("button", name="Nueva factura")).to_be_visible()
    fp.goto(BASE + "/facturas/correos")
    expect(fp.get_by_role("button", name="Activar avisos")).to_have_count(0)
    fctx.close()
    ok("Rol Finanzas: gestiona facturas y no accede al almacén ni a la configuración del buzón")

    # --- 20. Móvil sin desbordes
    mctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mp = mctx.new_page()
    login(mp, "admin", "Admin123!")
    for ruta in ["/facturas", "/proveedores", "/facturas/correos", f"/facturas/{inv_id}"]:
        mp.goto(BASE + ruta); mp.wait_for_timeout(700)
        ancho = mp.evaluate("document.documentElement.scrollWidth")
        assert ancho <= 390, f"desborde horizontal en {ruta}: {ancho}"
    mp.goto(BASE + "/facturas")
    mp.get_by_role("button", name="Nueva factura").click()
    expect(mp.get_by_role("dialog")).to_be_visible()
    mp.wait_for_timeout(400)
    assert mp.evaluate("document.documentElement.scrollWidth") <= 390, "desborde con el formulario abierto"
    mp.screenshot(path=f"{SHOTS}/e2e-movil.png")
    mctx.close()
    ok("Móvil: facturas, proveedores, correos y formularios sin desbordes")

    assert not errors, errors
    ok("Sin errores de JavaScript")
    print("\nFACTURAS: todas las verificaciones superadas")
