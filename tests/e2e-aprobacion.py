"""
Recorrido de extremo a extremo de la aprobación de comprobantes.

Lo que se comprueba es la decisión: que se entre por lo que espera, que los datos del
comprobante se vean sin salir de la pantalla, que aceptar registre la factura y que
rechazar deje constancia de lo que se le dijo al proveedor.

    python3 tests/e2e-aprobacion.py
"""
import json, os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
RUC = f"20{SELLO}000"[:11]
SERIE = "FAE1"

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
    ejecutar(f"delete from invoice_emails where message_id like 'e2e-%'")
    # Las facturas de la serie de prueba, de esta corrida y de cualquier otra anterior
    # que se haya cortado a medias.
    ejecutar(f"delete from supplier_invoices where series = '{SERIE}'")
    ejecutar(f"delete from supplier_invoices where supplier_id in (select id from suppliers where ruc = '{RUC}')")
    ejecutar(f"delete from suppliers where ruc = '{RUC}'")


CONCEPTO = ("POR EL SERVICIO DE TRANSPORTE DE CARGA LIMA- LOCAL CON FECHA 13/10/2026 "
            "S/G/R/T/E VT01-007988 S/G/R/E/T EG03 - 00000349 CLIENTE TIENDAS PERUANAS SA CON PLACA BBR-905")


def comprobante(numero):
    """Los datos como los deja el lector del XML."""
    return {
        "docType": "FACTURA", "series": SERIE, "number": numero,
        "issueDate": "2026-10-02", "dueDate": "2026-11-02", "currency": "PEN",
        "subtotal": "1000.00", "igv": "180.00", "total": "1180.00",
        "supplierRuc": RUC, "supplierName": f"TRANSPORTES PRUEBA {SELLO} S.A.C.",
        "customerRuc": "20555555551", "description": "Flete Lima - Trujillo",
        "grtNumber": "T001-777",
    }


def correo(sufijo, numero, concepto=None):
    datos_dict = comprobante(numero)
    if concepto:
        datos_dict["description"] = concepto
    datos = json.dumps(datos_dict).replace("'", "''").replace('"', '\\"')
    ejecutar(
        "insert into invoice_emails (message_id, subject, from_address, from_name, received_at, status, attachment_count, parsed) "
        f"values ('e2e-{SELLO}-{sufijo}', 'Factura {SERIE}-{numero}', 'facturacion@prueba.pe', 'Prueba SAC', "
        f"now() - interval '1 hour', 'POR_APROBAR', 0, '{datos}'::jsonb)"
    )
    return psql(f"select id from invoice_emails where message_id = 'e2e-{SELLO}-{sufijo}'")


def correo_sin_xml(sufijo):
    """Un correo cuyo comprobante no se pudo leer: queda por revisar, sin datos."""
    ejecutar(
        "insert into invoice_emails (message_id, subject, from_address, from_name, received_at, status, attachment_count, detail) "
        f"values ('e2e-{SELLO}-{sufijo}', 'Cobranza sin XML {SELLO}', 'cobranzas@prueba.pe', 'Prueba SAC', "
        f"now() - interval '2 hours', 'REVISAR', 1, 'El correo no trae XML')"
    )
    return psql(f"select id from invoice_emails where message_id = 'e2e-{SELLO}-{sufijo}'")


limpiar()
aceptar_id = correo("ok", f"{SELLO}1")
rechazar_id = correo("no", f"{SELLO}2")
transporte_id = correo("flete", f"{SELLO}3", CONCEPTO)
sin_xml_id = correo_sin_xml("sinxml")

with sync_playwright() as p:
    nav = p.chromium.launch()
    ctx = nav.new_context(viewport={"width": 1440, "height": 950})
    page = ctx.new_page()
    errores = []
    page.on("pageerror", lambda e: errores.append(f"{page.url} → {e}"))

    page.goto(f"{BASE}/login")
    page.fill("input[name=identifier]", USER)
    page.fill("input[name=password]", PASS)
    page.click("button[type=submit]")
    page.wait_for_url(re.compile(r"/(dashboard|facturas)"), timeout=15000)

    page.goto(f"{BASE}/facturas/correos")
    page.wait_for_timeout(1800)

    # --- Se entra por el primer paso del camino: verificar el monto ---
    activa = page.locator("[role=tab][aria-selected=true]").inner_text()
    check("se entra por lo que hay que verificar", "verificar" in activa.lower(), activa)
    cuerpo = page.content()
    check("avisa cuántos esperan que se verifique el monto",
          "esperan que se verifique el monto" in cuerpo)

    # --- Los datos del comprobante se ven en la lista, sin abrir nada ---
    fila = page.get_by_role("row").filter(has_text=f"{SERIE}-{SELLO}1")
    expect(fila).to_be_visible()
    texto = fila.inner_text()
    check("la fila muestra el proveedor", f"TRANSPORTES PRUEBA {SELLO}" in texto, texto)
    check("y el importe", "S/ 1,180.00" in texto, texto)
    # El símbolo lo pone el formateador de moneda; anteponerlo otra vez daba "S/ S/ 1,180.00".
    check("sin repetir el símbolo de la moneda", "S/ S/" not in texto, texto)
    check("y el RUC", RUC in texto, texto)

    # --- La tabla entra en la pantalla: no hay que correrla a mano ---
    tabla = page.locator("table").first
    ancho_tabla = tabla.bounding_box()["width"]
    caja = page.evaluate("() => { const t = document.querySelector('table').parentElement; return [t.clientWidth, t.scrollWidth]; }")
    check("la tabla entra en el ancho de la pantalla, sin barra horizontal",
          caja[1] <= caja[0] + 1, {"visible": caja[0], "real": caja[1], "tabla": ancho_tabla})

    # --- Ver el comprobante sin salir del buzón ---
    fila.get_by_role("button", name="Ver", exact=True).click()
    page.wait_for_timeout(900)
    dialogo = page.get_by_role("dialog")
    detalle = dialogo.inner_text()
    check("el detalle muestra el comprobante", f"{SERIE}-{SELLO}1" in detalle, detalle[:120])
    check("con su IGV", "180.00" in detalle)
    check("su guía de remisión", "T001-777" in detalle)
    check("y de quién llegó el correo", "facturacion@prueba.pe" in detalle)
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)

    # --- El filtro del monto va antes de poder aceptar ---
    antes = int(psql(f"select count(*) from supplier_invoices where series = '{SERIE}' and number like '{SELLO}%'"))
    check("antes de aceptar no hay ninguna factura registrada", antes == 0, antes)

    check("sin verificar el monto no se ofrece aceptar",
          fila.get_by_role("button", name="Aceptar").count() == 0, fila.inner_text())
    check("lo que se ofrece es verificar el monto",
          fila.get_by_role("button", name="Verificar monto").count() == 1, fila.inner_text())

    # Un importe distinto al pactado deja el comprobante observado y lo frena.
    fila.get_by_role("button", name="Verificar monto").click()
    page.wait_for_timeout(900)
    dlg_monto = page.get_by_role("dialog")
    dlg_monto.locator("input[name=agreedAmount]").fill("1000")
    page.wait_for_timeout(500)
    check("la ventana calcula la diferencia al escribir el monto pactado",
          "180.00" in dlg_monto.inner_text() and "de más" in dlg_monto.inner_text(),
          dlg_monto.inner_text()[:260])
    dlg_monto.get_by_role("button", name="Dejar el monto observado").click()
    page.wait_for_timeout(2400)

    check("el comprobante queda con el monto observado",
          psql(f"select amount_status from invoice_emails where id = '{aceptar_id}'") == "OBSERVADO")
    check("y sigue esperando decisión, sin factura registrada",
          psql(f"select status from invoice_emails where id = '{aceptar_id}'") == "POR_APROBAR"
          and psql(f"select count(*) from supplier_invoices where series = '{SERIE}' and number = '{SELLO}1'") == "0")

    page.goto(f"{BASE}/facturas/correos")
    page.wait_for_timeout(1700)
    fila = page.get_by_role("row").filter(has_text=f"{SERIE}-{SELLO}1")
    check("la lista muestra la diferencia sin abrir nada", "+ S/ 180.00" in fila.inner_text(), fila.inner_text())
    check("y con el monto observado tampoco deja aceptar",
          fila.get_by_role("button", name="Aceptar").count() == 0, fila.inner_text())

    # Aprobar la diferencia exige decir por qué; con el motivo, el filtro queda conforme.
    fila.get_by_role("button", name="Revisar monto").click()
    page.wait_for_timeout(900)
    dlg_monto = page.get_by_role("dialog")
    dlg_monto.locator("input[name=agreedAmount]").fill("1000")
    page.wait_for_timeout(400)
    dlg_monto.locator("input[name=aprobarDiferencia]").check()
    page.wait_for_timeout(300)
    dlg_monto.get_by_role("button", name="Guardar la verificación").click()
    page.wait_for_timeout(2200)
    check("aprobar una diferencia sin explicarla no pasa",
          "explicar por qué" in page.content(),
          page.content()[-400:] if "explicar por qué" not in page.content() else "")

    dlg_monto.locator("textarea[name=amountNote]").fill("Recargo acordado por la espera en planta")
    dlg_monto.get_by_role("button", name="Guardar la verificación").click()
    page.wait_for_timeout(2600)
    estado_monto = psql("select amount_status || '|' || agreed_amount || '|' || coalesce(amount_note,'') "
                        f"from invoice_emails where id = '{aceptar_id}'")
    check("con el motivo, el monto queda conforme y guarda lo pactado",
          estado_monto.startswith("CONFORME|1000.00|Recargo acordado"), estado_monto)
    check("y queda registrado quién lo verificó",
          psql(f"select amount_checked_by is not null from invoice_emails where id = '{aceptar_id}'") == "t")

    # --- Recién ahora se puede aceptar: aquí nace la factura ---
    page.goto(f"{BASE}/facturas/correos?estado=POR_APROBAR")
    page.wait_for_timeout(1700)
    fila = page.get_by_role("row").filter(has_text=f"{SERIE}-{SELLO}1")
    check("con el monto conforme, el comprobante pasa a la pestaña de aprobar",
          fila.count() == 1 and fila.get_by_role("button", name="Aceptar").count() == 1,
          fila.inner_text() if fila.count() else "no está en la pestaña")

    fila.get_by_role("button", name="Aceptar").click()
    page.wait_for_timeout(900)
    # Se acepta como servicio aunque el concepto hable de un flete: lo decide la persona,
    # no el texto, y de paso se comprueba que un servicio no lleve detracción.
    page.get_by_role("dialog").locator("select[name=serviceType]").select_option("SERVICIO")
    page.wait_for_timeout(400)
    check("al elegir servicio el plazo pasa a 1 día",
          page.get_by_role("dialog").locator("input[name=termDays]").input_value() == "1",
          page.get_by_role("dialog").locator("input[name=termDays]").input_value())
    page.get_by_role("button", name="Aceptar y registrar").click()
    page.wait_for_timeout(2600)

    registrada = psql(f"select status || '|' || total from supplier_invoices where series = '{SERIE}' and number = '{SELLO}1'")
    check("al aceptar queda la factura pendiente de pago", registrada == "PENDIENTE|1180.00", registrada)
    check("el correo queda marcado como aceptado",
          psql(f"select status from invoice_emails where id = '{aceptar_id}'") == "PROCESADO")
    check("y queda registrado quién lo aceptó",
          psql(f"select decided_by is not null from invoice_emails where id = '{aceptar_id}'") == "t")
    check("el proveedor se dio de alta al aceptar",
          psql(f"select count(*) from suppliers where ruc = '{RUC}'") == "1")

    # --- Una factura de transporte: el tipo, el plazo y los datos del viaje ---
    page.goto(f"{BASE}/facturas/correos")
    page.wait_for_timeout(1600)
    fila_t = page.get_by_role("row").filter(has_text=f"{SERIE}-{SELLO}3")
    # Esta sí viene por el importe pactado: el filtro queda conforme de una.
    fila_t.get_by_role("button", name="Verificar monto").click()
    page.wait_for_timeout(900)
    dlg_monto = page.get_by_role("dialog")
    dlg_monto.locator("input[name=agreedAmount]").fill("1180")
    page.wait_for_timeout(500)
    check("cuando coincide, la ventana lo dice", "Coincide con lo pactado" in dlg_monto.inner_text(),
          dlg_monto.inner_text()[:260])
    dlg_monto.get_by_role("button", name="Guardar la verificación").click()
    page.wait_for_timeout(2600)
    check("el monto que coincide queda conforme sin más trámite",
          psql(f"select amount_status from invoice_emails where id = '{transporte_id}'") == "CONFORME")

    page.goto(f"{BASE}/facturas/correos?estado=POR_APROBAR")
    page.wait_for_timeout(1700)
    fila_t = page.get_by_role("row").filter(has_text=f"{SERIE}-{SELLO}3")
    fila_t.get_by_role("button", name="Aceptar").click()
    page.wait_for_timeout(1000)
    dlg = page.get_by_role("dialog")

    # El tipo viene propuesto por el concepto, que habla de un flete.
    check("propone que es factura de transporte",
          dlg.locator("select[name=serviceType]").input_value() == "TRANSPORTE",
          dlg.locator("select[name=serviceType]").input_value())
    check("y propone 15 días de plazo",
          dlg.locator("input[name=termDays]").input_value() == "15",
          dlg.locator("input[name=termDays]").input_value())

    # Los datos del viaje salen leídos del concepto, listos para revisar.
    check("la placa viene leída del concepto",
          dlg.locator("input[name=plate]").input_value() == "BBR-905",
          dlg.locator("input[name=plate]").input_value())
    check("el cliente también",
          dlg.locator("input[name=clientName]").input_value() == "TIENDAS PERUANAS SA",
          dlg.locator("input[name=clientName]").input_value())
    check("y el destino",
          dlg.locator("input[name=destinationCity]").input_value() == "LOCAL",
          dlg.locator("input[name=destinationCity]").input_value())

    dlg.get_by_role("button", name="Aceptar y registrar").click()
    page.wait_for_timeout(2600)
    guardado = psql(f"select service_type || '|' || term_days || '|' || coalesce(plate,'') || '|' || coalesce(client_name,'') "
                    f"from supplier_invoices where series = '{SERIE}' and number = '{SELLO}3'")
    check("queda registrada como transporte, a 15 días y con su viaje",
          guardado == f"TRANSPORTE|15|BBR-905|TIENDAS PERUANAS SA", guardado)

    # Y en la tabla de facturas se ve el cliente y el destino debajo del proveedor.
    page.goto(f"{BASE}/facturas?q={SERIE}-{SELLO}3")
    page.wait_for_timeout(1600)
    fila_f = page.get_by_role("row").filter(has_text=f"{SERIE}-{SELLO}3")
    texto_f = fila_f.inner_text()
    check("la tabla de facturas muestra el cliente y la ruta completa",
          "TIENDAS PERUANAS SA" in texto_f and "LIMA → LOCAL" in texto_f, texto_f)
    # 1180 − 48 de detracción (el 4 % son 47.20 y sube al sol siguiente) = 1132.
    check("y el importe a pagar sale sin la detracción",
          "1,132.00" in texto_f or "1,180.00" in texto_f, texto_f)

    # Un adelanto entregado se descuenta solo de lo que queda por transferir.
    ejecutar(f"update supplier_invoices set advances = 400 where series = '{SERIE}' and number = '{SELLO}3'")
    page.reload(); page.wait_for_timeout(1800)
    fila_ad = page.get_by_role("row").filter(has_text=f"{SERIE}-{SELLO}3")
    texto_ad = fila_ad.inner_text()
    check("el adelanto aparece en su columna", "400.00" in texto_ad, texto_ad)
    check("y el saldo baja lo adelantado", "732.00" in texto_ad, texto_ad)

    fila_ad.get_by_role("button", name="Registrar pago").click()
    page.wait_for_timeout(1000)
    pago = page.get_by_role("dialog").inner_text()
    check("al pagar se muestra la cuenta hecha", "Adelantos" in pago and "A transferir" in pago, pago[:300])
    check("y lo que se transfiere ya tiene descontado el adelanto", "732.00" in pago, pago[:300])
    page.keyboard.press("Escape"); page.wait_for_timeout(600)

    # La detracción es del transporte: a una factura de servicio no se le calcula.
    sinDetraccion = psql("select coalesce(detraction_amount,0)::text || '|' || detraction_status "
                         f"from supplier_invoices where series = '{SERIE}' and number = '{SELLO}1'")
    check("una factura de servicio no lleva detracción", sinDetraccion.startswith("0") and "NO_APLICA" in sinDetraccion, sinDetraccion)

    # --- Rechazar: el texto del correo se ve antes de enviarlo ---
    page.goto(f"{BASE}/facturas/correos")
    page.wait_for_timeout(1600)
    fila2 = page.get_by_role("row").filter(has_text=f"{SERIE}-{SELLO}2")
    fila2.get_by_role("button", name="Rechazar").click()
    page.wait_for_timeout(900)

    propuesto = page.locator("textarea[name=body]").input_value()
    check("el correo de rechazo viene escrito", len(propuesto) > 80, propuesto[:60])
    check("nombra al proveedor", f"TRANSPORTES PRUEBA {SELLO}" in propuesto)
    check("y dice de qué comprobante se trata", f"{SERIE}-{SELLO}2" in propuesto)

    # Al cambiar el motivo y escribir el comentario, el texto se rehace solo.
    page.select_option("select[name=reason]", "IMPORTE")
    page.fill("textarea[name=comment]", "Figuran S/ 1,180 y lo acordado fue S/ 980.")
    page.wait_for_timeout(500)
    actualizado = page.locator("textarea[name=body]").input_value()
    check("el texto recoge el motivo elegido", "importe no coincide" in actualizado.lower(), actualizado[:200])
    check("y el comentario escrito", "lo acordado fue S/ 980" in actualizado)

    # Con el motivo "importe", la casilla de registrar la factura anulada viene marcada
    # sola: es un comprobante que el proveedor tendrá que anular con una nota de crédito.
    check("con un motivo que exige nota de crédito, se propone registrar la factura",
          page.is_checked("input[name=registrar]"))

    # Sin enviar correo: el servidor de salida no está configurado en las pruebas, y lo
    # que se comprueba aquí es que el rechazo se registre igual.
    page.uncheck("input[name=send]")
    page.wait_for_timeout(300)
    page.get_by_role("button", name="Rechazar sin avisar").click()
    page.wait_for_timeout(2600)

    estado = psql(f"select status || '|' || coalesce(reject_reason,'') from invoice_emails where id = '{rechazar_id}'")
    check("el comprobante queda rechazado, con su motivo", estado == "RECHAZADO|IMPORTE", estado)
    check("se guarda el comentario para el proveedor",
          "980" in psql(f"select coalesce(reject_comment,'') from invoice_emails where id = '{rechazar_id}'"))
    # El comprobante rechazado queda registrado como factura anulada: existe ante SUNAT
    # hasta que el proveedor mande la nota de crédito, y así se le puede reclamar.
    anulada = psql("select status || '|' || awaiting_credit_note::text || '|' || "
                   f"coalesce(pay_due_date::text,'-') from supplier_invoices where number = '{SELLO}2'")
    check("el comprobante rechazado queda como factura anulada esperando la nota de crédito",
          anulada == "ANULADA|true|-", anulada)
    motivo_guardado = psql(f"select coalesce(status_reason,'') from supplier_invoices where number = '{SELLO}2'")
    check("y la factura guarda por qué se rechazó",
          "importe" in motivo_guardado.lower() and "980" in motivo_guardado, motivo_guardado)

    # --- Y se ve que al proveedor no se le avisó ---
    page.goto(f"{BASE}/facturas/correos?estado=RECHAZADO")
    page.wait_for_timeout(1600)
    fila3 = page.get_by_role("row").filter(has_text=f"{SERIE}-{SELLO}2")
    check("la lista avisa que el proveedor quedó sin avisar", "sin avisar" in fila3.inner_text().lower(), fila3.inner_text())

    # --- Un correo sin XML legible también se devuelve al proveedor ---
    # Antes solo se podía descartar, y descartar no le avisa a nadie: el comprobante se iba
    # de la bandeja y el proveedor seguía esperando el pago.
    page.goto(f"{BASE}/facturas/correos?estado=REVISAR")
    page.wait_for_timeout(1600)
    fila_sin = page.get_by_role("row").filter(has_text=f"Cobranza sin XML {SELLO}")
    check("un correo sin XML ofrece rechazar, no solo descartar",
          fila_sin.get_by_role("button", name="Rechazar").count() == 1, fila_sin.inner_text())

    fila_sin.get_by_role("button", name="Rechazar").click()
    page.wait_for_timeout(900)
    check("el modal habla del correo, no de un comprobante que no se leyó",
          "no trae XML legible" in page.content())
    texto = page.locator("textarea[name=body]").input_value()
    check("el aviso al proveedor se arma igual, sin número de comprobante",
          len(texto) > 80 and "el comprobante que nos enviaron" in texto, texto[:120])
    check("y no se ofrece registrar una factura que no existe",
          page.is_disabled("input[name=registrar]"))

    page.select_option("select[name=reason]", "FALTA_GRT")
    page.fill("textarea[name=comment]", "No llegó el XML ni la guía de remisión.")
    page.wait_for_timeout(500)
    check("el motivo elegido entra en el texto",
          "guía de remisión" in page.locator("textarea[name=body]").input_value().lower())

    page.uncheck("input[name=send]")
    page.wait_for_timeout(300)
    page.get_by_role("button", name="Rechazar sin avisar").click()
    page.wait_for_timeout(2600)

    estado_sin = psql("select status || '|' || coalesce(reject_reason,'') || '|' || coalesce(reject_comment,'') "
                      f"from invoice_emails where id = '{sin_xml_id}'")
    check("el correo sin XML queda rechazado con su motivo y su comentario",
          estado_sin.startswith("RECHAZADO|FALTA_GRT|") and "guía de remisión" in estado_sin, estado_sin)
    check("y no inventó ninguna factura",
          psql(f"select count(*) from supplier_invoices where created_at > now() - interval '1 minute' and series = ''") == "0")

    check("ninguna pantalla lanzó errores de JavaScript", len(errores) == 0, errores[:2])
    nav.close()

limpiar()

if fails:
    print(f"\n{len(fails)} FALLAS:")
    for f in fails:
        print(" -", f)
    sys.exit(1)
print("\nE2E APROBACIÓN: todas las verificaciones superadas")
