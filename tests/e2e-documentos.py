"""
Recorrido de extremo a extremo del archivo de documentos.

Lo que se comprueba es lo que distingue esto de una carpeta compartida: que lo vencido se
vea de entrada, que el PDF baje íntegro, y que los permisos aguanten.

    python3 tests/e2e-documentos.py
"""
import os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
PLACA = f"XX-{SELLO[:3]}"

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
    ejecutar(f"delete from vehicles where plate like 'XX-%'")


limpiar()

# Una unidad con un documento vencido y otro por vencer. Se insertan directo porque lo que
# se prueba aquí es la pantalla, no el formulario de subida.
ejecutar(f"insert into vehicles (plate, description) values ('{PLACA}', 'Unidad de prueba')")
vid = psql(f"select id from vehicles where plate = '{PLACA}'")
ejecutar(
    "insert into documents (vehicle_id, kind, title, expires_at, filename, content_type, size_bytes, storage_driver, content) "
    f"values ('{vid}', 'SOAT', 'SOAT {SELLO}', current_date - 5, 'soat-{SELLO}.pdf', 'application/pdf', 5, 'db', '\\x25504446'::bytea)"
)
ejecutar(
    "insert into documents (vehicle_id, kind, title, expires_at, filename, content_type, size_bytes, storage_driver, content) "
    f"values ('{vid}', 'REVISION_TECNICA', 'RT {SELLO}', current_date + 10, 'rt-{SELLO}.pdf', 'application/pdf', 5, 'db', '\\x25504446'::bytea)"
)
ejecutar(
    "insert into documents (vehicle_id, kind, title, filename, content_type, size_bytes, storage_driver, content) "
    f"values ('{vid}', 'TARJETA_PROPIEDAD', 'TP {SELLO}', 'tp-{SELLO}.pdf', 'application/pdf', 5, 'db', '\\x25504446'::bytea)"
)

with sync_playwright() as p:
    nav = p.chromium.launch()
    ctx = nav.new_context(viewport={"width": 1440, "height": 950}, accept_downloads=True)
    page = ctx.new_page()
    errores = []
    page.on("pageerror", lambda e: errores.append(f"{page.url} → {e}"))

    page.goto(f"{BASE}/login")
    page.fill("input[name=identifier]", USER)
    page.fill("input[name=password]", PASS)
    page.click("button[type=submit]")
    page.wait_for_url(re.compile(r"/(dashboard|facturas)"), timeout=15000)

    # --- El menú y la pantalla general ---
    check("el menú muestra Documentos", page.locator("a[href='/documentos']").first.is_visible())

    page.goto(f"{BASE}/documentos")
    page.wait_for_timeout(1500)
    expect(page.get_by_role("heading", name="Documentos")).to_be_visible()

    # Se entra por lo vencido: de eso se trata tener esto en el sistema.
    activa = page.locator("[role=tab][aria-selected=true]").inner_text()
    check("se entra directo por lo vencido", "Vencido" in activa, activa)
    cuerpo = page.content()
    check("el vencido aparece en la lista", f"SOAT {SELLO}" in cuerpo)
    check("y avisa arriba de cuántos hay", "están vencidos" in cuerpo)

    # La pestaña de lo que vence pronto trae el otro, no el vencido.
    page.goto(f"{BASE}/documentos?estado=POR_VENCER")
    page.wait_for_timeout(1200)
    cuerpo = page.content()
    check("la pestaña de por vencer trae la revisión técnica", f"RT {SELLO}" in cuerpo)
    check("y no mezcla el que ya venció", f"SOAT {SELLO}" not in cuerpo)

    # Los que no caducan no se cuentan como vencidos ni como vigentes.
    page.goto(f"{BASE}/documentos?estado=SIN_FECHA")
    page.wait_for_timeout(1200)
    check("los que no caducan están aparte", f"TP {SELLO}" in page.content())

    # --- La flota ---
    page.goto(f"{BASE}/documentos/vehiculos")
    page.wait_for_timeout(1400)
    fila = page.get_by_role("row").filter(has_text=PLACA)
    expect(fila).to_be_visible()
    check("la unidad muestra que tiene un documento vencido", "vencido" in fila.inner_text().lower(), fila.inner_text())
    check("y cuántos documentos tiene", "3" in fila.inner_text(), fila.inner_text())

    # --- La ficha de la unidad ---
    page.goto(f"{BASE}/documentos/vehiculos/{vid}")
    page.wait_for_timeout(1400)
    expect(page.get_by_role("heading", name=PLACA)).to_be_visible()
    cuerpo = page.content()
    check("la ficha lista los tres documentos",
          all(t in cuerpo for t in [f"SOAT {SELLO}", f"RT {SELLO}", f"TP {SELLO}"]))
    check("y nombra cuál está vencido", "documento(s) vencido(s)" in cuerpo)

    # --- Descargar el archivo ---
    with page.expect_download() as dl:
        page.locator("tbody a[href^='/api/documentos/']").first.click()
    datos = open(dl.value.path(), "rb").read()
    check("el archivo se descarga íntegro", datos == b"%PDF", datos[:10])

    # --- La ficha del trabajador ---
    # Los papeles del trabajador se buscan donde está el trabajador, no en otra pantalla.
    emp = psql("select id from employees where active = true limit 1")
    if emp:
        ejecutar(
            "insert into documents (employee_id, kind, title, expires_at, filename, content_type, size_bytes, storage_driver, content) "
            f"values ('{emp}', 'LICENCIA', 'Licencia {SELLO}', current_date - 2, 'lic-{SELLO}.pdf', 'application/pdf', 5, 'db', '\\x25504446'::bytea)"
        )
        page.goto(f"{BASE}/trabajadores/{emp}")
        page.wait_for_timeout(1600)
        cuerpo = page.content()
        check("la ficha del trabajador muestra sus documentos", f"Licencia {SELLO}" in cuerpo)
        check("y avisa que tiene uno vencido", "documento(s) vencido(s)" in cuerpo)
        ejecutar(f"delete from documents where title = 'Licencia {SELLO}'")

    # --- Subir un documento desde la web ---
    page.goto(f"{BASE}/documentos/vehiculos/{vid}")
    page.wait_for_timeout(1400)
    # Es lo que se va a hacer todos los días, así que se prueba por donde lo hace la gente:
    # el formulario, no la base.
    suelto = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"tmp-{SELLO}.pdf")
    open(suelto, "wb").write(b"%PDF-1.4\n% prueba\n")
    try:
        page.get_by_role("button", name="Subir documento").click()
        page.wait_for_timeout(600)
        page.select_option("select[name=kind]", "TARJETA_CIRCULACION")
        page.fill("input[name=title]", f"TUC {SELLO}")
        page.locator("#expiresAt").fill("31/03/2027")
        page.set_input_files("input[name=archivo]", suelto)
        page.get_by_role("button", name="Guardar documento").click()
        page.wait_for_timeout(2500)
        cuerpo = page.content()
        check("el documento subido desde la web aparece en la ficha", f"TUC {SELLO}" in cuerpo)
        check("y se guardó con su fecha de vencimiento",
              psql(f"select expires_at from documents where title = 'TUC {SELLO}'") == "2027-03-31",
              psql(f"select expires_at from documents where title = 'TUC {SELLO}'"))
    finally:
        os.path.exists(suelto) and os.remove(suelto)

    # --- Permisos ---
    # Un enlace de descarga reenviado por correo no debe servirle a nadie de fuera: el
    # archivo solo sale con sesión abierta.
    doc = psql(f"select id from documents where vehicle_id = '{vid}' limit 1")
    nav2 = p.chromium.launch()
    anon = nav2.new_context()
    sin_sesion = anon.request.get(f"{BASE}/api/documentos/{doc}")
    check("sin sesión no se descarga nada", sin_sesion.status == 401, sin_sesion.status)
    nav2.close()

    check("ninguna pantalla lanzó errores de JavaScript", len(errores) == 0, errores[:2])
    nav.close()

limpiar()

if fails:
    print(f"\n{len(fails)} FALLAS:")
    for f in fails:
        print(" -", f)
    sys.exit(1)
print("\nE2E DOCUMENTOS: todas las verificaciones superadas")
