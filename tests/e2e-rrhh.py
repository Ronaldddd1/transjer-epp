"""
Recursos Humanos: el menú (primero, con Trabajadores arriba de Asistencia), la ficha del
trabajador con todos los datos obligatorios y el cargo de EPP vigente.

    python3 tests/e2e-rrhh.py
"""
import os, re, subprocess, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
DNI = "98" + str(int(time.time()))[-6:]

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
    ejecutar("delete from audit_logs where description like '%Completo Prueba%'")
    ejecutar("delete from employees where last_name = 'Completo Prueba'")


def main():
    limpiar()
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

        # --- El menú: Recursos Humanos primero, Trabajadores y debajo Asistencia ---
        page.goto(f"{BASE}/trabajadores"); page.wait_for_timeout(800)
        menu = page.locator("nav[aria-label=Principal]").first.inner_text()
        pos = {k: menu.find(k) for k in ["Recursos Humanos", "Almacén", "Flota", "Proveedores", "Trabajadores", "Asistencia"]}
        check("Recursos Humanos es la primera sección del menú",
              all(pos["Recursos Humanos"] < pos[k] for k in ("Almacén", "Flota", "Proveedores") if pos[k] >= 0), pos)
        check("Trabajadores va arriba de Asistencia", 0 <= pos["Trabajadores"] < pos["Asistencia"], pos)
        hrefs = page.locator("nav[aria-label=Principal] a").evaluate_all("(as) => as.map(a => a.getAttribute('href'))")
        check("en los enlaces, /trabajadores antes que /asistencia",
              hrefs.index("/trabajadores") < hrefs.index("/asistencia"), hrefs[:6])

        # --- Nuevo trabajador: todos los datos son obligatorios ---
        page.click("button:has-text('Nuevo trabajador')"); page.wait_for_timeout(500)
        modal = page.get_by_role("dialog")
        modal.locator("input[name=dni]").fill(DNI)
        modal.locator("input[name=firstName]").fill("Ana")
        modal.locator("input[name=lastName]").fill("Completo Prueba")
        modal.locator("input[name=position]").fill("Operario de almacén")
        modal.locator("input[name=area]").fill("Almacén")
        modal.get_by_role("button", name="Registrar trabajador").click()
        page.wait_for_timeout(1500)
        texto = modal.inner_text()
        for mensaje in ["La fecha de ingreso es obligatoria", "El teléfono es obligatorio", "La dirección es obligatoria",
                        "El nombre del contacto de emergencia es obligatorio",
                        "El teléfono del contacto de emergencia es obligatorio", "El parentesco es obligatorio"]:
            check(f"falta un dato → «{mensaje}»", mensaje in texto, texto[-300:])
        check("y no se registra a medias", psql(f"select count(*) from employees where dni = '{DNI}'") == "0")

        modal.locator("input[name=phone]").fill("12")
        page.locator("#hireDate").fill("02/01/2026")
        modal.locator("input[name=address]").fill("Av. Prueba 123, Lima")
        modal.locator("input[name=emergencyContactName]").fill("Rosa Prueba")
        modal.locator("input[name=emergencyContactPhone]").fill("987654321")
        modal.locator("input[name=emergencyContactRelation]").fill("Madre")
        modal.get_by_role("button", name="Registrar trabajador").click()
        page.wait_for_timeout(1500)
        check("un teléfono corto no pasa", "al menos 7 dígitos" in modal.inner_text())

        modal.locator("input[name=phone]").fill("912 345 678")
        modal.get_by_role("button", name="Registrar trabajador").click()
        page.wait_for_selector("div.fixed.inset-0.z-50", state="detached", timeout=15000)
        fila = psql(f"select hire_date, phone, address, emergency_contact_name, emergency_contact_phone, "
                    f"emergency_contact_relation from employees where dni = '{DNI}'")
        check("con todo completo, se registra", fila.startswith("2026-01-02|912 345 678|Av. Prueba 123"), fila)

        # --- Cargo de EPP vigente: solo si tiene EPP ---
        emp = psql(f"select id from employees where dni = '{DNI}'")
        page.goto(f"{BASE}/trabajadores/{emp}"); page.wait_for_timeout(800)
        check("sin EPP a su cargo no ofrece el cargo vigente", page.locator("a:has-text('Cargo de EPP')").count() == 0)
        r = page.evaluate("async (u) => (await fetch(u)).status", f"/api/epp/cargo/{emp}")
        check("y la ruta responde que no hay nada que poner", r == 404, r)
        r = page.evaluate("async (u) => (await fetch(u)).status", f"/api/epp/devolucion/{emp}?lote=nada")
        check("un lote mal escrito se rechaza", r == 400, r)

        check("ninguna pantalla lanzó errores de JavaScript", not errores, errores[:3])
        ctx.close(); nav.close()

    limpiar()
    print("\nTodo en orden." if not fails else f"\n{len(fails)} comprobación(es) fallaron: {fails}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
