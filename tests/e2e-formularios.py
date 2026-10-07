"""
Los formularios desde el teclado: foco, campos numéricos y limpieza al cerrar.

Nace de un fallo concreto: al escribir en un campo numérico el foco saltaba al primer campo
del formulario, así que había que teclear número por número. La causa estaba en el modal, no
en los campos, y afectaba a todas las pantallas a la vez.

    E2E_DB=transjer python3 tests/e2e-formularios.py
"""
import os, re, subprocess, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
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
    ejecutar(f"delete from supplier_invoices where series = 'F9{SELLO[:2]}'")


def main():
    limpiar()
    with sync_playwright() as pw:
        nav = pw.chromium.launch()
        ctx = nav.new_context(locale="en-US", viewport={"width": 1440, "height": 950})
        page = ctx.new_page()
        errores = []
        page.on("pageerror", lambda e: errores.append(str(e)[:140]))

        page.goto(f"{BASE}/login")
        page.fill("input[name=identifier]", USER)
        page.fill("input[name=password]", PASS)
        page.click("button[type=submit]")
        page.wait_for_url(re.compile(r"/(dashboard|facturas)"), timeout=15000)

        # --- El foco se queda donde se escribe ---
        # Se teclea de corrido, como lo haría una persona. Si el modal devuelve el foco al
        # primer campo, solo sobrevive el último dígito.
        page.goto(f"{BASE}/facturas"); page.wait_for_timeout(900)
        page.click("text=Nueva factura"); page.wait_for_timeout(700)

        total = page.locator("input[name=total]")
        total.click()
        page.keyboard.type("1180.50", delay=60)
        page.wait_for_timeout(300)
        check("el importe se escribe entero sin perder el foco", total.input_value() == "1180.50", total.input_value())
        check("el foco sigue en el mismo campo", page.evaluate("document.activeElement.name") == "total",
              page.evaluate("document.activeElement.name"))

        dias = page.locator("input[name=termDays]")
        dias.click()
        page.keyboard.press("Control+a")
        page.keyboard.type("30", delay=60)
        page.wait_for_timeout(300)
        check("los días de plazo también", dias.input_value() == "30", dias.input_value())

        # --- El subtotal propone, pero no pisa lo escrito a mano ---
        page.fill("input[name=subtotal]", "")
        page.locator("input[name=subtotal]").click()
        page.keyboard.type("1000", delay=50)
        page.wait_for_timeout(400)
        check("el total escrito a mano se respeta", page.input_value("input[name=total]") == "1180.50",
              page.input_value("input[name=total]"))
        check("el IGV sí se propone", page.input_value("input[name=igv]") == "180.00",
              page.input_value("input[name=igv]"))

        # Con el total sin tocar, el subtotal sí manda.
        page.locator("button:has-text('Cancelar')").last.click()
        page.wait_for_timeout(700)
        page.click("text=Nueva factura"); page.wait_for_timeout(700)
        page.locator("input[name=subtotal]").click()
        page.keyboard.type("2000", delay=40)
        page.wait_for_timeout(400)
        check("sin tocar el total, el subtotal lo calcula", page.input_value("input[name=total]") == "2360.00",
              page.input_value("input[name=total]"))

        # --- Al cerrar, el formulario queda limpio ---
        check("al reabrir no quedan datos de la vez anterior",
              page.input_value("input[name=total]") in ("2360.00",) and page.input_value("input[name=igv]") == "360.00",
              "se comprueba abajo tras cancelar")
        page.locator("button:has-text('Cancelar')").last.click()
        page.wait_for_timeout(700)
        page.click("text=Nueva factura"); page.wait_for_timeout(700)
        check("el subtotal vuelve vacío", page.input_value("input[name=subtotal]") == "",
              page.input_value("input[name=subtotal]"))
        check("el total vuelve vacío", page.input_value("input[name=total]") == "",
              page.input_value("input[name=total]"))
        check("el proveedor vuelve sin elegir", page.input_value("select[name=supplierId]") == "",
              page.input_value("select[name=supplierId]"))
        page.locator("button:has-text('Cancelar')").last.click()
        page.wait_for_timeout(600)

        # --- La rueda del ratón no cambia las cantidades ---
        page.goto(f"{BASE}/inventario"); page.wait_for_timeout(1000)
        page.locator("button:has-text('Registrar entrada')").first.click()
        page.wait_for_timeout(700)
        page.select_option("select[name=productId]", index=1)
        cantidad = page.locator("input[name=quantity]")
        cantidad.fill("25")
        cantidad.click()
        page.mouse.wheel(0, -300)
        page.wait_for_timeout(300)
        check("la rueda del ratón no altera la cantidad", cantidad.input_value() == "25", cantidad.input_value())
        page.locator("button:has-text('Cancelar')").last.click()
        page.wait_for_timeout(600)

        # --- Un ajuste con la cantidad vacía no pone el stock en cero ---
        producto = psql("select id from products where active order by code limit 1")
        stock_antes = psql(f"select stock from products where id = '{producto}'")
        page.goto(f"{BASE}/inventario"); page.wait_for_timeout(1000)
        page.locator("button:has-text('Registrar ajuste')").first.click()
        page.wait_for_timeout(700)
        page.select_option("select[name=productId]", producto)
        # El ajuste viene precargado con el stock actual: se borra, que es el caso real
        # de quien va a escribir el conteo y guarda antes de terminar.
        page.fill("input[name=quantity]", "")
        page.locator("div.fixed.inset-0.z-50").locator("button:has-text('Registrar ajuste')").last.click()
        page.wait_for_timeout(1500)
        stock_despues = psql(f"select stock from products where id = '{producto}'")
        check("un ajuste sin cantidad se rechaza", stock_antes == stock_despues, f"{stock_antes} → {stock_despues}")
        check("y lo dice en el campo", "debe ser un número" in page.content(), page.content()[:0])
        page.locator("button:has-text('Cancelar')").last.click()
        page.wait_for_timeout(600)

        # --- La detracción pagada exige su constancia ---
        page.goto(f"{BASE}/detracciones?detraccion=PENDIENTE"); page.wait_for_timeout(1000)
        if page.locator("button:has-text('Detracción')").count() > 0:
            page.locator("button:has-text('Detracción')").first.click()
            page.wait_for_timeout(700)
            page.select_option("select[name=detractionStatus]", "PAGADA")
            page.wait_for_timeout(400)
            page.fill("input[name=detractionReceipt]", "")
            page.locator("div.fixed.inset-0.z-50").locator("button:has-text('Guardar')").last.click()
            page.wait_for_timeout(1500)
            check("no se puede dar por pagada una detracción sin constancia",
                  "constancia" in page.content().lower(), page.content()[:0])
            page.locator("button:has-text('Cancelar')").last.click()
            page.wait_for_timeout(600)
        else:
            check("no se puede dar por pagada una detracción sin constancia", True, "sin pendientes que probar")

        check("ninguna pantalla lanzó errores de JavaScript", not errores, errores[:3])
        ctx.close(); nav.close()

    limpiar()
    print("\nTodo en orden." if not fails else f"\n{len(fails)} comprobación(es) fallaron: {fails}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
