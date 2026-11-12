"""
Recorrido de extremo a extremo del directorio de clientes de provincia.

Lo que decide si sirve es una sola cosa: que salga un viaje, se escriba el nombre del
destinatario y aparezca todo lo demás —ubicación, teléfonos, estibador y cuánto cobra la
estiba— sin tener que preguntar por WhatsApp.

    python3 tests/e2e-clientes-provincia.py
"""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=15000)
BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
PROVINCIA = f"Jaén {SELLO}"
CLIENTE = f"Comercial Mesones {SELLO}"

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


def enviar(page, etiqueta, timeout=15000):
    page.get_by_role("button", name=etiqueta).click()
    page.wait_for_selector("div.fixed.inset-0.z-50", state="detached", timeout=timeout)
    page.wait_for_timeout(700)


ejecutar("delete from province_clients where province like 'Jaén %' or client_name like 'Comercial Mesones %'")

with sync_playwright() as p:
    nav = p.chromium.launch()
    ctx = nav.new_context(viewport={"width": 1440, "height": 950})
    page = ctx.new_page()
    errores = []
    page.on("pageerror", lambda e: errores.append(f"{page.url} → {str(e)[:140]}"))

    page.goto(f"{BASE}/login")
    page.fill("input[name=identifier]", USER)
    page.fill("input[name=password]", PASS)
    page.click("button[type=submit]")
    page.wait_for_url(f"{BASE}/dashboard", timeout=30000)

    # --- Está en el menú, dentro de Flota ---
    page.goto(f"{BASE}/clientes-provincia")
    page.wait_for_timeout(1500)
    check("la pantalla carga", "Clientes de provincia" in page.content())
    check("y explica para qué es", "estiba" in page.content().lower())

    # --- Registrar un cliente ---
    page.get_by_role("button", name="Nuevo cliente").click()
    page.wait_for_timeout(700)
    page.fill("input[name=province]", PROVINCIA)
    page.fill("input[name=clientName]", CLIENTE)
    page.fill("input[name=location]", "Av. Mesones Muro 1250, frente al grifo")
    page.fill("input[name=clientPhone]", "976543210")
    page.locator("input[name=estiba_nombre]").first.fill("Don Lucho")
    page.locator("input[name=estiba_telefono]").first.fill("912345678")
    page.locator("input[name=estiba_costo]").first.fill("35")
    page.fill("textarea[name=notes]", "Recibe hasta las 5 p.m.")
    enviar(page, "Registrar cliente")

    guardado = psql("select province || '|' || client_name || '|' || coalesce(cost_per_ton::text,'-') "
                    f"from province_clients where client_name = '{CLIENTE}'")
    check("el cliente queda registrado con su provincia y su precio",
          guardado == f"{PROVINCIA}|{CLIENTE}|35.00", guardado)

    cuerpo = page.content()
    check("y sale en la tabla con el estibador y el costo",
          CLIENTE in cuerpo and "Don Lucho" in cuerpo and "35.00" in cuerpo)

    # --- No se puede repetir en la misma provincia ---
    page.get_by_role("button", name="Nuevo cliente").click()
    page.wait_for_timeout(700)
    page.fill("input[name=province]", PROVINCIA.upper())
    page.fill("input[name=clientName]", CLIENTE.upper())
    page.get_by_role("button", name="Registrar cliente").click()
    page.wait_for_timeout(2200)
    check("avisa si ya está registrado en esa provincia", "ya está registrado" in page.content())
    check("y no quedó duplicado",
          psql(f"select count(*) from province_clients where upper(client_name) = upper('{CLIENTE}')") == "1")
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)

    # --- La búsqueda, que es para lo que se entra ---
    page.goto(f"{BASE}/clientes-provincia?q=comercial+mesones")
    page.wait_for_timeout(1500)
    cuerpo = page.content()
    check("buscando el nombre en minúsculas aparece la ficha", CLIENTE in cuerpo)
    check("con su ubicación", "Mesones Muro" in cuerpo)
    check("y con los dos teléfonos a la mano", "976543210" in cuerpo and "912345678" in cuerpo)

    page.goto(f"{BASE}/clientes-provincia?q=976543")
    page.wait_for_timeout(1400)
    check("también se encuentra por el teléfono", CLIENTE in page.content())

    # --- Corregir un dato suelto ---
    page.goto(f"{BASE}/clientes-provincia?q={SELLO}")
    page.wait_for_timeout(1400)
    fila = page.get_by_role("row").filter(has_text=CLIENTE).first
    fila.get_by_role("button", name="Editar").click()
    page.wait_for_timeout(700)
    page.locator("input[name=estiba_costo]").first.fill("42.50")
    enviar(page, "Guardar cambios")
    check("el precio corregido queda guardado",
          psql(f"select cost_per_ton from province_clients where client_name = '{CLIENTE}'") == "42.50")

    # --- Dar de baja y reactivar ---
    fila = page.get_by_role("row").filter(has_text=CLIENTE).first
    fila.get_by_role("button", name="Dar de baja").click()
    page.wait_for_timeout(600)
    page.get_by_role("button", name="Dar de baja").last.click()
    page.wait_for_timeout(2200)
    check("al darlo de baja desaparece del directorio",
          psql(f"select active from province_clients where client_name = '{CLIENTE}'") == "f")
    check("pero no se borra", psql(f"select count(*) from province_clients where client_name = '{CLIENTE}'") == "1")

    page.goto(f"{BASE}/clientes-provincia?q={SELLO}&inactivos=1")
    page.wait_for_timeout(1500)
    check("se puede volver a ver pidiendo los dados de baja", CLIENTE in page.content())

    # --- El Excel ---
    page.goto(f"{BASE}/clientes-provincia")
    page.wait_for_timeout(1200)
    page.get_by_role("button", name="Exportar").click()
    page.wait_for_timeout(500)
    with page.expect_download() as dl:
        page.click("a[role=menuitem]:has-text('Excel')")
    archivo = dl.value.path()
    check("el directorio se descarga en Excel", os.path.getsize(archivo) > 3000, os.path.getsize(archivo))

    check("ninguna pantalla lanzó errores de JavaScript", len(errores) == 0, errores[:2])
    nav.close()

ejecutar(f"delete from province_clients where client_name like '%{SELLO}'")

if fails:
    print(f"\n{len(fails)} FALLAS:")
    for f in fails:
        print(" -", f)
    sys.exit(1)
print("\nE2E CLIENTES DE PROVINCIA: todas las verificaciones superadas")
