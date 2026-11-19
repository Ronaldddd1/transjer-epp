"""
Rutas de reparto, de punta a punta, con la programación real del 20/11.

Necesita el servidor apuntando al Nominatim/OSRM de mentira (tests/mock-mapas.py):

    python3 tests/mock-mapas.py 3999 &
    GEOCODER_URL=http://127.0.0.1:3999 OSRM_URL=http://127.0.0.1:3999 GEOCODER_DELAY_MS=0 next start

    python3 tests/e2e-rutas.py
"""
import os, re, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright, expect
import openpyxl

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
ARCHIVO = os.path.join(os.path.dirname(__file__), "fixtures", "programacion-recojo.xlsx")
INICIO = time.strftime("%Y-%m-%d %H:%M:%S")

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


def mock_vivo():
    try:
        urllib.request.urlopen("http://127.0.0.1:3999/search?q=Lima", timeout=2)
        return True
    except Exception:
        return False


if not mock_vivo():
    subprocess.Popen(["python3", os.path.join(os.path.dirname(__file__), "mock-mapas.py"), "3999"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)

lugares_antes = psql("select coalesce(string_agg(key || ':' || lat || ':' || lng, ';'), '') from route_places")


def limpiar():
    ejecutar("delete from route_plans where file_name like 'programacion-recojo%'")
    ejecutar("delete from vehicles where plate in ('RTA-901', 'RTA-902')")
    ejecutar(f"delete from geo_cache where updated_at >= '{INICIO}'")
    ejecutar("delete from audit_logs where module = 'RUTAS' and created_at >= '" + INICIO + "'")


def restaurar_lugares():
    ejecutar("delete from route_places")
    for item in filter(None, lugares_antes.split(";")):
        k, la, lo = item.split(":")
        ejecutar(f"insert into route_places (key, name, lat, lng) values ('{k}', '{'Centro de recojo (Lurín)' if k == 'CD' else 'Cochera'}', {la}, {lo})")


limpiar()
ejecutar("delete from route_places")
ejecutar("insert into vehicles (plate, capacity_tn, capacity_m3) values ('RTA-901', 0.30, 2), ('RTA-902', 1.00, 6)")

with sync_playwright() as p:
    nav = p.chromium.launch()
    page = nav.new_page(viewport={"width": 1440, "height": 1000})
    errores = []
    page.on("pageerror", lambda e: errores.append(f"{page.url} → {str(e)[:140]}"))
    page.goto(f"{BASE}/login")
    page.fill("input[name=identifier]", USER)
    page.fill("input[name=password]", PASS)
    page.click("button[type=submit]")
    page.wait_for_url(re.compile("/dashboard"), timeout=30000)

    # --- El menú ---
    page.goto(f"{BASE}/salidas"); page.wait_for_timeout(800)
    check("Flota tiene «Rutas de reparto»", page.locator("nav[aria-label=Principal] a[href='/rutas']").count() == 1)

    # --- Subir la programación ---
    page.goto(f"{BASE}/rutas"); page.wait_for_timeout(1000)
    check("la lista explica de dónde sale y dónde termina la ruta", "Lurín" in page.locator("main").inner_text())
    page.get_by_role("button", name="Nueva programación").click(); page.wait_for_timeout(400)
    page.get_by_role("button", name="Cargar programación").click(); page.wait_for_timeout(800)
    check("sin archivo, lo pide", "Elige el Excel" in page.get_by_role("dialog").inner_text())
    page.set_input_files("input[name=archivo]", ARCHIVO)
    page.get_by_role("button", name="Cargar programación").click()
    page.wait_for_url(re.compile(r"/rutas/[0-9a-f-]{36}"), timeout=20000)
    plan_id = page.url.rsplit("/", 1)[1]
    check("al cargar, abre el plan", bool(plan_id))
    check("16 paradas (una por dirección)", psql(f"select count(*) from route_plan_stops where plan_id = '{plan_id}'") == "16")

    # --- Se ubican solas ---
    page.wait_for_function("() => !document.querySelector('[data-testid=ubicando]')", timeout=60000)
    page.wait_for_timeout(1500)
    ubicadas = psql(f"select count(*) from route_plan_stops where plan_id = '{plan_id}' and lat is not null")
    check("se ubican todas en el mapa", ubicadas == "16", ubicadas)
    marsano = psql(f"select round(lng::numeric, 2) from route_plan_stops where plan_id = '{plan_id}' and clean_address like '%MARSANO%'")
    check("una calle con el mismo nombre en otro distrito se descarta (Tomás Marsano queda en Surquillo)", marsano in ("-77.02", "-77.03", "-77.01"), marsano)
    sauvi = psql(f"select geo_quality from route_plan_stops where plan_id = '{plan_id}' and '7503001757' = any(orders)")
    check("la que no se encuentra (Villa Sol Naciente) queda solo por el distrito", sauvi == "DISTRITO", sauvi)
    lista = page.locator("[data-testid=lista-paradas] li")
    check("la lista muestra las 16", lista.count() == 16, lista.count())
    check("y avisa cuántas hay que revisar", "por revisar" in page.get_by_role("tab", name=re.compile("Paradas")).inner_text())
    check("los pines están en el mapa", page.locator("[data-testid=mapa-rutas] .leaflet-marker-icon").count() >= 17)

    # --- Corregir a mano la que quedó por el distrito ---
    fila = lista.filter(has_text="GROUP SAUVI")
    fila.get_by_role("button", name="Ubicar en el mapa").click()
    check("pide hacer clic en el mapa", "Haz clic en el mapa" in page.locator("main").inner_text())
    caja = page.locator("[data-testid=mapa-rutas]").bounding_box()
    page.mouse.click(caja["x"] + caja["width"] * 0.5, caja["y"] + caja["height"] * 0.4)
    page.wait_for_timeout(1800)
    manual = psql(f"select geo_quality from route_plan_stops where plan_id = '{plan_id}' and '7503001757' = any(orders)")
    check("queda ubicada a mano", manual == "MANUAL", manual)
    check("y se recuerda para la próxima vez", psql("select count(*) from geo_cache where quality = 'MANUAL' and key like 'MAZVV%'") == "1")

    # --- Sin cochera no se calcula ---
    page.get_by_role("tab", name=re.compile("Móviles")).click(); page.wait_for_timeout(300)
    form = page.locator("[data-testid=form-moviles]")
    check("sin cochera, avisa y no deja calcular",
          "ubica la cochera" in form.inner_text() and form.get_by_role("button", name=re.compile("Calcular rutas")).is_disabled())
    page.get_by_role("button", name="Ubicar cochera").click(); page.wait_for_timeout(300)
    despues = page.locator("[data-testid=mapa-rutas]").bounding_box()
    check("al pulsar «Ubicar cochera» la página no salta: el mapa sigue en su lugar", abs(despues["y"] - caja["y"]) < 2, (caja["y"], despues["y"]))
    check("y el aviso sale encima del mapa", page.locator("[data-testid=eligiendo]").count() == 1)
    page.mouse.click(caja["x"] + caja["width"] * 0.3, caja["y"] + caja["height"] * 0.3)
    page.wait_for_timeout(1800)
    check("la cochera queda guardada", psql("select count(*) from route_places where key = 'COCHERA'") == "1")
    # Reubicar el centro y la cochera varias veces seguidas: cada clic se guarda.
    for i, (boton, clave, fx) in enumerate((("Ubicar centro", "CD", 0.62), ("Ubicar cochera", "COCHERA", 0.35), ("Ubicar centro", "CD", 0.6))):
        antes = psql(f"select coalesce(max(updated_at)::text, '') from route_places where key = '{clave}'")
        page.get_by_role("button", name=boton).click(); page.wait_for_timeout(300)
        page.mouse.click(caja["x"] + caja["width"] * fx, caja["y"] + caja["height"] * 0.5)
        page.wait_for_timeout(1500)
        luego = psql(f"select coalesce(max(updated_at)::text, '') from route_places where key = '{clave}'")
        check(f"reubicar {boton.split()[-1]} ({i + 1}) se guarda y el mapa sigue a la vista",
              luego != antes and page.locator("[data-testid=mapa-rutas] .leaflet-marker-icon").count() >= 17, (antes, luego))

    # --- Calcular con dos móviles ---
    page.get_by_role("tab", name=re.compile("Móviles")).click(); page.wait_for_timeout(300)
    form = page.locator("[data-testid=form-moviles]")
    form.locator("tr", has_text="RTA-901").locator("input[type=checkbox]").check()
    check("la capacidad viene de la ficha (0.3 t = 300 kg)", form.get_by_label("Capacidad en kg de RTA-901").input_value() == "300")
    form.get_by_role("button", name=re.compile("Calcular rutas")).click(); page.wait_for_timeout(2500)
    paradas_sin = psql(f"select count(*) from route_plan_stops where plan_id = '{plan_id}' and plan_vehicle_id is null")
    check("con una móvil de 300 kg no entra todo (557 kg): avisa cuáles quedan fuera",
          int(paradas_sin) > 0 and page.locator("[data-testid=sin-movil]").count() == 1, paradas_sin)

    page.get_by_role("tab", name=re.compile("Rutas|Móviles")).click(); page.wait_for_timeout(300)
    form = page.locator("[data-testid=form-moviles]")
    form.locator("tr", has_text="RTA-902").locator("input[type=checkbox]").check()
    form.get_by_role("button", name=re.compile("Recalcular rutas")).click(); page.wait_for_timeout(3000)
    estado = psql(f"select status || '|' || (total_km > 0) from route_plans where id = '{plan_id}'")
    check("con las dos, calcula", estado in ("CALCULADA|t", "CALCULADA|true"), estado)
    check("todas las paradas tienen móvil", psql(f"select count(*) from route_plan_stops where plan_id = '{plan_id}' and plan_vehicle_id is null") == "0")
    cargas = psql(f"select string_agg(plate || ':' || load_kg || ':' || coalesce(capacity_kg::text, '-'), ';' order by plate) from route_plan_vehicles where plan_id = '{plan_id}'")
    check("ninguna lleva más de su capacidad",
          all(float(c.split(":")[1]) <= float(c.split(":")[2]) for c in cargas.split(";") if c.split(":")[2] != "-"), cargas)
    orden = psql(f"select string_agg(sequence::text, ',' order by sequence) from route_plan_stops where plan_id = '{plan_id}' group by plan_vehicle_id order by 1")
    check("cada ruta tiene sus paradas numeradas 1, 2, 3… sin saltos",
          all(o.split(",") == [str(i) for i in range(1, len(o.split(",")) + 1)] for o in orden.splitlines()), orden)
    tarjetas = page.locator("[data-testid=movil-ruta]")
    minutos = psql(f"select string_agg(minutes::text, ',') from route_plan_vehicles where plan_id = '{plan_id}' and km is not null")
    check("ninguna móvil pasa la jornada de 9 h", all(int(x) <= 540 for x in minutos.split(",")), minutos)
    check("una tarjeta por móvil que sale, con sus km y tiempo", tarjetas.count() >= 1 and " km" in tarjetas.first.inner_text(), tarjetas.count())
    check("la ruta empieza en la cochera y carga en el centro", "Sale de la cochera → carga en" in tarjetas.first.inner_text())
    check("con enlace a Google Maps para el conductor", tarjetas.first.locator("a[href^='https://www.google.com/maps/dir/']").count() >= 1)
    check("las rutas se dibujan en el mapa", page.locator("[data-testid=mapa-rutas] .leaflet-overlay-pane path").count() >= 2)
    km_total = float(psql(f"select total_km from route_plans where id = '{plan_id}'"))
    km_moviles = float(psql(f"select sum(km) from route_plan_vehicles where plan_id = '{plan_id}'"))
    check("los km totales son la suma de los de cada móvil", abs(km_total - km_moviles) < 0.05, (km_total, km_moviles))
    enlace = tarjetas.first.locator("a[href^='https://www.google.com/maps/dir/']").first.get_attribute("href")
    coch = psql("select round(lat::numeric, 6) || ',' || round(lng::numeric, 6) from route_places where key = 'COCHERA'")
    check("el enlace de Google Maps sale de la cochera", f"origin={coch.replace(',', '%2C')}" in enlace, (coch, enlace[:120]))
    check("en Lima, el reparto suma una cantidad razonable de km (50–400)", 50 < km_total < 400, km_total)

    rectas_q = (f"select count(*) from route_plan_vehicles v where v.plan_id = '{plan_id}' and v.km is not null and "
                f"jsonb_array_length(v.geometry) <= 3 + (select count(*) from route_plan_stops s where s.plan_vehicle_id = v.id)")
    check("cada ruta va dibujada por las calles, no en línea recta", psql(rectas_q) == "0", psql(rectas_q))

    # --- Si el servidor no obtiene las calles, el navegador redibuja la ruta ---
    urllib.request.urlopen("http://127.0.0.1:3999/__fallar-servidor?on=1").read()
    try:
        form.get_by_role("button", name=re.compile("Recalcular rutas")).click()
        page.wait_for_timeout(1500)
        for _ in range(20):
            if psql(rectas_q) == "0" and psql(f"select approximate from route_plans where id = '{plan_id}'") in ("f", "false"):
                break
            page.wait_for_timeout(500)
        check("sin respuesta en el servidor, el navegador traza las rutas por las calles y las guarda", psql(rectas_q) == "0", psql(rectas_q))
        check("y el plan deja de decir «aproximado»", psql(f"select approximate from route_plans where id = '{plan_id}'") in ("f", "false"))
        km_total = float(psql(f"select total_km from route_plans where id = '{plan_id}'"))
        km_moviles = float(psql(f"select sum(km) from route_plan_vehicles where plan_id = '{plan_id}'"))
        check("con los km corregidos (total = suma de móviles)", abs(km_total - km_moviles) < 0.05, (km_total, km_moviles))
        check("queda en la auditoría", int(psql(f"select count(*) from audit_logs where record_id = '{plan_id}' and description like '%trazada por las calles%'")) >= 1)
    finally:
        urllib.request.urlopen("http://127.0.0.1:3999/__fallar-servidor?on=0").read()

    # --- Hojas de ruta en Excel ---
    with page.expect_download() as bajada:
        page.get_by_role("link", name=re.compile("Descargar hojas de ruta")).click()
    destino = "/tmp/claude-0/e2e-rutas.xlsx"
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    bajada.value.save_as(destino)
    wb = openpyxl.load_workbook(destino)
    usadas = int(psql(f"select count(*) from route_plan_vehicles where plan_id = '{plan_id}' and km is not null"))
    check("el Excel trae el resumen y una hoja por móvil que sale", wb.sheetnames[0] == "Resumen" and len(wb.sheetnames) == 1 + usadas, wb.sheetnames)
    filas = sum(max(0, ws.max_row - 4) for ws in wb.worksheets[1:])
    check("con las 16 entregas en orden", filas == 16, filas)

    # --- Al volver a cargar el mismo archivo, ya salen ubicadas ---
    page.goto(f"{BASE}/rutas"); page.wait_for_timeout(800)
    page.get_by_role("button", name="Nueva programación").click(); page.wait_for_timeout(300)
    page.set_input_files("input[name=archivo]", ARCHIVO)
    page.get_by_role("button", name="Cargar programación").click()
    page.wait_for_url(re.compile(r"/rutas/[0-9a-f-]{36}"), timeout=20000)
    plan2 = page.url.rsplit("/", 1)[1]
    ya = psql(f"select count(*) from route_plan_stops where plan_id = '{plan2}' and lat is not null")
    check("la segunda vez, las 16 direcciones ya salen ubicadas (se recuerdan)", ya == "16", ya)
    check("incluida la corregida a mano", psql(f"select geo_quality from route_plan_stops where plan_id = '{plan2}' and '7503001757' = any(orders)") == "MANUAL")

    # --- Eliminar ---
    page.get_by_role("button", name="Eliminar").first.click(); page.wait_for_timeout(300)
    page.get_by_role("dialog").get_by_role("button", name="Eliminar").click()
    page.wait_for_url(re.compile(r"/rutas$"), timeout=15000)
    check("eliminar vuelve a la lista y borra el plan", psql(f"select count(*) from route_plans where id = '{plan2}'") == "0")
    check("en la lista queda la otra con sus km", "km" in page.locator("tbody").inner_text())

    check("ninguna pantalla lanzó errores de JavaScript", not errores, errores[:3])
    nav.close()

limpiar()
restaurar_lugares()
print("\nTodo en orden." if not fails else f"\n{len(fails)} comprobación(es) fallaron: {fails}")
raise SystemExit(1 if fails else 0)
