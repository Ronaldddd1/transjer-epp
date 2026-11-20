"""
Facturas: el buscador de proveedores y el resumen por proveedor.

  - El filtro de proveedor se busca escribiendo el nombre o el RUC.
  - La pestaña "Resumen por proveedor" (antes "Observadas") muestra, en un rango de
    fechas, cuántas facturas emitió cada proveedor, el total, lo pagado, los adelantos y
    el saldo pendiente. Las anuladas no cuentan.

    python3 tests/e2e-resumen-proveedor.py
"""
import os, re, subprocess, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
RUC = f"20{SELLO}555"
PROVEEDOR = f"Resumen Prueba {SELLO} SAC"

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
    for r in (RUC, f"20{SELLO}556"):
        ejecutar(f"delete from supplier_invoices where supplier_id in (select id from suppliers where ruc = '{r}')")
        ejecutar(f"delete from suppliers where ruc = '{r}'")


def factura(numero, emision, total, estado, adelanto="NULL", pagada=False):
    ejecutar("insert into supplier_invoices (supplier_id, series, number, issue_date, total, advances, status, detraction_status, paid_at) "
             f"select id, 'F001', '{numero}', '{emision}', {total}, {adelanto}, '{estado}', 'NO_APLICA', "
             f"{'now()' if pagada else 'NULL'} from suppliers where ruc = '{RUC}'")


limpiar()
ejecutar(f"insert into suppliers (business_name, ruc) values ('{PROVEEDOR}', '{RUC}')")
factura(f"1{SELLO}", "2026-10-05", 1180, "PAGADA", pagada=True)
factura(f"2{SELLO}", "2026-10-12", 1000, "PENDIENTE", adelanto=300)
factura(f"3{SELLO}", "2026-10-20", 500, "ANULADA")       # anulada: no cuenta
factura(f"4{SELLO}", "2026-09-28", 800, "PENDIENTE")     # fuera del rango
# Otro proveedor que debe más (6,500): tiene que salir antes que el de 700.
RUC2 = f"20{SELLO}556"
ejecutar(f"insert into suppliers (business_name, ruc) values ('Resumen Prueba Dos {SELLO} SAC', '{RUC2}')")
ejecutar("insert into supplier_invoices (supplier_id, series, number, issue_date, total, status, detraction_status) "
         f"select id, 'F001', '5{SELLO}', '2026-10-15', 6500, 'PENDIENTE', 'NO_APLICA' from suppliers where ruc = '{RUC2}'")
SUPPLIER_ID = psql(f"select id from suppliers where ruc = '{RUC}'")

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

    # --- El buscador de proveedores ---
    page.goto(f"{BASE}/facturas?estado="); page.wait_for_timeout(1500)
    buscador = page.get_by_role("combobox", name="Proveedor")
    check("el filtro de proveedor es un buscador", buscador.count() == 1)
    buscador.click(); buscador.fill(RUC[:9]); page.wait_for_timeout(300)
    opciones = page.get_by_role("option")
    check("buscando por RUC aparece el proveedor", opciones.filter(has_text=PROVEEDOR).count() == 1,
          opciones.all_inner_texts()[:3])
    opciones.filter(has_text=PROVEEDOR).click()
    page.wait_for_url(re.compile(f"proveedor={SUPPLIER_ID}"), timeout=10000); page.wait_for_timeout(1200)
    filas = page.locator("tbody tr").filter(has_text=PROVEEDOR)
    check("al elegirlo, la lista queda con sus facturas (las 4)", filas.count() == 4, filas.count())
    check("y el buscador muestra el elegido", buscador.input_value() == PROVEEDOR, buscador.input_value())
    buscador.click(); buscador.fill("resumen prueba " + SELLO); page.wait_for_timeout(300)
    check("también por nombre, sin importar mayúsculas", page.get_by_role("option").filter(has_text=PROVEEDOR).count() == 1)
    page.keyboard.press("Escape")

    # --- Resumen por proveedor ---
    page.goto(f"{BASE}/facturas"); page.wait_for_timeout(1200)
    tabs = page.locator("main").inner_text()
    check("la pestaña Observadas se cambió por Resumen por proveedor",
          "Resumen por proveedor" in tabs and page.get_by_role("tab", name=re.compile("^Observadas")).count() == 0)
    page.get_by_role("tab", name=re.compile("Resumen por proveedor")).click()
    page.wait_for_url(re.compile("estado=RESUMEN"), timeout=10000); page.wait_for_timeout(1200)
    page.goto(f"{BASE}/facturas?estado=RESUMEN&proveedor={SUPPLIER_ID}&from=2026-10-01&to=2026-10-31")
    page.wait_for_timeout(1500)
    fila = page.locator("[data-testid=resumen-proveedores] tr").filter(has_text=PROVEEDOR)
    texto = fila.inner_text() if fila.count() else ""
    celdas = [c.strip() for c in fila.locator("td").all_inner_texts()] if fila.count() else []
    check("una fila para el proveedor", fila.count() == 1)
    check("2 facturas en el rango (sin la anulada ni la de septiembre)", celdas[1].startswith("2") if celdas else False, celdas)
    check("neto sin IGV 1,847.46 (1,000.00 + 847.46: sin base imponible, total / 1.18)", "1,847.46" in celdas[2] if celdas else False, celdas)
    check("total facturado 2,180.00", "2,180.00" in celdas[3] if celdas else False, celdas)
    check("pagado 1,180.00", "1,180.00" in celdas[4] if celdas else False, celdas)
    check("adelantos 300.00", "300.00" in celdas[5] if celdas else False, celdas)
    check("saldo pendiente 700.00 (1,000 − 300 de adelanto)", "700.00" in celdas[6] if celdas else False, celdas)
    check("dice el rango", "del 01/10/2026 al 31/10/2026" in page.locator("main").inner_text())
    totales = page.locator("[data-testid=resumen-totales]").inner_text()
    check("arriba, los totales del rango", "1,847.46" in totales and "2,180.00" in totales and "700.00" in totales, totales[:200])

    # El orden: primero a quien más se le debe, comparando números y no texto.
    page.goto(f"{BASE}/facturas?estado=RESUMEN&from=2026-10-01&to=2026-10-31"); page.wait_for_timeout(1500)
    pendientes = []
    for t in page.locator("[data-testid=resumen-proveedores] tr").all():
        c = t.locator("td").all_inner_texts()
        if len(c) > 6 and "S/" in c[6] and "US$" not in c[6]:
            pendientes.append(float(c[6].replace("S/", "").replace(",", "").strip()))
    check("ordenado de mayor a menor saldo pendiente", pendientes == sorted(pendientes, reverse=True), pendientes[:6])
    page.goto(f"{BASE}/facturas?estado=RESUMEN&proveedor={SUPPLIER_ID}&from=2026-10-01&to=2026-10-31"); page.wait_for_timeout(1300)
    fila = page.locator("[data-testid=resumen-proveedores] tr").filter(has_text=PROVEEDOR)

    fila.get_by_role("link", name="Ver facturas").click()
    page.wait_for_url(re.compile("proveedor="), timeout=10000); page.wait_for_timeout(1300)
    check("«Ver facturas» abre sus facturas con el mismo rango",
          "from=2026-10-01" in page.url and "to=2026-10-31" in page.url
          and page.locator("tbody tr").filter(has_text=PROVEEDOR).count() == 3, page.url)

    # Sin rango: todas sus facturas (4 sin la anulada = 3)
    page.goto(f"{BASE}/facturas?estado=RESUMEN&proveedor={SUPPLIER_ID}"); page.wait_for_timeout(1300)
    celdas = page.locator("[data-testid=resumen-proveedores] tr").filter(has_text=PROVEEDOR).locator("td").all_inner_texts()
    check("sin rango cuenta todas (sin la anulada): 3 facturas y 1,500.00 pendientes",
          celdas and celdas[1].strip().startswith("3") and "1,500.00" in celdas[6], celdas)

    check("ninguna pantalla lanzó errores de JavaScript", not errores, errores[:3])
    nav.close()

limpiar()
print("\nTodo en orden." if not fails else f"\n{len(fails)} comprobación(es) fallaron: {fails}")
raise SystemExit(1 if fails else 0)
