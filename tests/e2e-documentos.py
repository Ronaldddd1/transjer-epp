"""
Recorrido de extremo a extremo del archivo de documentos.

Lo que se comprueba es lo que distingue esto de una carpeta compartida: que la flota se vea
unidad por unidad con sus papeles, que lo vencido y lo que falta salten de entrada, que el
PDF baje íntegro, que no entre un archivo que después no se va a poder ver, y que los
permisos aguanten.

    python3 tests/e2e-documentos.py
"""
import os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
# Una placa con la forma de verdad —tres caracteres, guion, tres— porque el sistema las
# normaliza a ese molde: con "XX-123" el formulario la reescribiría como "XX1-23".
PLACA = f"XX{SELLO[0]}-{SELLO[1:4]}"
PLACA2 = f"XX{SELLO[0]}-9{SELLO[1:3]}"
PLACA3 = f"XX{SELLO[0]}-8{SELLO[1:3]}"

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
    ejecutar("delete from vehicles where plate like 'XX_-%'")


def pdf_valido(ruta, kb=12):
    """Un PDF completo y con páginas, del peso que pide el sistema para un escaneo."""
    cuerpo = (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        b"trailer << /Root 1 0 R >>\n"
    )
    relleno = b"% " + b"r" * (kb * 1024) + b"\n"
    open(ruta, "wb").write(cuerpo + relleno + b"%%EOF")


limpiar()

# Una unidad con el SOAT vencido, la revisión técnica por vencer y la tarjeta sin fecha.
# Se insertan directo porque lo que se prueba aquí es la pantalla, no el formulario.
ejecutar(f"insert into vehicles (plate, description, brand, model, year, capacity_tn, has_gps) "
         f"values ('{PLACA}', 'Unidad de prueba', 'Volvo', 'FH 440', 2018, 30, true)")
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
# Un MTC cargado solo con su fecha, como los que deja el Excel de mantenimiento: sin PDF.
ejecutar(
    "insert into documents (vehicle_id, kind, title, expires_at) "
    f"values ('{vid}', 'MTC', 'MTC {SELLO}', current_date + 120)"
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

    # --- La flota, que es la pantalla principal ---
    # El menú pliega las secciones largas, así que la de Flota se abre al entrar en una de
    # sus pantallas.
    page.goto(f"{BASE}/documentos")
    page.wait_for_timeout(1200)
    check("el menú muestra Documentos", page.locator("a[href='/documentos']").first.is_visible())

    page.goto(f"{BASE}/documentos")
    page.wait_for_timeout(1600)
    expect(page.get_by_role("heading", name="Documentos")).to_be_visible()

    activa = page.locator("[role=tab][aria-selected=true]").inner_text()
    check("se entra directo por lo que tiene algo vencido", "vencido" in activa.lower(), activa)
    check("y avisa arriba cuántas unidades están así", "unidad(es)" in page.content())

    fila = page.get_by_role("row").filter(has_text=PLACA)
    expect(fila).to_be_visible()
    texto = fila.inner_text()
    check("la fila de la unidad trae su ficha", "Volvo" in texto and "FH 440" in texto, texto)
    check("y la capacidad y el GPS", "30 TN" in texto and "GPS" in texto, texto)
    check("el SOAT vencido se ve en su columna, con los días que lleva vencido",
          "venció hace 5 d." in texto, texto)
    check("la revisión técnica avisa que vence en diez días", "en 10 d." in texto, texto)
    check("el MTC cargado sin PDF lo dice", "falta el PDF" in texto, texto)
    check("la tarjeta de propiedad sin fecha no se cuenta como vencida", "Sin fecha" in texto, texto)
    check("sin conductor asignado la fila lo dice", "Sin conductor" in texto, texto)
    check("hay un botón por cada papel con archivo",
          fila.locator("a[href^='/api/documentos/']").count() >= 3,
          fila.locator("a[href^='/api/documentos/']").count())

    ejecutar(f"insert into vehicles (plate) values ('{PLACA2}')")
    page.reload()
    page.wait_for_timeout(1500)

    # Una unidad del año no debe reclamar la revisión técnica: todavía no le toca, y
    # pintarla en rojo junto a lo que sí urge es lo que hace que se dejen de mirar los rojos.
    ejecutar(f"insert into vehicles (plate, year, brand) values ('{PLACA3}', "
             "extract(year from current_date)::int, 'Volvo')")
    page.goto(f"{BASE}/documentos?estado=")
    page.wait_for_timeout(1600)
    fila_nueva = page.get_by_role("row").filter(has_text=PLACA3)
    texto_nueva = fila_nueva.inner_text()
    anio_rt = int(psql("select extract(year from current_date)::int + 3"))
    check("una unidad del año no reclama la revisión técnica",
          "No le toca" in texto_nueva, texto_nueva)
    check("y dice desde qué año se la van a pedir", str(anio_rt) in texto_nueva, texto_nueva)
    check("pero sí reclama el SOAT, que no tiene nada que ver con la antigüedad",
          "Falta" in texto_nueva, texto_nueva)

    # La pestaña de "toda la flota" tiene que poder ganarle al filtro de entrada. Si al
    # pulsarla la pantalla volviera a aplicar su filtro por defecto, el botón parecería
    # roto: fue así hasta que la dirección pasó a decir "estado=" en vez de no decir nada.
    page.get_by_role("tab", name=re.compile("Toda la flota")).click()
    page.wait_for_timeout(1600)
    activa = page.locator("[role=tab][aria-selected=true]").inner_text()
    check("la pestaña 'Toda la flota' se queda seleccionada al pulsarla",
          "Toda la flota" in activa, activa)
    check("y muestra también las unidades que no tienen nada vencido",
          PLACA2 in page.content() and PLACA in page.content())

    # Una unidad sin uno de los cuatro papeles pesa igual que una vencida.
    page.goto(f"{BASE}/documentos?estado=FALTA")
    page.wait_for_timeout(1400)
    check("la pestaña de 'falta un papel' trae la unidad sin documentos",
          PLACA2 in page.content())

    # --- La lista plana sigue existiendo, para buscar un papel suelto ---
    page.goto(f"{BASE}/documentos/todos?estado=VENCIDO")
    page.wait_for_timeout(1400)
    cuerpo = page.content()
    check("la lista de todos los documentos trae el vencido", f"SOAT {SELLO}" in cuerpo)
    check("y no mezcla el que vence en diez días", f"RT {SELLO}" not in cuerpo)

    page.goto(f"{BASE}/documentos/todos?estado=POR_VENCER")
    page.wait_for_timeout(1200)
    check("la pestaña de por vencer trae la revisión técnica", f"RT {SELLO}" in page.content())

    page.goto(f"{BASE}/documentos/todos?estado=SIN_FECHA")
    page.wait_for_timeout(1200)
    check("los que no caducan están aparte", f"TP {SELLO}" in page.content())

    # La dirección vieja de la flota sigue llevando a algún sitio.
    page.goto(f"{BASE}/documentos/vehiculos")
    page.wait_for_timeout(1500)
    check("la dirección anterior de vehículos lleva a la flota",
          page.url.rstrip("/").endswith("/documentos"), page.url)

    # --- La ficha de la unidad ---
    page.goto(f"{BASE}/documentos/vehiculos/{vid}")
    page.wait_for_timeout(1500)
    expect(page.get_by_role("heading", name=PLACA)).to_be_visible()
    cuerpo = page.content()
    check("la ficha lista los documentos de la unidad",
          all(t in cuerpo for t in [f"SOAT {SELLO}", f"RT {SELLO}", f"TP {SELLO}", f"MTC {SELLO}"]))
    check("y nombra cuál está vencido", "documento(s) vencido(s)" in cuerpo)
    check("la ficha muestra marca, modelo y año", "Volvo" in cuerpo and "2018" in cuerpo)
    check("el cuadro de los cuatro papeles clave está", "Los papeles que no pueden faltar" in cuerpo)
    check("y dice que no hay conductor asignado", "no tiene conductor asignado" in cuerpo.lower())

    # --- Descargar el archivo ---
    with page.expect_download() as dl:
        page.locator("tbody a[href^='/api/documentos/']").first.click()
    datos = open(dl.value.path(), "rb").read()
    check("el archivo se descarga íntegro", datos == b"%PDF", datos[:10])

    # El documento sin archivo no ofrece un enlace que lleve a un error.
    sin_archivo = psql(f"select id from documents where title = 'MTC {SELLO}'")
    r = page.evaluate(
        """async (id) => {
            const res = await fetch(`/api/documentos/${id}`);
            return { status: res.status, texto: await res.text() };
        }""",
        sin_archivo,
    )
    check("un documento sin archivo no se descarga, y lo explica",
          r["status"] == 404 and "archivo" in r["texto"].lower(), f"{r['status']} {r['texto'][:90]}")

    # --- El conductor asignado ---
    emp = psql("select id from employees where active = true limit 1")
    nombre = psql(f"select concat_ws(' ', first_name, last_name) from employees where id = '{emp}'") if emp else ""
    if emp:
        ejecutar(
            "insert into documents (employee_id, kind, title, expires_at, filename, content_type, size_bytes, storage_driver, content) "
            f"values ('{emp}', 'LICENCIA', 'Licencia {SELLO}', current_date + 300, 'lic-{SELLO}.pdf', 'application/pdf', 5, 'db', '\\x25504446'::bytea)"
        )
        ejecutar(f"update vehicles set driver_id = '{emp}' where id = '{vid}'")

        page.goto(f"{BASE}/documentos")
        page.wait_for_timeout(1600)
        fila = page.get_by_role("row").filter(has_text=PLACA)
        texto = fila.inner_text()
        check("el conductor asignado aparece en la fila de su unidad", nombre.split(" ")[0] in texto, texto)
        check("y su licencia con la fecha", "Licencia:" in texto, texto)

        page.goto(f"{BASE}/documentos/vehiculos/{vid}")
        page.wait_for_timeout(1500)
        cuerpo = page.content()
        check("la ficha de la unidad muestra al conductor", nombre.split(" ")[0] in cuerpo)
        check("con un enlace a su licencia", "Ver PDF" in cuerpo)
        check("y avisa que no tiene el DNI cargado", "DNI" in cuerpo)

        # La licencia vencida del conductor arrastra a la unidad: sin ella no maneja.
        ejecutar(f"update documents set expires_at = current_date - 1 where title = 'Licencia {SELLO}'")
        page.goto(f"{BASE}/documentos/vehiculos/{vid}")
        page.wait_for_timeout(1500)
        check("una licencia vencida se avisa en la unidad",
              "conductor tiene" in page.content().lower())

        page.goto(f"{BASE}/trabajadores/{emp}")
        page.wait_for_timeout(1600)
        check("y los papeles del trabajador siguen en su ficha", f"Licencia {SELLO}" in page.content())

        ejecutar(f"update vehicles set driver_id = null where id = '{vid}'")
        ejecutar(f"delete from documents where title = 'Licencia {SELLO}'")

    # --- Subir un documento desde la web ---
    carpeta = os.path.dirname(os.path.abspath(__file__))
    bueno = os.path.join(carpeta, f"tmp-{SELLO}.pdf")
    cortado = os.path.join(carpeta, f"tmp-cortado-{SELLO}.pdf")
    falso = os.path.join(carpeta, f"tmp-falso-{SELLO}.pdf")
    pdf_valido(bueno)
    # Pesa lo suficiente para que no lo frene el mínimo de tamaño: lo que falla es que
    # se cortó antes del %%EOF, que es como llega un PDF cuya subida se interrumpió.
    open(cortado, "wb").write(
        b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        + b"% " + b"r" * (12 * 1024) + b"\n% se corto la subida aqui"
    )
    # Un Word al que alguien le cambió la extensión: el caso que de verdad pasa.
    open(falso, "wb").write(b"PK\x03\x04" + b"\x00" * 20000)

    try:
        page.goto(f"{BASE}/documentos/vehiculos/{vid}")
        page.wait_for_timeout(1400)
        page.get_by_role("button", name="Subir documento").click()
        page.wait_for_timeout(600)
        page.select_option("select[name=kind]", "TARJETA_CIRCULACION")
        page.fill("input[name=title]", f"TUC {SELLO}")
        page.locator("#expiresAt").fill("31/03/2027")

        # 1) Un PDF cortado no entra, y el motivo se entiende sin ser informático.
        page.set_input_files("input[name=archivo]", cortado)
        page.get_by_role("button", name="Guardar documento").click()
        page.wait_for_timeout(2200)
        aviso = page.content()
        check("un PDF cortado a mitad de la subida se rechaza",
              "incompleto" in aviso.lower(), aviso[-400:] if "incompleto" not in aviso.lower() else "")
        check("y no quedó guardado", psql(f"select count(*) from documents where title = 'TUC {SELLO}'") == "0")

        # 2) Un Word renombrado a .pdf tampoco.
        page.set_input_files("input[name=archivo]", falso)
        page.get_by_role("button", name="Guardar documento").click()
        page.wait_for_timeout(2200)
        aviso = page.content()
        check("un archivo que por dentro no es un PDF ni una foto se rechaza",
              "no es un pdf ni una foto" in aviso.lower(), aviso[-400:] if "no es un pdf" not in aviso.lower() else "")

        # 3) El bueno sí.
        page.set_input_files("input[name=archivo]", bueno)
        page.get_by_role("button", name="Guardar documento").click()
        page.wait_for_timeout(2600)
        cuerpo = page.content()
        check("el documento bueno subido desde la web aparece en la ficha", f"TUC {SELLO}" in cuerpo)
        check("y se guardó con su fecha de vencimiento",
              psql(f"select expires_at from documents where title = 'TUC {SELLO}'") == "2027-03-31",
              psql(f"select expires_at from documents where title = 'TUC {SELLO}'"))

        # --- Adjuntar el PDF a un documento que solo tenía la fecha ---
        # Es el camino de los que entran por el Excel: primero la fecha, el papel después.
        page.goto(f"{BASE}/documentos/vehiculos/{vid}")
        page.wait_for_timeout(1500)
        page.get_by_role("row").filter(has_text=f"MTC {SELLO}").locator("button[title='Corregir los datos']").click()
        page.wait_for_timeout(700)
        page.set_input_files("input[name=archivo]", bueno)
        page.get_by_role("button", name="Guardar cambios").click()
        page.wait_for_timeout(2600)
        check("el PDF se adjunta al documento que solo tenía la fecha, sin crear otro",
              psql(f"select count(*) from documents where vehicle_id = '{vid}' and kind = 'MTC'") == "1",
              psql(f"select count(*) from documents where vehicle_id = '{vid}' and kind = 'MTC'"))
        check("y ese documento ya tiene archivo",
              psql(f"select filename is not null from documents where title = 'MTC {SELLO}'") == "t")
        check("sin perder su fecha de vencimiento",
              psql(f"select expires_at = current_date + 120 from documents where title = 'MTC {SELLO}'") == "t")
    finally:
        for f in (bueno, cortado, falso):
            os.path.exists(f) and os.remove(f)

    # --- Editar la unidad: marca, capacidad y conductor ---
    page.goto(f"{BASE}/documentos/vehiculos/{vid}")
    page.wait_for_timeout(1400)
    page.get_by_role("button", name="Editar la unidad").click()
    page.wait_for_timeout(700)
    page.fill("input[name=brand]", "Scania")
    page.fill("input[name=capacityTn]", "32")
    page.fill("input[name=mtcCode]", f"MTC-{SELLO}")
    if emp:
        page.select_option("select[name=driverId]", emp)
    page.get_by_role("button", name="Guardar cambios").click()
    page.wait_for_timeout(2600)
    check("la ficha de la unidad se edita desde la web",
          psql(f"select brand from vehicles where id = '{vid}'") == "Scania",
          psql(f"select brand from vehicles where id = '{vid}'"))
    check("con su capacidad y su código MTC",
          psql(f"select capacity_tn from vehicles where id = '{vid}'").startswith("32"),
          psql(f"select capacity_tn from vehicles where id = '{vid}'"))
    if emp:
        check("y el conductor queda asignado",
              psql(f"select driver_id from vehicles where id = '{vid}'") == emp)

    # --- Permisos ---
    # Un enlace de descarga reenviado por correo no debe servirle a nadie de fuera: el
    # archivo solo sale con sesión abierta.
    doc = psql(f"select id from documents where vehicle_id = '{vid}' and filename is not null limit 1")
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
