"""
Comprueba que cada tabla se puede bajar en Excel y que el archivo trae las filas correctas.

    E2E_DB=transjer python3 tests/e2e-exportar.py
"""
import os, re, subprocess, sys, zipfile, io
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
DB = os.environ.get("E2E_DB", "epp")
SALIDA = "/tmp/e2e-export"

fails = []
def check(nombre, cond, extra=""):
    if cond: print("OK   ", nombre)
    else:
        fails.append(nombre); print("FALLA", nombre, extra)

def psql(q):
    return subprocess.check_output(["su", "postgres", "-c", f'psql -d {DB} -tAc "{q}"']).decode().strip()

# tabla, pantalla donde vive el botón, consulta que dice cuántas filas debería traer
TABLAS = [
    ("facturas", "/facturas", "select count(*) from supplier_invoices"),
    ("detracciones", "/detracciones?detraccion=", "select count(*) from supplier_invoices"),
    ("detracciones-pendientes", "/detracciones", None),
    ("proveedores", "/proveedores", "select count(*) from suppliers"),
    ("obligaciones", "/obligaciones", "select count(*) from obligations"),
    ("calendario", "/calendario", None),
    ("resumen-epp", "/entregas/resumen", None),
    ("entregas", "/entregas", "select count(*) from epp_deliveries"),
    # La primera hoja son los cesados que deben EPP, y lo normal es que esté vacía. Se
    # cuenta aparte, repitiendo la resta a mano: así el Excel se contrasta contra la base
    # en vez de contra la misma consulta que lo genera.
    ("devoluciones", "/devoluciones",
     "select count(distinct t.id) from ("
     " select e.id, d.product_id, sum(d.quantity) as q"
     " from employees e join epp_deliveries d on d.employee_id = e.id and d.voided_at is null"
     " where e.terminated_at is not null group by e.id, d.product_id) t"
     " where t.q > coalesce((select sum(r.quantity) from epp_returns r"
     " where r.employee_id = t.id and r.product_id = t.product_id), 0)"),
    ("trabajadores", "/trabajadores", "select count(*) from employees where active"),
    ("usuarios", "/usuarios", "select count(*) from users"),
    ("auditoria", "/auditoria", None),
    ("inventario", "/inventario", "select count(*) from products where active"),
    ("movimientos", "/movimientos", None),
    ("categorias", "/categorias", "select count(*) from categories"),
    ("correos", "/facturas/correos", "select count(*) from invoice_emails"),
]

def filas_de_hoja(ruta, hoja_idx=0):
    """Cuenta las filas de datos de un .xlsx sin librerías: la cabecera ocupa hasta la fila 5."""
    with zipfile.ZipFile(ruta) as z:
        hojas = sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))
        xml = z.read(hojas[hoja_idx]).decode("utf-8", "ignore")
    filas = re.findall(r'<row[^>]*r="(\d+)"', xml)
    return max((int(f) for f in filas), default=0) - 5, len(hojas)


def main():
    os.makedirs(SALIDA, exist_ok=True)
    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(accept_downloads=True, viewport={"width": 1440, "height": 950})
        page = ctx.new_page()
        page.goto(f"{BASE}/login")
        page.fill("input[name=identifier]", "admin")
        page.fill("input[name=password]", "Admin123!")
        page.click("button[type=submit]")
        page.wait_for_url(re.compile(r"/(dashboard|facturas)"), timeout=15000)

        for tabla, ruta, consulta in TABLAS:
            page.goto(BASE + ruta)
            page.wait_for_timeout(900)
            boton = page.locator("button:has-text('Exportar')").first
            if boton.count() == 0:
                check(f"{tabla}: la pantalla ofrece exportar", False, ruta)
                continue
            check(f"{tabla}: la pantalla ofrece exportar", True)
            boton.click()
            page.wait_for_timeout(300)
            with page.expect_download(timeout=30000) as d:
                page.click("a[role=menuitem]:has-text('Excel')")
            archivo = f"{SALIDA}/{tabla}.xlsx"
            d.value.save_as(archivo)

            tam = os.path.getsize(archivo)
            check(f"{tabla}: el Excel se descarga y no está vacío", tam > 4000, tam)
            check(f"{tabla}: el nombre del archivo lo identifica", tabla.split("-pendientes")[0] in d.value.suggested_filename,
                  d.value.suggested_filename)
            try:
                filas, hojas = filas_de_hoja(archivo)
                esperadas = int(psql(consulta)) if consulta else None
                # Una tabla vacía da un Excel con solo la cabecera, y eso también es correcto:
                # lo que se comprueba es que el archivo se abra y cuadre con la base.
                if esperadas is None:
                    check(f"{tabla}: el Excel se abre y trae filas", filas > 0, filas)
                else:
                    check(f"{tabla}: trae las {esperadas} filas de la base", filas == esperadas, (filas, esperadas))
                if tabla == "resumen-epp":
                    # Por producto, por trabajador y el detalle de qué EPP tiene cada uno.
                    check("resumen-epp: trae una hoja por tabla", hojas == 3, hojas)
                if tabla == "detracciones-pendientes":
                    # Sin elegir estado, la pantalla muestra solo las pendientes: el archivo igual.
                    pend = int(psql("select count(*) from supplier_invoices where detraction_status='PENDIENTE' and status<>'ANULADA'"))
                    check("sin filtro, el archivo trae solo las pendientes, como la pantalla", filas == pend, (filas, pend))
            except Exception as e:
                check(f"{tabla}: el Excel se abre", False, str(e)[:80])

        # Los filtros de la pantalla viajan al archivo
        page.goto(f"{BASE}/facturas?estado=PAGADA")
        page.wait_for_timeout(900)
        page.locator("button:has-text('Exportar')").first.click()
        page.wait_for_timeout(300)
        with page.expect_download(timeout=30000) as d:
            page.click("a[role=menuitem]:has-text('Excel')")
        d.value.save_as(f"{SALIDA}/facturas-pagadas.xlsx")
        filas, _ = filas_de_hoja(f"{SALIDA}/facturas-pagadas.xlsx")
        pagadas = int(psql("select count(*) from supplier_invoices where status='PAGADA'"))
        check("el filtro de la pantalla llega al Excel", filas == pagadas, (filas, pagadas))

        # CSV y PDF también
        page.goto(f"{BASE}/detracciones?detraccion=")
        page.wait_for_timeout(800)
        for formato, extension in [("CSV", ".csv"), ("PDF", ".pdf")]:
            page.locator("button:has-text('Exportar')").first.click()
            page.wait_for_timeout(300)
            with page.expect_download(timeout=30000) as d:
                page.click(f"a[role=menuitem]:has-text('{formato}')")
            destino = f"{SALIDA}/detracciones{extension}"
            d.value.save_as(destino)
            check(f"también se baja en {formato}", os.path.getsize(destino) > 200 and d.value.suggested_filename.endswith(extension),
                  d.value.suggested_filename)

        # Permisos: la encargada de detracciones no puede bajarse los trabajadores.
        # Se navega en vez de usar request.get, que no lleva la cookie de sesión.
        ctx2 = nav.new_context(accept_downloads=True)
        p2 = ctx2.new_page()
        p2.goto(f"{BASE}/login")
        usuario = psql("select username from users where role='DETRACCIONES' order by created_at desc limit 1")
        if usuario:
            p2.fill("input[name=identifier]", usuario)
            p2.fill("input[name=password]", "Detrac123!")
            p2.click("button[type=submit]")
            p2.wait_for_timeout(2000)
            r = p2.goto(f"{BASE}/api/export/tabla?tabla=trabajadores&format=xlsx")
            check("un rol sin permiso no puede exportar esa tabla", r.status == 403, r.status)
            # Esta sí descarga, así que navegar directamente lanzaría "Download is starting".
            with p2.expect_download(timeout=20000) as d2:
                # Navegar a una descarga lanza "Download is starting": el error se ignora,
                # lo que importa es que el archivo llegue.
                try:
                    p2.goto(f"{BASE}/api/export/tabla?tabla=detracciones&format=csv")
                except Exception:
                    pass
            check("pero sí la suya", d2.value.suggested_filename.endswith(".csv"), d2.value.suggested_filename)
        else:
            check("hay un usuario de detracciones para probar permisos", False, "ninguno")
        ctx2.close()

        # Una tabla que no existe no revienta
        r = page.goto(f"{BASE}/api/export/tabla?tabla=inventada&format=xlsx")
        check("una tabla desconocida se rechaza", r.status == 400, r.status)

        nav.close()

    print()
    if fails:
        print(f"{len(fails)} FALLAS:")
        for f in fails: print(" -", f)
        sys.exit(1)
    print("E2E EXPORTAR: todas las verificaciones superadas")


main()
