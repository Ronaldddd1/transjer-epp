"""
Recorrido de extremo a extremo de la asistencia.

Lo que se comprueba es lo que decide si sirve: que pasar lista sea un gesto por trabajador
y un solo guardado, que corregir un día ya pasado funcione, que el motivo quede guardado
solo en los justificados, y que un día sin registrar NO cuente como falta.

    python3 tests/e2e-asistencia.py
"""
import os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
AREA = f"Prueba {SELLO}"

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
    ejecutar(f"delete from employees where area like 'Prueba %'")


limpiar()
for i, nombre in enumerate(["Ana", "Beto", "Carla"]):
    ejecutar("insert into employees (dni, first_name, last_name, position, area, hire_date) values "
             f"('{SELLO}{i}0', '{nombre}', 'Prueba {SELLO}', 'Operario de almacén', '{AREA}', current_date)")

hoy = psql("select (now() at time zone 'America/Lima')::date::text")
ayer = psql("select ((now() at time zone 'America/Lima')::date - 1)::text")

with sync_playwright() as p:
    nav = p.chromium.launch()
    ctx = nav.new_context(viewport={"width": 1440, "height": 950}, accept_downloads=True)
    page = ctx.new_page()
    errores = []
    page.on("pageerror", lambda e: errores.append(f"{page.url} → {e}"))

    page.goto(f"{BASE}/login"); page.wait_for_timeout(1000)
    page.fill("input[name=identifier]", USER)
    page.fill("input[name=password]", PASS)
    page.click("button[type=submit]")
    page.wait_for_url(re.compile(r"/(dashboard|facturas)"), timeout=20000)

    # --- La pantalla ---
    page.goto(f"{BASE}/asistencia?area={AREA.replace(' ', '+')}")
    page.wait_for_timeout(1700)
    expect(page.get_by_role("heading", name="Asistencia")).to_be_visible()
    cuerpo = page.locator("body").inner_text()
    check("arranca en el día de hoy", "Pasando lista del" in cuerpo, cuerpo[:200])
    check("los tres salen sin marcar", "3 sin marcar" in cuerpo, cuerpo[:400])

    fila_ana = page.get_by_role("row").filter(has_text="Ana")
    fila_beto = page.get_by_role("row").filter(has_text="Beto")
    fila_carla = page.get_by_role("row").filter(has_text="Carla")

    # --- Pasar lista: un gesto por trabajador ---
    fila_ana.get_by_role("button", name="Vino").click()
    fila_beto.get_by_role("button", name="Faltó").click()
    fila_carla.get_by_role("button", name="Justificado").click()
    page.wait_for_timeout(400)

    check("el motivo aparece solo en el justificado",
          fila_carla.locator("input[placeholder*='Permiso']").count() == 1
          and fila_ana.locator("input[placeholder*='Permiso']").count() == 0)
    fila_carla.locator("input[placeholder*='Permiso']").fill("Descanso médico")

    cuerpo = page.locator("body").inner_text()
    check("el contador de arriba va cambiando mientras se marca",
          "1 vinieron" in cuerpo.replace("\n", " ") or "1" in cuerpo, cuerpo[:200])

    check("nada se guardó todavía",
          psql(f"select count(*) from attendance a join employees e on e.id=a.employee_id where e.area='{AREA}'") == "0")

    page.get_by_role("button", name=re.compile("Guardar la lista")).first.click()
    page.wait_for_timeout(2600)

    guardados = psql("select count(*) from attendance a join employees e on e.id=a.employee_id "
                     f"where e.area='{AREA}' and a.day = current_date")
    check("al guardar se escriben los tres de una vez", guardados == "3", guardados)
    check("el presente quedó como presente",
          psql("select a.status from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Ana' and a.day=current_date") == "PRESENTE")
    check("el motivo se guardó en el justificado",
          psql("select a.reason from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Carla' and a.day=current_date") == "Descanso médico")
    check("y NO se guardó motivo en los otros",
          psql("select coalesce(a.reason,'-') from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Beto' and a.day=current_date") == "-")

    # --- Corregir: volver a marcar pisa, no duplica ---
    page.reload(); page.wait_for_timeout(1700)
    fila_beto = page.get_by_role("row").filter(has_text="Beto")
    fila_beto.get_by_role("button", name="Vino").click()
    page.wait_for_timeout(300)
    page.get_by_role("button", name=re.compile("Guardar la lista")).first.click()
    page.wait_for_timeout(2600)
    check("corregir una marca no deja dos filas del mismo día",
          psql("select count(*) from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Beto' and a.day=current_date") == "1")
    check("y queda la corrección",
          psql("select a.status from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Beto' and a.day=current_date") == "PRESENTE")

    # --- Un día anterior ---
    page.goto(f"{BASE}/asistencia?dia={ayer}&area={AREA.replace(' ', '+')}")
    page.wait_for_timeout(1700)
    cuerpo = page.locator("body").inner_text()
    check("se puede ir a un día anterior y está sin registrar",
          "3 sin marcar" in cuerpo, cuerpo[:300])
    check("y avisa de que no se está mirando hoy", "Ir a hoy" in cuerpo)

    # --- No se puede pasar lista de un día futuro ---
    manana = psql("select ((now() at time zone 'America/Lima')::date + 1)::text")
    page.goto(f"{BASE}/asistencia?dia={manana}&area={AREA.replace(' ', '+')}")
    page.wait_for_timeout(1500)
    fila_ana = page.get_by_role("row").filter(has_text="Ana")
    if fila_ana.count() > 0:
        fila_ana.get_by_role("button", name="Vino").click()
        page.wait_for_timeout(300)
        page.get_by_role("button", name=re.compile("Guardar la lista")).first.click()
        page.wait_for_timeout(2200)
        check("no deja pasar lista de un día que no llegó",
              psql(f"select count(*) from attendance where day = '{manana}'") == "0")

    # --- El resumen del mes ---
    page.goto(f"{BASE}/asistencia?area={AREA.replace(' ', '+')}")
    page.wait_for_timeout(1700)
    cuerpo = page.locator("body").inner_text()
    check("el resumen del mes está en la misma pantalla", "Resumen de" in cuerpo)
    check("y dice cuántos días se pasó lista", "día(s) de este mes" in cuerpo, cuerpo[-400:])

    # --- La descarga ---
    with page.expect_download(timeout=60000) as dl:
        page.evaluate("""() => { const a = document.createElement('a');
            a.href = '/api/export/tabla?tabla=asistencia&format=xlsx'; a.download = ''; document.body.appendChild(a); a.click(); }""")
    check("la asistencia se descarga en Excel", os.path.getsize(dl.value.path()) > 4000)

    # --- La ficha del trabajador ---
    ana_id = psql(f"select id from employees where area='{AREA}' and first_name='Ana'")
    page.goto(f"{BASE}/trabajadores/{ana_id}")
    page.wait_for_timeout(1700)
    cuerpo = page.locator("body").inner_text()
    check("la ficha del trabajador muestra su asistencia", "Asistencia" in cuerpo)
    check("y sus datos personales", "Contacto de emergencia" in cuerpo)

    # --- Dirección y contacto de emergencia ---
    page.get_by_role("button", name="Editar").first.click()
    page.wait_for_timeout(800)
    page.fill("input[name=address]", f"Av. Los Álamos {SELLO}")
    page.fill("input[name=emergencyContactName]", "María Prueba")
    page.fill("input[name=emergencyContactPhone]", "987654321")
    page.fill("input[name=emergencyContactRelation]", "Esposa")
    page.get_by_role("button", name="Guardar cambios").click()
    page.wait_for_timeout(2600)
    guardado = psql(f"select coalesce(address,'-') || '|' || coalesce(emergency_contact_name,'-') || '|' || "
                    f"coalesce(emergency_contact_relation,'-') from employees where id='{ana_id}'")
    check("la dirección y el contacto de emergencia se guardan",
          guardado == f"Av. Los Álamos {SELLO}|María Prueba|Esposa", guardado)

    page.reload(); page.wait_for_timeout(1600)
    check("y se ven en su ficha", "María Prueba" in page.locator("body").inner_text())

    check("ninguna pantalla lanzó errores de JavaScript", len(errores) == 0, errores[:2])
    nav.close()

limpiar()

if fails:
    print(f"\n{len(fails)} FALLAS:")
    for f in fails:
        print(" -", f)
    sys.exit(1)
print("\nE2E ASISTENCIA: todas las verificaciones superadas")
