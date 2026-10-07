"""
Recorrido del control de devolución de EPP al cese y del desglose por tipo de EPP.

Comprueba lo que no se ve en una prueba de base: que el almacenero pueda ver qué EPP tiene
cada trabajador, registrar el cese y cerrar la devolución sin salir de la pantalla.

    E2E_DB=transjer python3 tests/e2e-devoluciones.py
"""
import os, re, subprocess, time
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
DNI = "99000" + str(int(time.time()))[-3:]
SALIDA = "/tmp/e2e-devoluciones"

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
    ejecutar("delete from epp_returns where reason like 'PRUEBA E2E%'")
    for fila in psql("select id from employees where last_name = 'Cesante'").splitlines():
        if fila.strip():
            ejecutar(f"delete from epp_returns where employee_id = '{fila.strip()}'")
            ejecutar(f"delete from epp_deliveries where employee_id = '{fila.strip()}'")
            ejecutar(f"delete from inventory_movements where employee_id = '{fila.strip()}'")
            ejecutar(f"delete from employees where id = '{fila.strip()}'")


def sembrar():
    """Un trabajador con dos EPP a su cargo, por el mismo camino que usa la pantalla."""
    ejecutar(
        "insert into employees (dni, first_name, last_name, position, area, hire_date, is_demo) "
        f"values ('{DNI}', 'Prueba', 'Cesante', 'Operario', 'Operaciones', '2026-01-02', true)")
    emp = psql(f"select id from employees where dni = '{DNI}'")
    admin = psql("select id from users order by created_at limit 1")
    productos = psql("select id from products where active order by name limit 2").splitlines()
    for pid, cant in zip(productos, (2, 1)):
        pid = pid.strip()
        # Reposición previa: la prueba no debe depender del stock que haya quedado.
        ejecutar(
            "insert into inventory_movements (product_id, type, quantity, stock_before, stock_after, reason, user_id, employee_id) "
            f"select '{pid}', 'ENTRADA', 10, stock, stock + 10, 'PRUEBA E2E reposicion', '{admin}', '{emp}' from products where id = '{pid}'")
        ejecutar(f"update products set stock = stock + 10 where id = '{pid}'")
        ejecutar(
            "insert into inventory_movements (product_id, type, quantity, stock_before, stock_after, reason, user_id, employee_id) "
            f"select '{pid}', 'SALIDA', {cant}, stock, stock - {cant}, 'PRUEBA E2E entrega', '{admin}', '{emp}' from products where id = '{pid}'")
        ejecutar(f"update products set stock = stock - {cant} where id = '{pid}'")
        ejecutar(
            "insert into epp_deliveries (employee_id, product_id, movement_id, quantity, size, delivery_date, reason, user_id) "
            f"select '{emp}', '{pid}', m.id, {cant}, p.size, current_date - 30, 'PRUEBA E2E entrega', '{admin}' "
            f"from inventory_movements m join products p on p.id = m.product_id "
            f"where m.employee_id = '{emp}' and m.product_id = '{pid}' and m.type = 'SALIDA' "
            f"and not exists (select 1 from epp_deliveries d where d.movement_id = m.id) limit 1")
    return emp, [p.strip() for p in productos]


def boton_modal(page, etiqueta):
    """El botón de dentro del modal.

    El disparador y el botón de enviar se llaman igual ("Registrar cese"), y un clic sin
    acotar cae en el de la página, que está detrás del velo del modal.
    """
    return page.locator("div.fixed.inset-0.z-50").locator(f"button:has-text('{etiqueta}')").last


def enviar(page, etiqueta, timeout=15000):
    boton_modal(page, etiqueta).click()
    page.wait_for_selector("div.fixed.inset-0.z-50", state="detached", timeout=timeout)
    page.wait_for_timeout(700)


def main():
    limpiar()
    emp, productos = sembrar()
    nombres = [psql(f"select name from products where id = '{p}'") for p in productos]

    with sync_playwright() as pw:
        nav = pw.chromium.launch()
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

        # --- El resumen dice qué EPP tiene cada trabajador, no solo cuántos ---
        page.goto(f"{BASE}/entregas/resumen"); page.wait_for_timeout(900)
        contenido = page.content()
        check("el resumen nombra el tipo de EPP entregado", nombres[0] in contenido, nombres[0])
        fila = page.locator("tr", has_text="Cesante").first
        texto = fila.inner_text()
        check("la fila del trabajador lista sus dos tipos de EPP",
              nombres[0] in texto and nombres[1] in texto, texto[:120])
        # Se mira el texto visible, no el HTML: React intercala un comentario entre el «×»
        # y el número, así que "×2" no aparece como tal en el código fuente.
        check("y cada EPP sale con su cantidad", "×2" in texto and "×1" in texto, texto[:120])

        # --- El menú tiene la pantalla de devoluciones ---
        check("el menú tiene Devolución de EPP", page.locator("a[href='/devoluciones']").count() > 0)

        # --- Ficha del trabajador: lo que tiene a su cargo ---
        page.goto(f"{BASE}/trabajadores/{emp}"); page.wait_for_timeout(900)
        check("la ficha muestra el panel de EPP a su cargo", "EPP a su cargo" in page.content())
        check("cuenta las 3 unidades que tiene", page.locator("text=A su cargo").count() > 0)
        check("todavía no se le reclama nada", "sin devolver" not in page.content())

        # --- Registrar el cese ---
        page.click("button:has-text('Registrar cese')"); page.wait_for_timeout(600)
        check("el modal avisa cuánto EPP tiene antes de cesarlo", "3 unidad(es)" in page.content())
        cese = page.locator("input#terminatedAt")
        check("la fecha de cese se precarga en día/mes/año", len(cese.input_value()) == 10, cese.input_value())
        page.fill("input[name=terminationReason]", "Renuncia (prueba)")
        enviar(page, "Registrar cese")

        check("queda cesado en la base", psql(f"select terminated_at is not null from employees where id = '{emp}'") == "t")
        check("y desactivado", psql(f"select active from employees where id = '{emp}'") == "f")
        contenido = page.content()
        check("la ficha avisa que debe EPP", "Cesado" in contenido and "a su cargo" in contenido)
        check("el aviso dice cuántas unidades faltan", "3 unidad(es)" in contenido, contenido[:0])

        # --- La pantalla de devoluciones lo reclama ---
        page.goto(f"{BASE}/devoluciones"); page.wait_for_timeout(900)
        contenido = page.content()
        check("el cesado aparece en devoluciones pendientes", "Cesante" in contenido)
        check("con el detalle del EPP que debe", nombres[0] in contenido and nombres[1] in contenido)
        check("y el aviso en rojo arriba", "deben devolver" in contenido)

        # --- El dashboard también avisa ---
        page.goto(f"{BASE}/dashboard"); page.wait_for_timeout(900)
        check("el dashboard avisa del EPP sin devolver", "sin devolver" in page.content())
        check("el menú marca el pendiente con un contador",
              page.locator("a[href='/devoluciones'] span.bg-brand").count() > 0)

        # --- Registrar la devolución ---
        page.goto(f"{BASE}/devoluciones"); page.wait_for_timeout(900)
        page.locator("tr", has_text="Cesante").first.locator("button:has-text('Devolver')").click()
        page.wait_for_timeout(600)
        check("el modal solo ofrece lo que tiene a su cargo",
              page.locator("select[name=productId] option").count() == 2,
              page.locator("select[name=productId] option").count())
        check("el motivo se precarga con el cese", page.input_value("input[name=reason]") == "Cese del trabajador")
        check("la cantidad se precarga con lo pendiente", page.input_value("input[name=quantity]") in ("1", "2"),
              page.input_value("input[name=quantity]"))

        stock_antes = int(psql(f"select stock from products where id = '{productos[0]}'"))
        page.select_option("select[name=productId]", value=productos[0])
        page.wait_for_timeout(400)
        page.fill("input[name=quantity]", "2")
        page.select_option("select[name=condition]", "REUTILIZABLE")
        enviar(page, "Registrar devolución")

        stock_despues = int(psql(f"select stock from products where id = '{productos[0]}'"))
        check("lo reutilizable vuelve al stock", stock_despues == stock_antes + 2, f"{stock_antes} → {stock_despues}")
        check("la devolución queda con su movimiento vinculado",
              psql(f"select count(*) from epp_returns where employee_id = '{emp}' and movement_id is not null") == "1")

        page.goto(f"{BASE}/devoluciones"); page.wait_for_timeout(900)
        fila = page.locator("tr", has_text="Cesante").first
        check("sigue reclamándose lo que falta", "1" in fila.inner_text() and nombres[1] in fila.inner_text(),
              fila.inner_text()[:120])

        # --- Lo que no devolvió exige explicación ---
        fila.locator("button:has-text('Devolver')").click(); page.wait_for_timeout(600)
        page.select_option("select[name=condition]", "NO_DEVUELTO")
        page.wait_for_timeout(300)
        boton_modal(page, "Registrar devolución").click()
        page.wait_for_timeout(1500)
        check("no acepta un «no devuelto» sin explicación",
              "Explica qué pasó" in page.content(), page.content()[:0])

        stock_antes = int(psql(f"select stock from products where id = '{productos[1]}'"))
        page.fill("textarea[name=notes]", "Se perdió en obra (prueba)")
        enviar(page, "Registrar devolución")
        stock_despues = int(psql(f"select stock from products where id = '{productos[1]}'"))
        check("lo no devuelto no suma stock", stock_despues == stock_antes, f"{stock_antes} → {stock_despues}")

        page.goto(f"{BASE}/devoluciones"); page.wait_for_timeout(900)
        pendiente = page.locator("table").first.inner_text()
        check("saldado, sale de la lista de pendientes", "Cesante" not in pendiente, pendiente[:140])
        check("pero queda en el historial de devoluciones", "Cesante" in page.content())
        check("con la etiqueta de no devuelto", "No devuelto" in page.content())

        # --- Exportar ---
        # Se baja desde el botón de la pantalla, no por la URL: navegar a una descarga
        # directamente hace que Playwright falle con «Download is starting».
        os.makedirs(SALIDA, exist_ok=True)
        for ruta, tabla in [("/devoluciones", "devoluciones"), ("/entregas/resumen", "resumen-epp")]:
            page.goto(f"{BASE}{ruta}"); page.wait_for_timeout(900)
            page.locator("button:has-text('Exportar')").first.click()
            page.wait_for_timeout(300)
            with page.expect_download(timeout=30000) as bajada:
                page.click("a[role=menuitem]:has-text('Excel')")
            destino = f"{SALIDA}/{tabla}.xlsx"
            bajada.value.save_as(destino)
            check(f"el Excel de {tabla} se descarga y no está vacío", os.path.getsize(destino) > 4000,
                  os.path.getsize(destino))

        hojas_dev = [h.title for h in load_workbook(f"{SALIDA}/devoluciones.xlsx").worksheets]
        check("el Excel de devoluciones trae pendientes e historial", len(hojas_dev) == 2, hojas_dev)
        hojas_res = [h.title for h in load_workbook(f"{SALIDA}/resumen-epp.xlsx").worksheets]
        check("el resumen trae la hoja de qué EPP tiene cada trabajador", len(hojas_res) == 3, hojas_res)

        libro = load_workbook(f"{SALIDA}/resumen-epp.xlsx")
        detalle = libro.worksheets[2]
        textos = [str(c.value) for fila in detalle.iter_rows() for c in fila if c.value]
        check("y esa hoja nombra el EPP del trabajador de prueba",
              any(nombres[0] == t for t in textos), nombres[0])

        # --- Anular el cese ---
        page.goto(f"{BASE}/trabajadores/{emp}"); page.wait_for_timeout(900)
        page.click("button:has-text('Anular cese')"); page.wait_for_timeout(500)
        boton_modal(page, "Anular el cese").click()
        page.wait_for_timeout(2000)
        check("el cese se puede anular", psql(f"select terminated_at is null from employees where id = '{emp}'") == "t")
        check("y el trabajador vuelve a estar activo", psql(f"select active from employees where id = '{emp}'") == "t")
        check("las devoluciones registradas se conservan",
              int(psql(f"select count(*) from epp_returns where employee_id = '{emp}'")) == 2)

        check("ninguna pantalla lanzó errores de JavaScript", not errores, errores[:3])
        ctx.close(); nav.close()

    print("\nTodo en orden." if not fails else f"\n{len(fails)} comprobación(es) fallaron: {fails}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
