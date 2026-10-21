"""
Recorrido de extremo a extremo del mantenimiento de la flota.

Lo que se comprueba es lo que decide si el módulo sirve: que registrar un servicio adelante
el kilometraje de la unidad, que lo vencido salte de entrada, y que un rol de mantenimiento
pueda hacer su trabajo sin ver las facturas de nadie.

    python3 tests/e2e-mantenimiento.py
"""
import os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
PLACA = f"MT{SELLO[0]}-{SELLO[1:4]}"
MECANICO = f"mec{SELLO}"
CLAVE = "Mecanico123!"

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


def sql_stdin(sql):
    """
    SQL por la entrada estándar.

    Hace falta para el hash de la contraseña: un bcrypt empieza por "$2b$10$" y, pasado
    como argumento del shell, "$2b" se expande como una variable vacía y el usuario queda
    con una contraseña que no es ninguna.
    """
    subprocess.run(["su", "postgres", "-c", f"psql -q -d {DB}"], input=sql.encode(), check=True,
                   stdout=subprocess.DEVNULL)


def limpiar():
    ejecutar("delete from vehicles where plate like 'MT%-%'")
    ejecutar(f"delete from users where username like 'mec%'")


def login(page, usuario, clave):
    page.goto(f"{BASE}/login")
    page.wait_for_timeout(900)
    page.fill("input[name=identifier]", usuario)
    page.fill("input[name=password]", clave)
    page.click("button[type=submit]")
    page.wait_for_url(re.compile(r"/(dashboard|facturas|mantenimiento|documentos)"), timeout=20000)


limpiar()
# Una unidad con 120.000 km y un aceite hecho hace tiempo, a 112.000: le faltan 2.000 km.
ejecutar("insert into vehicles (plate, brand, model, year, odometer_km, odometer_at) "
         f"values ('{PLACA}', 'Volvo', 'FH 440', 2018, 120000, current_date)")
vid = psql(f"select id from vehicles where plate = '{PLACA}'")
ejecutar("insert into maintenance_records (vehicle_id, kind, serviced_at, odometer_km) "
         f"values ('{vid}', 'ACEITE', current_date - 40, 112000)")
# Un lavado de hace 20 días, con regla de 15: vencido.
ejecutar("insert into maintenance_records (vehicle_id, kind, serviced_at) "
         f"values ('{vid}', 'LAVADO', current_date - 20)")

with sync_playwright() as p:
    nav = p.chromium.launch()
    ctx = nav.new_context(viewport={"width": 1440, "height": 950}, accept_downloads=True)
    page = ctx.new_page()
    errores = []
    page.on("pageerror", lambda e: errores.append(f"{page.url} → {e}"))

    login(page, USER, PASS)

    # --- La pantalla de mantenimiento ---
    # El menú pliega las secciones que no se están usando, así que la de Flota se abre
    # cuando se entra a una de sus pantallas.
    page.goto(f"{BASE}/mantenimiento")
    page.wait_for_timeout(1400)
    check("estando en Mantenimiento, su sección del menú está abierta",
          page.locator("a[href='/mantenimiento']").first.is_visible())
    # El menú pinta los títulos en mayúsculas por estilo, así que se compara sin distinguir.
    menu_admin = page.locator("nav[aria-label=Principal]").inner_text().upper()
    check("y la sección se llama Flota", "FLOTA" in menu_admin, menu_admin[:120])
    check("las secciones que no se usan están plegadas: no se ve el inventario desde aquí",
          "INVENTARIO" not in menu_admin, menu_admin[:200])

    page.goto(f"{BASE}/mantenimiento")
    page.wait_for_timeout(1600)
    expect(page.get_by_role("heading", name="Mantenimiento")).to_be_visible()

    activa = page.locator("[role=tab][aria-selected=true]").inner_text()
    check("se entra por lo vencido", "Vencido" in activa, activa)

    fila_lavado = page.get_by_role("row").filter(has_text=PLACA).filter(has_text="Lavado")
    expect(fila_lavado).to_be_visible()
    check("el lavado de hace 20 días sale vencido", "Vencido" in fila_lavado.inner_text(), fila_lavado.inner_text())

    # El aceite está al día: le faltan 2.000 km.
    page.goto(f"{BASE}/mantenimiento?estado=&tipo=ACEITE")
    page.wait_for_timeout(1500)
    fila_aceite = page.get_by_role("row").filter(has_text=PLACA)
    texto = fila_aceite.inner_text()
    check("el aceite muestra cuándo se hizo y a qué kilómetro", "112,000 km" in texto, texto)
    check("y cuánto falta, en kilómetros", "2,000 km" in texto, texto)
    check("la unidad muestra su kilometraje actual", "120,000 km" in texto, texto)

    # --- Registrar un mantenimiento adelanta el kilometraje ---
    page.goto(f"{BASE}/documentos/vehiculos/{vid}")
    page.wait_for_timeout(1600)
    check("la ficha de la unidad trae su panel de mantenimiento", "Mantenimiento" in page.content())

    page.get_by_role("button", name="Registrar mantenimiento").click()
    page.wait_for_timeout(700)
    page.select_option("select[name=kind]", "FRENOS")
    page.fill("input[name=odometerKm]", "124500")
    page.fill("input[name=workshop]", f"Taller {SELLO}")
    page.fill("input[name=cost]", "350")
    page.get_by_role("button", name="Registrar", exact=True).click()
    page.wait_for_timeout(2600)

    check("el servicio queda guardado",
          psql(f"select count(*) from maintenance_records where vehicle_id = '{vid}' and kind = 'FRENOS'") == "1")
    check("y adelanta el kilometraje de la unidad, sin tener que anotarlo aparte",
          psql(f"select odometer_km from vehicles where id = '{vid}'") == "124500",
          psql(f"select odometer_km from vehicles where id = '{vid}'"))

    # Al subir el kilometraje a 124.500, el aceite (que tocaba a 122.000) queda vencido.
    page.goto(f"{BASE}/mantenimiento?estado=VENCIDO&tipo=ACEITE")
    page.wait_for_timeout(1500)
    check("con el kilometraje nuevo, el aceite pasa a estar vencido",
          PLACA in page.content())

    # --- Un kilometraje que retrocede se rechaza ---
    page.goto(f"{BASE}/documentos/vehiculos/{vid}")
    page.wait_for_timeout(1500)
    page.get_by_role("button", name="Registrar mantenimiento").click()
    page.wait_for_timeout(700)
    page.select_option("select[name=kind]", "ENGRASE")
    page.fill("input[name=odometerKm]", "12450")
    page.get_by_role("button", name="Registrar", exact=True).click()
    page.wait_for_timeout(2200)
    cuerpo = page.locator("body").inner_text()
    check("un kilometraje menor que el de la unidad se rechaza, por ser un error de tecleo",
          "Revisa el número" in cuerpo or "ya tiene" in cuerpo, cuerpo[-300:])
    check("y no se guardó",
          psql(f"select count(*) from maintenance_records where vehicle_id = '{vid}' and kind = 'ENGRASE'") == "0")
    page.keyboard.press("Escape")

    # --- Cambiar la periodicidad de una unidad ---
    page.goto(f"{BASE}/mantenimiento?estado=&tipo=LAVADO")
    page.wait_for_timeout(1500)
    page.get_by_role("row").filter(has_text=PLACA).locator("button[title='Cambiar cada cuánto toca']").click()
    page.wait_for_timeout(700)
    page.fill("input[name=everyDays]", "30")
    page.get_by_role("button", name="Guardar la periodicidad").click()
    page.wait_for_timeout(2400)
    check("la periodicidad propia queda guardada",
          psql(f"select every_days from maintenance_plans where vehicle_id = '{vid}' and kind = 'LAVADO'") == "30")
    page.reload(); page.wait_for_timeout(1600)
    check("y la pantalla avisa de que esa unidad tiene su propia regla",
          "propia de la unidad" in page.get_by_role("row").filter(has_text=PLACA).inner_text())

    # --- La descarga del módulo ---
    with page.expect_download(timeout=60000) as dl:
        page.evaluate("""() => { const a = document.createElement('a');
            a.href = '/api/export/tabla?tabla=mantenimiento&format=xlsx'; a.download = ''; document.body.appendChild(a); a.click(); }""")
    check("el Excel de mantenimiento se descarga", os.path.getsize(dl.value.path()) > 4000)

    # --- El rol de mantenimiento ---
    sql_stdin(
        "insert into users (name, username, email, password_hash, role) "
        f"select 'Mecánico {SELLO}', '{MECANICO}', '{MECANICO}@transjer.pe', password_hash, 'MANTENIMIENTO' "
        "from users where username = 'admin';"
    )
    check("el usuario de mantenimiento se creó",
          psql(f"select role from users where username = '{MECANICO}'") == "MANTENIMIENTO")

    ctx2 = nav.new_context(viewport={"width": 1440, "height": 950})
    page2 = ctx2.new_page()
    errores2 = []
    page2.on("pageerror", lambda e: errores2.append(f"{page2.url} → {e}"))
    login(page2, MECANICO, PASS)

    page2.goto(f"{BASE}/mantenimiento")
    page2.wait_for_timeout(1600)
    check("el rol de mantenimiento entra a su módulo",
          page2.get_by_role("heading", name="Mantenimiento").is_visible())
    check("y puede registrar servicios",
          page2.get_by_role("button", name="Registrar mantenimiento").count() >= 0)

    menu = page2.locator("nav[aria-label=Principal]").inner_text()
    page2.goto(f"{BASE}/mantenimiento"); page2.wait_for_timeout(1200)
    menu = page2.locator("nav[aria-label=Principal]").inner_text()
    check("ve los documentos de la flota", "Documentos" in menu, menu)
    check("pero NO ve facturas", "Facturas" not in menu, menu)
    check("ni detracciones", "Detracciones" not in menu, menu)
    check("ni el almacén", "Inventario" not in menu, menu)
    check("ni usuarios", "Usuarios" not in menu, menu)

    for ruta in ["/facturas", "/inventario", "/usuarios"]:
        page2.goto(BASE + ruta)
        page2.wait_for_timeout(1000)
        check(f"y si escribe {ruta} a mano, no entra", not page2.url.endswith(ruta), page2.url)

    check("ninguna pantalla del mecánico lanzó errores de JavaScript", len(errores2) == 0, errores2[:2])
    ctx2.close()

    check("ninguna pantalla lanzó errores de JavaScript", len(errores) == 0, errores[:2])
    nav.close()

limpiar()

if fails:
    print(f"\n{len(fails)} FALLAS:")
    for f in fails:
        print(" -", f)
    sys.exit(1)
print("\nE2E MANTENIMIENTO: todas las verificaciones superadas")
