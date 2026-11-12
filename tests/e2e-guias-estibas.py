"""
Guías de las facturas de transporte, viajes de terceros y varias estibas por cliente.

  - Una factura de transporte nace con sus guías por llegar (una por cada número escrito)
    y aparece en Salidas > Viajes de terceros, esperando guía y sin fecha de pago.
  - Cuando llega la última guía, la factura vence 15 días después. Se pueden anotar de a
    una, agregar las que faltaban, quitar una mal escrita y deshacer una llegada.
  - Un cliente de provincia puede tener varias estibas; la más barata se marca sola.

    python3 tests/e2e-guias-estibas.py
"""
import datetime, os, re, subprocess, time
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=15000)
BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
PROVEEDOR = f"Transportes Guias {SELLO} SAC"
RUC = f"20{SELLO}555"
CLIENTE_PROV = f"Distribuidora Estibas {SELLO}"
G1, G2, G3 = f"T001-{SELLO}1", f"T001-{SELLO}2", f"T001-{SELLO}3"

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
    ejecutar("delete from supplier_invoices where supplier_id in (select id from suppliers where business_name like 'Transportes Guias %')")
    ejecutar("delete from suppliers where business_name like 'Transportes Guias %'")
    ejecutar("delete from province_clients where client_name like 'Distribuidora Estibas %'")


hoy = psql("select (now() at time zone 'America/Lima')::date")
mas15 = (datetime.date.fromisoformat(hoy) + datetime.timedelta(days=15)).isoformat()
hoy_es = datetime.date.fromisoformat(hoy).strftime("%d/%m/%Y")
FACT = f"F001-{SELLO}"
estado = lambda: psql(f"select payment_term || '|' || term_days || '|' || coalesce(guide_received_at::text, '-') || '|' || coalesce(pay_due_date::text, '-') "
                      f"from supplier_invoices where series = 'F001' and number = '{SELLO}'")
guias = lambda: psql(f"select string_agg(coalesce(g.number, 'SIN') || ':' || coalesce(g.received_at::text, '-'), ',' order by g.number) "
                     f"from invoice_guides g join supplier_invoices i on i.id = g.invoice_id where i.number = '{SELLO}'")

limpiar()
ejecutar(f"insert into suppliers (business_name, ruc) values ('{PROVEEDOR}', '{RUC}')")

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

    # ====================== Factura de transporte con dos guías ======================
    page.goto(f"{BASE}/facturas"); page.wait_for_timeout(1200)
    page.get_by_role("button", name="Nueva factura").click(); page.wait_for_timeout(500)
    m = page.locator("[role=dialog]")
    m.locator("#supplierId").select_option(psql(f"select id from suppliers where ruc = '{RUC}'"))
    m.locator("select[name=serviceType]").select_option("TRANSPORTE"); page.wait_for_timeout(300)
    check("al elegir transporte, el formulario explica la regla de las guías y no pide condición",
          "15 días después de" in m.inner_text() and m.locator("select[name=paymentTerm]").count() == 0)
    m.locator("#series").fill("F001"); m.locator("#number").fill(SELLO)
    m.locator("#issueDate").fill(hoy_es)
    m.locator("#receivedDate").fill(hoy_es)
    m.locator("#total").fill("1180")
    m.locator("#grtNumber").fill(f"{G1} / {G2}")
    m.get_by_role("button", name="Registrar factura").click(); page.wait_for_timeout(2500)
    check("la factura se registra a crédito de 15 días, sin fecha de pago", estado() == "CREDITO|15|-|-", estado())
    check("con sus dos guías por llegar", guias() == f"{G1}:-,{G2}:-", guias())

    # --- Salidas > Viajes de terceros ---
    page.goto(f"{BASE}/salidas"); page.wait_for_timeout(1200)
    boton = page.get_by_role("link", name=re.compile("Viajes de terceros"))
    check("Salidas tiene el botón Viajes de terceros, con cuántas esperan guía",
          boton.count() == 1 and "esperando guía" in boton.inner_text(), boton.inner_text() if boton.count() else "")
    boton.click(); page.wait_for_url(re.compile("vista=terceros")); page.wait_for_timeout(1200)
    cabecera = page.locator("thead").inner_text()
    check("las columnas son las del viaje, sin factura ni pago",
          all(c in cabecera for c in ["Día de servicio", "Placa", "Transportista", "Cliente", "Origen", "Destino", "Guías"])
          and "Factura" not in cabecera and "Pago" not in cabecera, cabecera)
    fila = page.locator("tbody tr").filter(has_text=G1)
    check("la factura aparece como viaje, esperando guía",
          fila.count() == 1 and PROVEEDOR in fila.inner_text(),
          fila.inner_text() if fila.count() else page.locator("tbody").inner_text()[:300])
    check("con cada guía por llegar", fila.inner_text().count("por llegar") == 2)

    # Llega solo la primera
    fila.get_by_role("button", name=re.compile("Llegó la guía|Anotar que llegaron")).click(); page.wait_for_timeout(500)
    d = page.locator("[role=dialog]")
    d.locator(f"label:has-text('{G2}') input[type=checkbox]").uncheck()
    d.get_by_role("button", name="Anotar llegada").click(); page.wait_for_timeout(2200)
    check("con una sola guía, la factura sigue sin fecha de pago", estado() == "CREDITO|15|-|-", estado())
    check("pero esa guía queda llegada", guias() == f"{G1}:{hoy},{G2}:-", guias())

    # Llega la última
    page.reload(); page.wait_for_timeout(1200)
    fila = page.locator("tbody tr").filter(has_text=G1)
    fila.get_by_role("button", name=re.compile("Llegó la guía|Anotar que llegaron")).click(); page.wait_for_timeout(500)
    page.locator("[role=dialog]").get_by_role("button", name="Anotar llegada").click(); page.wait_for_timeout(2200)
    check("cuando llega la última, vence 15 días después", estado() == f"CREDITO|15|{hoy}|{mas15}", estado())
    check("y deja de figurar como esperando guía",
          page.locator("tbody tr").filter(has_text=G1).count() == 0)
    page.goto(f"{BASE}/salidas?vista=terceros&estado=POR_PAGAR"); page.wait_for_timeout(1200)
    fila = page.locator("tbody tr").filter(has_text=G1)
    check("pasa a las de guías completas", fila.count() == 1 and fila.inner_text().count("llegó") == 2,
          fila.inner_text() if fila.count() else "")

    # --- En la ficha de la factura ---
    fid = psql(f"select id from supplier_invoices where number = '{SELLO}'")
    page.goto(f"{BASE}/facturas/{fid}"); page.wait_for_timeout(1500)
    panel = page.locator("section", has=page.get_by_role("heading", name="Guías"))
    check("la ficha tiene el recuadro de guías", panel.count() == 1 and "Llegaron todas las guías" in panel.inner_text())

    # Agregar una guía que faltaba: la factura vuelve a esperar
    panel.get_by_role("button", name="Agregar una guía").click(); page.wait_for_timeout(500)
    page.locator("[role=dialog] input[name=numero]").fill(G3)
    page.locator("[role=dialog]").get_by_role("button", name="Agregar").click(); page.wait_for_timeout(2200)
    check("al agregar una guía por llegar, la factura vuelve a esperarla", estado() == "CREDITO|15|-|-", estado())

    # Quitarla (se había anotado por error)
    page.reload(); page.wait_for_timeout(1300)
    panel = page.locator("section", has=page.get_by_role("heading", name="Guías"))
    panel.get_by_role("button", name=f"Quitar la guía {G3}").click(); page.wait_for_timeout(400)
    page.locator("[role=dialog]").get_by_role("button", name="Quitar").click(); page.wait_for_timeout(2200)
    check("al quitarla, vuelve a vencer con la última que llegó", estado() == f"CREDITO|15|{hoy}|{mas15}", estado())

    # Deshacer una llegada
    page.reload(); page.wait_for_timeout(1300)
    panel = page.locator("section", has=page.get_by_role("heading", name="Guías"))
    panel.get_by_role("button", name=f"Deshacer la llegada de {G2}").click(); page.wait_for_timeout(400)
    page.locator("[role=dialog]").get_by_role("button", name="Deshacer").click(); page.wait_for_timeout(2200)
    check("al deshacer una llegada, la factura vuelve a esperar", estado() == "CREDITO|15|-|-" and guias() == f"{G1}:{hoy},{G2}:-",
          (estado(), guias()))
    check("todo queda en auditoría",
          int(psql(f"select count(*) from audit_logs where module = 'FACTURAS' and description like '%{FACT}%' and description like '%guía%'")) >= 4)

    # Una factura de transporte sin número de guía igual espera una
    ejecutar(f"delete from supplier_invoices where number = '{SELLO}'")
    page.goto(f"{BASE}/facturas"); page.wait_for_timeout(1200)
    page.get_by_role("button", name="Nueva factura").click(); page.wait_for_timeout(500)
    m = page.locator("[role=dialog]")
    m.locator("#supplierId").select_option(psql(f"select id from suppliers where ruc = '{RUC}'"))
    m.locator("select[name=serviceType]").select_option("TRANSPORTE"); page.wait_for_timeout(300)
    m.locator("#series").fill("F001"); m.locator("#number").fill(SELLO)
    m.locator("#issueDate").fill(hoy_es); m.locator("#receivedDate").fill(hoy_es)
    m.locator("#total").fill("800")
    m.get_by_role("button", name="Registrar factura").click(); page.wait_for_timeout(2500)
    check("sin número de guía, nace con una guía sin número por llegar", guias() == "SIN:-" and estado() == "CREDITO|15|-|-",
          (guias(), estado()))

    # ====================== Varias estibas ======================
    page.goto(f"{BASE}/clientes-provincia"); page.wait_for_timeout(1200)
    page.get_by_role("button", name="Nuevo cliente").click(); page.wait_for_timeout(500)
    d = page.locator("[role=dialog]")
    d.locator("input[name=province]").fill("Chiclayo")
    d.locator("input[name=clientName]").fill(CLIENTE_PROV)
    d.locator("input[name=estiba_nombre]").nth(0).fill("Estiba Norte")
    d.locator("input[name=estiba_telefono]").nth(0).fill("976111222")
    d.locator("input[name=estiba_costo]").nth(0).fill("45")
    d.get_by_role("button", name="Agregar otra estiba").click()
    d.locator("input[name=estiba_nombre]").nth(1).fill("Estiba Sur")
    d.locator("input[name=estiba_costo]").nth(1).fill("35.50")
    d.locator("input[name=estiba_nota]").nth(1).fill("trae 4 personas")
    check("el formulario marca sola la más barata", "La más barata" in d.inner_text())
    d.get_by_role("button", name="Agregar otra estiba").click()
    d.locator("input[name=estiba_costo]").nth(2).fill("abc")
    d.get_by_role("button", name="Registrar cliente").click(); page.wait_for_timeout(1500)
    check("un costo mal escrito se marca y no se guarda nada",
          psql(f"select count(*) from province_clients where client_name = '{CLIENTE_PROV}'") == "0")
    d.get_by_role("button", name="Quitar la estiba 3").click()
    d.get_by_role("button", name="Registrar cliente").click(); page.wait_for_timeout(2200)
    cid = psql(f"select id from province_clients where client_name = '{CLIENTE_PROV}'")
    check("el cliente queda con sus dos estibas",
          psql(f"select string_agg(name || ':' || coalesce(cost_per_ton::text, '-'), ',' order by position) from province_client_stevedores where province_client_id = '{cid}'")
          == "Estiba Norte:45.00,Estiba Sur:35.50")
    check("y la ficha guarda la más barata como principal",
          psql(f"select stevedore_name || '|' || cost_per_ton from province_clients where id = '{cid}'") == "Estiba Sur|35.50")
    page.goto(f"{BASE}/clientes-provincia?q={SELLO}"); page.wait_for_timeout(1200)
    fila = page.locator("tbody tr").filter(has_text=CLIENTE_PROV)
    check("la tabla muestra las dos, con la más barata marcada y el rango de precios",
          "Estiba Norte" in fila.inner_text() and "Estiba Sur" in fila.inner_text() and "La más barata" in fila.inner_text()
          and "35.50" in fila.inner_text() and "45.00" in fila.inner_text(), fila.inner_text())
    page.goto(f"{BASE}/clientes-provincia?q=Estiba Norte"); page.wait_for_timeout(1200)
    check("se puede buscar por cualquiera de sus estibas",
          page.locator("tbody tr").filter(has_text=CLIENTE_PROV).count() == 1)

    # Editar: quitar la más barata
    page.goto(f"{BASE}/clientes-provincia?q={SELLO}"); page.wait_for_timeout(1200)
    page.locator("tbody tr").filter(has_text=CLIENTE_PROV).get_by_role("button", name=re.compile("Editar")).click()
    page.wait_for_timeout(500)
    d = page.locator("[role=dialog]")
    check("al editar, salen las dos estibas", d.locator("input[name=estiba_nombre]").count() == 2)
    d.get_by_role("button", name="Quitar la estiba 2").click()
    d.get_by_role("button", name="Guardar cambios").click(); page.wait_for_timeout(2200)
    check("al quitar una, queda la otra como principal",
          psql(f"select count(*) from province_client_stevedores where province_client_id = '{cid}'") == "1"
          and psql(f"select stevedore_name || '|' || cost_per_ton from province_clients where id = '{cid}'") == "Estiba Norte|45.00")

    # --- En el celular ---
    movil = nav.new_page(viewport={"width": 390, "height": 844})
    movil.context.add_cookies(page.context.cookies())
    for ruta in ["/salidas?vista=terceros&estado=TODAS", "/clientes-provincia"]:
        movil.goto(f"{BASE}{ruta}"); movil.wait_for_timeout(1500)
        ancho = movil.evaluate("document.documentElement.scrollWidth")
        check(f"en el celular {ruta} no se sale de ancho", ancho <= 400, ancho)

    check("sin errores de JavaScript", not errores, errores[:3])
    nav.close()

limpiar()
print("\n" + ("Todo en orden." if not fails else f"{len(fails)} FALLAS: {fails}"))
raise SystemExit(1 if fails else 0)
