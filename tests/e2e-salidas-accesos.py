"""
Recorrido de extremo a extremo de los cambios de noviembre:

  - el menú nuevo: Recursos Humanos, Salidas en Flota, y sin Movimientos, Reportes ni
    Categorías (que además ya no abren);
  - el registro de salidas, con el FO de Alicorp y el control de liquidación;
  - el cuadro de EPP en poder por trabajador;
  - los accesos por módulo al crear un usuario, y que de verdad limiten lo que ve.

    python3 tests/e2e-salidas-accesos.py
"""
import io, json, os, re, subprocess, time
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=15000)
BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
SELLO = str(int(time.time()))[-6:]
PLACA = f"ZS{SELLO[-1]}-{SELLO[-3:]}"
FO = f"FO-{SELLO}"
GUIA = f"G-{SELLO}"
OTRO_CLIENTE = f"Vainsa {SELLO}"
NUEVO_USUARIO = f"flota{SELLO}"

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
    ejecutar("delete from vehicle_trips where doc_number like 'FO-%' and client ilike 'alicorp' and doc_number ~ '^FO-[0-9]{6}$'")
    ejecutar("delete from vehicle_trips where client like 'Vainsa %'")
    ejecutar("delete from vehicles where notes = 'E2E-SALIDAS'")
    ejecutar("delete from audit_logs where user_id in (select id from users where username like 'flota%' or username like 'finanzas_e2e%')")
    ejecutar("delete from users where username like 'flota%' or username like 'finanzas_e2e%'")


def entrar(page, usuario, clave):
    page.goto(f"{BASE}/login")
    page.fill("input[name=identifier]", usuario)
    page.fill("input[name=password]", clave)
    page.click("button[type=submit]")
    page.wait_for_url(re.compile(r"/dashboard"), timeout=30000)


def abrir_menu(page):
    """El menú pliega las secciones que no se usan: se abren todas para ver sus enlaces."""
    for titulo in page.get_by_role("navigation").first.get_by_role("button").all():
        if titulo.get_attribute("aria-expanded") == "false":
            titulo.click()
            page.wait_for_timeout(120)


def descargar(page, url):
    with page.expect_download(timeout=60000) as dl:
        page.evaluate(f"""() => {{ const a = document.createElement('a'); a.href = '{url}'; a.download = '';
            document.body.appendChild(a); a.click(); }}""")
    return load_workbook(io.BytesIO(open(dl.value.path(), "rb").read()))


limpiar()
ejecutar(f"insert into vehicles (plate, notes) values ('{PLACA}', 'E2E-SALIDAS')")

with sync_playwright() as p:
    nav = p.chromium.launch()
    ctx = nav.new_context(viewport={"width": 1440, "height": 950}, accept_downloads=True)
    page = ctx.new_page()
    errores = []
    page.on("pageerror", lambda e: errores.append(f"{page.url} → {str(e)[:140]}"))
    entrar(page, USER, PASS)

    # --- El menú ---
    abrir_menu(page)
    menu = page.locator("nav").first.inner_text()
    check("el menú tiene la sección Recursos Humanos", "RECURSOS HUMANOS" in menu.upper(), menu[:400])
    check("y Salidas dentro de Flota", page.locator("a[href='/salidas']").count() > 0)
    check("ya no tiene Movimientos, Reportes ni Categorías",
          page.locator("a[href='/movimientos'], a[href='/reportes'], a[href='/categorias']").count() == 0)

    page.goto(f"{BASE}/movimientos"); page.wait_for_timeout(1200)
    check("Movimientos sin producto lleva al inventario", page.url.rstrip("/").endswith("/inventario"), page.url)
    page.goto(f"{BASE}/reportes"); page.wait_for_timeout(1200)
    check("Reportes lleva al inicio", "/dashboard" in page.url, page.url)
    page.goto(f"{BASE}/categorias"); page.wait_for_timeout(1200)
    check("Categorías lleva al inventario", page.url.rstrip("/").endswith("/inventario"), page.url)

    # --- Registrar una salida de Alicorp: el documento es un FO ---
    page.goto(f"{BASE}/salidas"); page.wait_for_timeout(1500)
    check("la pantalla de salidas abre en el registro del día",
          page.locator("[aria-current=page]", has_text="Salidas del día").count() == 1)
    page.get_by_role("button", name="Registrar salida").click(); page.wait_for_timeout(600)
    dialogo = page.locator("[role=dialog]")
    dialogo.locator("select[name=vehicleId]").select_option(label=PLACA)
    dialogo.locator("input[name=client]").fill("Alicorp")
    page.wait_for_timeout(300)
    check("con Alicorp el campo pide el N° de FO", "N° de FO" in dialogo.inner_text()
          and dialogo.locator("select[name=docType]").count() == 0)
    dialogo.locator("input[name=destination]").fill("Lurín")
    dialogo.locator("input[name=docNumber]").fill(FO.lower())
    dialogo.get_by_role("button", name="Registrar salida").click()
    page.wait_for_timeout(2200)
    fila = psql(f"select doc_type || '|' || doc_number || '|' || status from vehicle_trips where doc_number = '{FO}'")
    check("se guarda como FO, en mayúsculas y pendiente", fila == f"FO|{FO}|PENDIENTE", fila)
    check("y aparece en las salidas del día", FO in page.locator("table").inner_text())

    # --- El mismo FO no entra dos veces ---
    page.get_by_role("button", name="Registrar salida").click(); page.wait_for_timeout(600)
    dialogo = page.locator("[role=dialog]")
    dialogo.locator("select[name=vehicleId]").select_option(label=PLACA)
    dialogo.locator("input[name=client]").fill("ALICORP")
    dialogo.locator("input[name=docNumber]").fill(FO)
    dialogo.get_by_role("button", name="Registrar salida").click()
    page.wait_for_timeout(2000)
    check("un FO repetido no se registra", psql(f"select count(*) from vehicle_trips where doc_number = '{FO}'") == "1")
    check("y avisa que ya está", "ya está registrado" in page.locator("body").inner_text())
    if page.locator("[role=dialog]").count():
        page.locator("[role=dialog]").get_by_role("button", name="Cancelar").click(); page.wait_for_timeout(500)

    # --- Otro cliente: se elige el tipo de documento ---
    page.get_by_role("button", name="Registrar salida").click(); page.wait_for_timeout(600)
    dialogo = page.locator("[role=dialog]")
    dialogo.locator("select[name=vehicleId]").select_option(label=PLACA)
    dialogo.locator("input[name=client]").fill(OTRO_CLIENTE)
    page.wait_for_timeout(300)
    check("con otro cliente se elige el tipo de documento", dialogo.locator("select[name=docType]").count() == 1)
    dialogo.locator("select[name=docType]").select_option("GUIA")
    dialogo.locator("input[name=docNumber]").fill(GUIA)
    dialogo.get_by_role("button", name="Registrar salida").click()
    page.wait_for_timeout(2200)
    check("se guarda la guía", psql(f"select doc_type from vehicle_trips where doc_number = '{GUIA}'") == "GUIA")

    # --- Control de liquidación ---
    page.goto(f"{BASE}/salidas?vista=control&q={FO}"); page.wait_for_timeout(1500)
    fila = page.get_by_role("row").filter(has_text=FO)
    check("el FO figura por liquidar", "Por liquidar" in fila.inner_text(), fila.inner_text())
    fila.get_by_role("button", name="Liquidar").click(); page.wait_for_timeout(600)
    page.locator("[role=dialog]").get_by_role("button", name="Marcar liquidado").click()
    page.wait_for_timeout(2200)
    estado = psql(f"select status || '|' || (settled_at = ((now() at time zone 'America/Lima')::date)) from vehicle_trips where doc_number = '{FO}'")
    check("al liquidarlo queda LIQUIDADO con la fecha de hoy", estado == "LIQUIDADO|true", estado)
    page.goto(f"{BASE}/salidas?vista=control&estado=&q={FO}"); page.wait_for_timeout(1500)
    fila = page.get_by_role("row").filter(has_text=FO)
    check("ya liquidado no se puede editar ni borrar",
          fila.get_by_role("button", name="Corregir la salida").count() == 0
          and fila.get_by_role("button", name="Eliminar la salida").count() == 0
          and "Liquidado" in fila.inner_text())

    libro = descargar(page, f"/api/export/tabla?tabla=salidas&format=xlsx&vista=control&estado=&q={FO}")
    filas = [[c for c in r if c is not None] for r in libro.worksheets[0].iter_rows(values_only=True)]
    check("el Excel del control trae el FO liquidado",
          any(FO in r and "Liquidado" in r for r in filas), filas[-3:])

    fila.get_by_role("button", name="Deshacer la liquidación").click(); page.wait_for_timeout(500)
    page.locator("[role=dialog]").get_by_role("button", name="Deshacer").click(); page.wait_for_timeout(2000)
    check("deshacer la liquidación lo deja pendiente otra vez",
          psql(f"select status || '|' || (settled_at is null) from vehicle_trips where doc_number = '{FO}'") == "PENDIENTE|true")

    # --- El cuadro de EPP ---
    page.goto(f"{BASE}/entregas/resumen"); page.wait_for_timeout(2000)
    cuadro = page.locator("[data-cuadro-epp]")
    esperado = psql("""
        with ent as (select employee_id, product_id, sum(quantity) q from epp_deliveries where voided_at is null group by 1,2),
             dev as (select employee_id, product_id, sum(quantity) q from epp_returns group by 1,2)
        select coalesce(sum(ent.q - coalesce(dev.q,0)) filter (where ent.q - coalesce(dev.q,0) > 0), 0)
        from ent left join dev using (employee_id, product_id)""")
    if esperado == "0":
        check("sin EPP en poder, el cuadro lo dice", "Nadie tiene EPP" in page.locator("body").inner_text())
    else:
        total = cuadro.locator("tfoot td").last.inner_text().strip()
        check("el total del cuadro es lo entregado menos lo devuelto", total == esperado, (total, esperado))
        check("hay una columna por EPP y una fila por trabajador",
              cuadro.locator("thead tr").nth(1).locator("th").count() >= 1 and cuadro.locator("tbody tr").count() >= 1)
    check("abre en el cuadro por trabajador",
          page.locator("[aria-current=page]", has_text="Cuadro por trabajador").count() == 1)
    page.get_by_role("link", name=re.compile("Entregado por periodo")).click(); page.wait_for_timeout(1500)
    check("y la vista por periodo sigue estando", "Por tipo de EPP" in page.locator("body").inner_text())
    libro = descargar(page, "/api/export/tabla?tabla=cuadro-epp&format=xlsx")
    encabezados = " ".join(str(c) for r in libro.worksheets[0].iter_rows(max_row=8, values_only=True) for c in r if c)
    check("el cuadro se descarga en Excel", "Trabajador" in encabezados and "Total" in encabezados, encabezados[:200])

    # --- Crear un usuario con accesos por módulo ---
    page.goto(f"{BASE}/usuarios"); page.wait_for_timeout(1500)
    page.get_by_role("button", name="Nuevo usuario").click(); page.wait_for_timeout(600)
    dialogo = page.locator("[role=dialog]")
    dialogo.locator("input[name=name]").fill(f"Encargado de flota {SELLO}")
    dialogo.locator("input[name=username]").fill(NUEVO_USUARIO)
    dialogo.locator("input[name=email]").fill(f"{NUEVO_USUARIO}@transjer.test")
    dialogo.locator("input[name=password]").fill("Flota12345")
    check("el formulario muestra la grilla de módulos", "Módulos a los que entra" in dialogo.inner_text())
    dialogo.get_by_role("radiogroup", name="Salidas y liquidación").get_by_text("Ver y editar").click()
    dialogo.get_by_role("radiogroup", name="Asistencia").get_by_text("Solo ver").click()
    dialogo.get_by_role("button", name="Crear usuario").click()
    page.wait_for_timeout(2500)
    accesos = psql(f"select role || '|' || coalesce(module_access::text, '') from users where username = '{NUEVO_USUARIO}'")
    rol, _, json_accesos = accesos.partition("|")
    datos = json.loads(json_accesos) if json_accesos else {}
    check("se guarda sin rol armado y con sus accesos",
          rol == "USUARIO" and datos.get("salidas") == "edit" and datos.get("asistencia") == "view"
          and datos.get("facturas") == "none", accesos)

    # Sin ningún módulo no se crea.
    page.get_by_role("button", name="Nuevo usuario").click(); page.wait_for_timeout(600)
    dialogo = page.locator("[role=dialog]")
    dialogo.locator("input[name=name]").fill("Sin nada")
    dialogo.locator("input[name=username]").fill(f"flotanada{SELLO}")
    dialogo.locator("input[name=email]").fill(f"flotanada{SELLO}@transjer.test")
    dialogo.locator("input[name=password]").fill("Flota12345")
    dialogo.get_by_role("button", name="Crear usuario").click(); page.wait_for_timeout(2000)
    check("un usuario sin módulos no se crea",
          psql(f"select count(*) from users where username = 'flotanada{SELLO}'") == "0"
          and "al menos un módulo" in page.locator("body").inner_text())
    page.locator("[role=dialog]").get_by_role("button", name="Cancelar").click(); page.wait_for_timeout(500)

    # Un usuario de antes, con rol: la grilla aparece con lo que su rol le daba.
    ejecutar(f"insert into users (name, username, email, password_hash, role) values "
             f"('Finanzas E2E', 'finanzas_e2e{SELLO}', 'finanzas_e2e{SELLO}@transjer.test', 'x', 'FINANZAS')")
    page.reload(); page.wait_for_timeout(1500)
    page.get_by_role("row").filter(has_text=f"finanzas_e2e{SELLO}").get_by_role("button", name="Editar").click()
    page.wait_for_timeout(700)
    dialogo = page.locator("[role=dialog]")
    facturas = dialogo.get_by_role("radiogroup", name="Facturas y calendario de pagos")
    check("al editar a alguien con rol, la grilla trae lo que el rol le daba",
          facturas.locator("input[value=edit]").is_checked()
          and dialogo.get_by_role("radiogroup", name="Asistencia").locator("input[value=none]").is_checked())
    dialogo.get_by_role("button", name="Guardar cambios").click(); page.wait_for_timeout(2200)
    check("al guardar pasa a accesos por módulo sin perder lo que tenía",
          psql(f"select role || '|' || (module_access->>'facturas') || '|' || (module_access->>'obligaciones') "
               f"from users where username = 'finanzas_e2e{SELLO}'") == "USUARIO|edit|edit")

    # --- Entrar con el usuario nuevo: solo ve lo suyo ---
    ctx2 = nav.new_context(viewport={"width": 1440, "height": 950})
    p2 = ctx2.new_page()
    p2.on("pageerror", lambda e: errores.append(f"{p2.url} → {str(e)[:140]}"))
    entrar(p2, NUEVO_USUARIO, "Flota12345")
    abrir_menu(p2)
    enlaces = p2.locator("nav a").evaluate_all("as => as.map(a => a.getAttribute('href'))")
    check("su menú solo tiene lo que se le dio",
          "/salidas" in enlaces and "/asistencia" in enlaces
          and not any(h in enlaces for h in ["/facturas", "/inventario", "/usuarios", "/obligaciones"]), enlaces)
    p2.goto(f"{BASE}/facturas"); p2.wait_for_timeout(1200)
    check("una pantalla sin acceso lo devuelve al inicio", "denied=1" in p2.url, p2.url)
    p2.goto(f"{BASE}/salidas"); p2.wait_for_timeout(1500)
    check("con ver y editar puede registrar salidas", p2.get_by_role("button", name="Registrar salida").count() == 1)
    p2.goto(f"{BASE}/asistencia"); p2.wait_for_timeout(1500)
    check("con solo ver no puede marcar asistencia",
          p2.get_by_role("button", name=re.compile("Guardar la lista")).count() == 0
          or p2.get_by_role("button", name="Vino").first.is_disabled())
    ctx2.close()

    check("sin errores de JavaScript", not errores, errores[:3])
    nav.close()

limpiar()
print("\n" + ("Todo en orden." if not fails else f"{len(fails)} FALLAS: {fails}"))
raise SystemExit(1 if fails else 0)
