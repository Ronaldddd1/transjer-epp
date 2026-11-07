"""
Limpieza de datos que vinieron del Excel, y la deuda total de Finanzas.

  - Unir dos proveedores que son el mismo escrito de otra manera: las facturas pasan al
    correcto, se le completa el RUC y el duplicado desaparece. Si los dos tienen la
    misma factura, no se une y se dice cuál.
  - Destinos: "BARRANCA", "barranca" y "Barranca " son uno solo en el filtro, se unifican
    de una vez, y renombrar uno con el nombre de otro los junta. (Que una factura nueva
    tome la escritura que ya existe lo prueba tests/destinos.test.ts.)
  - La deuda pendiente total sale en todos los tipos de Finanzas, no solo en préstamos.

    python3 tests/e2e-limpieza.py
"""
import os, re, subprocess, time
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=15000)
BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
RUC = f"20{SELLO}987"
BIEN = f"Transportes Limpieza {SELLO} S.A.C."
MAL = f"TRANSPORTES LIMPIEZA {SELLO} SAC"
OTRO = f"Transportes  Limpieza {SELLO}"
DESTINO = f"Barranca{SELLO}"

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
    ejecutar("delete from supplier_invoices where supplier_id in (select id from suppliers where business_name ilike 'transportes%limpieza%')")
    ejecutar("delete from suppliers where business_name ilike 'transportes%limpieza%'")


def factura(proveedor, serie, numero, destino="NULL"):
    ejecutar(f"insert into supplier_invoices (supplier_id, series, number, issue_date, total, destination_city) "
             f"select id, '{serie}', '{numero}', current_date, 500, {destino} from suppliers where business_name = '{proveedor}'")


limpiar()
ejecutar(f"insert into suppliers (business_name, ruc) values ('{BIEN}', '{RUC}')")
ejecutar(f"insert into suppliers (business_name, email) values ('{MAL}', 'pagos@limpieza.test')")
factura(BIEN, "F001", f"9{SELLO}", f"'BARRANCA{SELLO}'")
factura(MAL, "F001", f"8{SELLO}", f"'barranca{SELLO}'")
factura(MAL, "F002", f"7{SELLO}", f"'Barranca{SELLO} '")

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

    # --- La deuda total de Finanzas ---
    page.goto(f"{BASE}/obligaciones"); page.wait_for_timeout(1800)
    cuerpo = page.locator("body").inner_text()
    paneles = page.locator("section h2, [data-panel] h2").count()
    check("arriba está la deuda pendiente total de todo Finanzas", "Deuda pendiente total, de todo Finanzas" in cuerpo)
    tipos_con_filas = int(psql("select count(distinct type) from obligations"))
    check("y cada tipo dice su deuda pendiente total, no solo préstamos",
          cuerpo.lower().count("deuda pendiente total") >= tipos_con_filas + 1,
          (cuerpo.lower().count("deuda pendiente total"), tipos_con_filas))

    # --- Destinos: uno solo en el filtro ---
    page.goto(f"{BASE}/facturas"); page.wait_for_timeout(1500)
    opciones = page.locator("label", has_text="Destino").locator("select option").all_inner_texts()
    variantes = [o for o in opciones if o.strip().lower() == f"barranca{SELLO}"]
    check("las tres escrituras salen una sola vez en el filtro de destino", len(variantes) == 1, variantes)
    page.goto(f"{BASE}/facturas?destino=barranca{SELLO}"); page.wait_for_timeout(1500)
    filas = page.locator("tbody tr").filter(has_text=re.compile(f"(9|8|7){SELLO}"))
    check("filtrar por destino trae las tres facturas, escritas como sea", filas.count() == 3, filas.count())

    # --- La pantalla de limpiar destinos ---
    page.goto(f"{BASE}/facturas"); page.wait_for_timeout(1200)
    page.get_by_role("link", name="Limpiar destinos").click()
    page.wait_for_url(re.compile("/facturas/destinos"), timeout=15000); page.wait_for_timeout(1200)
    fila = page.get_by_role("row").filter(has_text=f"BARRANCA{SELLO}").first
    check("la pantalla muestra el destino con sus tres escrituras",
          fila.inner_text().lower().count(f"barranca{SELLO}") >= 3, fila.inner_text())
    page.get_by_role("button", name=re.compile("Unificar todos")).click(); page.wait_for_timeout(500)
    page.locator("[role=dialog]").get_by_role("button", name="Unificar").click(); page.wait_for_timeout(2500)
    escrituras = psql(f"select string_agg(distinct destination_city, '|') from supplier_invoices where destination_city ilike '%barranca{SELLO}%'")
    check("unificar deja una sola escritura, la más usada... o la primera si empatan", "|" not in escrituras and escrituras.strip() == escrituras, escrituras)

    # Renombrar sirve también para juntar con otro destino
    factura(BIEN, "F003", f"6{SELLO}", f"'Barranca{SELLO} - Lima'")
    page.reload(); page.wait_for_timeout(1200)
    page.get_by_role("row").filter(has_text=f"Barranca{SELLO} - Lima").get_by_role("button", name=re.compile("Renombrar")).click()
    page.wait_for_timeout(500)
    page.locator("[role=dialog] input[name=final]").fill(f"barranca{SELLO}")
    page.locator("[role=dialog]").get_by_role("button", name="Guardar").click(); page.wait_for_timeout(2200)
    check("renombrar con el nombre de otro destino los junta, con la escritura que ya existía",
          psql(f"select count(distinct destination_city) || '|' || min(destination_city) from supplier_invoices where destination_city ilike '%barranca{SELLO}%'")
          == f"1|{escrituras}", psql(f"select string_agg(distinct destination_city, '|') from supplier_invoices where destination_city ilike '%barranca{SELLO}%'"))

    # --- Proveedores: el duplicado se sugiere y se une ---
    page.goto(f"{BASE}/proveedores"); page.wait_for_timeout(1500)
    aviso = page.locator("details", has_text="parecen estar registrados dos veces")
    check("se sugiere unir los dos nombres del mismo proveedor",
          aviso.count() == 1 and BIEN in aviso.inner_text() and MAL in aviso.inner_text())
    item = aviso.locator("li", has_text=BIEN)
    cuenta = lambda nombre: psql(f"select count(*) from supplier_invoices i join suppliers s on s.id = i.supplier_id where s.business_name = '{nombre}'")
    check("y dice cuántas facturas tiene cada uno, como la base",
          f"{cuenta(BIEN)} factura(s)" in item.locator("p").first.inner_text()
          and f"{cuenta(MAL)} factura(s)" in item.locator("div", has_text=MAL).first.inner_text(),
          (item.inner_text(), cuenta(BIEN), cuenta(MAL)))
    check("propone conservar el que tiene RUC", item.locator("p").first.inner_text().startswith(f"Se queda {BIEN}"),
          item.locator("p").first.inner_text())
    item.get_by_role("button", name="Unir").click(); page.wait_for_timeout(600)
    dialogo = page.locator("[role=dialog]")
    check("el modal ya trae elegido el correcto", BIEN in dialogo.locator("select[name=destinoId] option:checked").inner_text())
    dialogo.get_by_role("button", name="Unir y pasar las facturas").click(); page.wait_for_timeout(2500)
    check("las facturas del duplicado pasan al correcto",
          psql(f"select count(*) from supplier_invoices i join suppliers s on s.id = i.supplier_id where s.business_name = '{BIEN}'") == "4")
    check("el duplicado desaparece", psql(f"select count(*) from suppliers where business_name = '{MAL}'") == "0")
    check("y al correcto se le pasa el correo que solo tenía el duplicado",
          psql(f"select email from suppliers where business_name = '{BIEN}'") == "pagos@limpieza.test")
    check("queda en auditoría",
          psql(f"select count(*) from audit_logs where module = 'PROVEEDORES' and description like '%unió%{MAL}%'") == "1")

    # --- Si los dos tienen la misma factura, no se une ---
    ejecutar(f"insert into suppliers (business_name) values ('{OTRO}')")
    factura(OTRO, "F001", f"9{SELLO}")
    page.goto(f"{BASE}/proveedores?q={SELLO}"); page.wait_for_timeout(1500)
    fila = page.get_by_role("row").filter(has_text=OTRO.replace("  ", " ")).first
    if fila.count() == 0:
        fila = page.locator("tbody tr").filter(has_text=f"Limpieza {SELLO}").filter(has_not_text="S.A.C.").first
    fila.get_by_role("button", name="Unir con otro proveedor").click(); page.wait_for_timeout(600)
    dialogo = page.locator("[role=dialog]")
    dialogo.locator("select[name=destinoId]").select_option(label=f"{BIEN} · RUC {RUC}")
    dialogo.get_by_role("button", name="Unir y pasar las facturas").click(); page.wait_for_timeout(2200)
    check("con una factura repetida no se une", psql(f"select count(*) from suppliers where business_name = '{OTRO}'") == "1")
    check("y dice cuál es la repetida", f"F001-9{SELLO}" in page.locator("body").inner_text())

    check("sin errores de JavaScript", not errores, errores[:3])
    nav.close()

limpiar()
print("\n" + ("Todo en orden." if not fails else f"{len(fails)} FALLAS: {fails}"))
raise SystemExit(1 if fails else 0)
