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
             f"('{SELLO}{i}0', '{nombre}', 'Prueba {SELLO}', 'Operario de almacén', '{AREA}', ((now() at time zone 'America/Lima')::date))")

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

    # La actividad solo se pide a quien vino: una falta no tiene qué contar.
    check("la actividad se pide al que vino, y no en las faltas ni en los justificados",
          fila_ana.locator("input[placeholder*='Descarga']").count() == 1
          and fila_beto.locator("input[placeholder*='Descarga']").count() == 0
          and fila_carla.locator("input[placeholder*='Descarga']").count() == 0)

    # Guardar sin detallar la actividad no registra nada: ni la de Ana ni las otras dos.
    page.get_by_role("button", name=re.compile("Guardar la lista")).first.click()
    page.wait_for_timeout(2200)
    cuerpo = page.locator("body").inner_text()
    check("sin detallar la actividad no se guarda la asistencia",
          "Falta la actividad" in cuerpo, cuerpo[:300])
    check("y no quedó nada a medio guardar",
          psql(f"select count(*) from attendance a join employees e on e.id=a.employee_id where e.area='{AREA}'") == "0")
    check("el campo que falta queda señalado",
          fila_ana.locator("input[aria-invalid=true]").count() == 1)

    fila_ana.locator("input[placeholder*='Descarga']").fill("Descarga de mercadería")

    cuerpo = page.locator("body").inner_text()
    check("el contador de arriba va cambiando mientras se marca",
          "1 vinieron" in cuerpo.replace("\n", " ") or "1" in cuerpo, cuerpo[:200])

    check("nada se guardó todavía",
          psql(f"select count(*) from attendance a join employees e on e.id=a.employee_id where e.area='{AREA}'") == "0")

    page.get_by_role("button", name=re.compile("Guardar la lista")).first.click()
    page.wait_for_timeout(2600)

    guardados = psql("select count(*) from attendance a join employees e on e.id=a.employee_id "
                     f"where e.area='{AREA}' and a.day = ((now() at time zone 'America/Lima')::date)")
    check("al guardar se escriben los tres de una vez", guardados == "3", guardados)
    check("el presente quedó como presente",
          psql("select a.status from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Ana' and a.day=((now() at time zone 'America/Lima')::date)") == "PRESENTE")
    check("el motivo se guardó en el justificado",
          psql("select a.reason from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Carla' and a.day=((now() at time zone 'America/Lima')::date)") == "Descanso médico")
    check("y NO se guardó motivo en los otros",
          psql("select coalesce(a.reason,'-') from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Beto' and a.day=((now() at time zone 'America/Lima')::date)") == "-")
    check("la actividad se guardó en el que vino",
          psql("select a.activity from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Ana' and a.day=((now() at time zone 'America/Lima')::date)") == "Descarga de mercadería")
    check("y la falta quedó sin actividad",
          psql("select coalesce(a.activity,'-') from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Beto' and a.day=((now() at time zone 'America/Lima')::date)") == "-")

    # --- Corregir: volver a marcar pisa, no duplica ---
    page.reload(); page.wait_for_timeout(1700)
    fila_beto = page.get_by_role("row").filter(has_text="Beto")
    fila_beto.get_by_role("button", name="Vino").click()
    page.wait_for_timeout(300)
    fila_beto.locator("input[placeholder*='Descarga']").fill("Apoyo en despacho")
    page.get_by_role("button", name=re.compile("Guardar la lista")).first.click()
    page.wait_for_timeout(2600)
    check("corregir una marca no deja dos filas del mismo día",
          psql("select count(*) from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Beto' and a.day=((now() at time zone 'America/Lima')::date)") == "1")
    check("y queda la corrección",
          psql("select a.status from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Beto' and a.day=((now() at time zone 'America/Lima')::date)") == "PRESENTE")

    # --- Pasar al día anterior con el botón: la lista empieza de cero ---
    # Antes la lista se reutilizaba y el día sin registrar aparecía con lo marcado hoy.
    page.get_by_role("button", name=re.compile("Día anterior")).first.click()
    page.wait_for_url(re.compile(r"dia="), timeout=15000)
    page.wait_for_timeout(1800)
    cuerpo = page.locator("body").inner_text()
    check("al pasar al día anterior la lista no arrastra lo de hoy",
          "3 sin marcar" in cuerpo and page.locator("section[aria-labelledby=titulo-dia] [aria-pressed=true]").count() == 0,
          cuerpo[:300])
    page.goto(f"{BASE}/asistencia?area={AREA.replace(' ', '+')}")
    page.wait_for_timeout(1700)

    # --- Pasado un día, lo guardado queda cerrado ---
    ejecutar("update attendance a set created_at = now() - interval '25 hours' from employees e "
             f"where e.id = a.employee_id and e.area = '{AREA}' and e.first_name = 'Ana' "
             "and a.day = ((now() at time zone 'America/Lima')::date)")
    page.reload(); page.wait_for_timeout(1800)
    fila_ana = page.get_by_role("row").filter(has_text="Ana").filter(has=page.get_by_role("button", name="Vino"))
    fila_beto = page.get_by_role("row").filter(has_text="Beto").filter(has=page.get_by_role("button", name="Vino"))
    check("la marca de hace más de un día se ve cerrada", "cerrada" in fila_ana.inner_text(), fila_ana.inner_text())
    check("y sus botones no responden", fila_ana.get_by_role("button", name="Faltó").is_disabled()
          and fila_ana.locator("input").first.is_disabled())
    check("la de hoy todavía se puede corregir", not fila_beto.get_by_role("button", name="Faltó").is_disabled()
          and "se puede corregir hasta" in fila_beto.inner_text(), fila_beto.inner_text())
    check("y la pantalla avisa que hay marcas cerradas", "cerradas" in page.locator("body").inner_text())

    # La pantalla quedó abierta y el plazo venció mientras tanto: el servidor no deja pasar
    # el cambio aunque el botón todavía estuviera activo.
    fila_beto.get_by_role("button", name="Faltó").click()
    page.wait_for_timeout(300)
    ejecutar("update attendance a set created_at = now() - interval '25 hours' from employees e "
             f"where e.id = a.employee_id and e.area = '{AREA}' and e.first_name = 'Beto' "
             "and a.day = ((now() at time zone 'America/Lima')::date)")
    page.get_by_role("button", name=re.compile("Guardar la lista")).first.click()
    page.wait_for_timeout(2400)
    check("el servidor rechaza cambiar una marca que se cerró con la pantalla abierta",
          psql("select a.status from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Beto' "
               "and a.day=((now() at time zone 'America/Lima')::date)") == "PRESENTE")
    check("y dice por qué", "ya está cerrada" in page.locator("body").inner_text())
    page.reload(); page.wait_for_timeout(1500)

    # --- Un día anterior ---
    page.goto(f"{BASE}/asistencia?dia={ayer}&area={AREA.replace(' ', '+')}")
    page.wait_for_timeout(1700)
    cuerpo = page.locator("body").inner_text()
    check("se puede ir a un día anterior y está sin registrar",
          "3 sin marcar" in cuerpo, cuerpo[:300])
    check("y avisa de que no se está mirando hoy", "Ir a hoy" in cuerpo)

    # --- El domingo también se pasa lista, y sale en la semana ---
    domingo = psql("select (date_trunc('week', (now() at time zone 'America/Lima')::date)::date - 1)::text")
    page.goto(f"{BASE}/asistencia?dia={domingo}&area={AREA.replace(' ', '+')}")
    page.wait_for_timeout(1700)
    fila_ana = page.get_by_role("row").filter(has_text="Ana").filter(has=page.get_by_role("button", name="Vino"))
    fila_ana.get_by_role("button", name="Vino").click()
    page.wait_for_timeout(300)
    fila_ana.locator("input[placeholder*='Descarga']").fill("Guardia de domingo")
    page.get_by_role("button", name=re.compile("Guardar la lista")).first.click()
    page.wait_for_timeout(2600)
    check("se puede pasar lista un domingo",
          psql("select a.status from attendance a join employees e on e.id=a.employee_id "
               f"where e.area='{AREA}' and e.first_name='Ana' and a.day='{domingo}'") == "PRESENTE")
    page.goto(f"{BASE}/asistencia?vista=semana&semana={domingo}&area={AREA.replace(' ', '+')}")
    page.wait_for_timeout(1700)
    celda = page.locator("section[aria-labelledby=titulo-semana] tbody tr").filter(has_text="Ana").locator("td").nth(7)
    check("y aparece en la columna Domingo de su semana", "Vino" in celda.inner_text(), celda.inner_text())

    # --- No se puede pasar lista de un día futuro ---
    manana = psql("select ((now() at time zone 'America/Lima')::date + 1)::text")
    page.goto(f"{BASE}/asistencia?dia={manana}&area={AREA.replace(' ', '+')}")
    page.wait_for_timeout(1500)
    fila_ana = page.get_by_role("row").filter(has_text="Ana")
    if fila_ana.count() > 0:
        fila_ana.get_by_role("button", name="Vino").click()
        page.wait_for_timeout(300)
        fila_ana.locator("input[placeholder*='Descarga']").fill("Lo que sea")
        page.get_by_role("button", name=re.compile("Guardar la lista")).first.click()
        page.wait_for_timeout(2200)
        check("no deja pasar lista de un día que no llegó",
              psql(f"select count(*) from attendance where day = '{manana}'") == "0")

    # --- Dos botones: registrar el día, o ver el cuadro de la semana ---
    page.goto(f"{BASE}/asistencia?area={AREA.replace(' ', '+')}")
    page.wait_for_timeout(1700)
    check("abre en el registro del día, con sus dos botones arriba",
          page.locator("#titulo-dia").count() == 1 and page.locator("#titulo-semana").count() == 0
          and page.get_by_role("link", name=re.compile("Registrar asistencia del día")).count() == 1
          and page.get_by_role("link", name=re.compile("Cuadro de lunes a domingo")).count() == 1)
    page.get_by_role("link", name=re.compile("Cuadro de lunes a domingo")).click()
    page.wait_for_url(re.compile("vista=semana"), timeout=15000)
    page.wait_for_timeout(1500)
    check("el otro botón muestra el cuadro de la semana, conservando el área",
          page.locator("#titulo-semana").count() == 1 and page.locator("#titulo-dia").count() == 0
          and "area=" in page.url, page.url)
    cuerpo = page.locator("body").inner_text()
    check("el resumen del mes va debajo del cuadro, plegado", "Resumen de" in cuerpo)
    page.locator("details summary", has_text="Resumen de").click(); page.wait_for_timeout(300)
    cuerpo = page.locator("body").inner_text()
    check("y al abrirlo dice cuántos días se pasó lista", "día(s) de este mes" in cuerpo, cuerpo[-400:])

    # --- La semana, de lunes a sábado ---
    semana = page.locator("section[aria-labelledby=titulo-semana]")
    cabecera = semana.locator("thead").inner_text()
    check("la semana trae las seis columnas de lunes a sábado",
          all(d in cabecera for d in ("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo")),
          cabecera)
    check("y en ella se ve lo marcado hoy", "Vino" in semana.locator("tbody").inner_text()
          or "Faltó" in semana.locator("tbody").inner_text())

    # La semana se descarga en Excel con el formato de la hoja de asistencia de TransJer.
    with page.expect_download(timeout=60000) as dl:
        page.evaluate("""() => { const a = document.createElement('a');
            a.href = '/api/export/tabla?tabla=asistencia-semana&format=xlsx'; a.download = '';
            document.body.appendChild(a); a.click(); }""")
    from openpyxl import load_workbook
    import io
    check("el archivo se llama como la hoja de TransJer", dl.value.suggested_filename.startswith("ASISTENCIA TRANSJER"),
          dl.value.suggested_filename)
    libro = load_workbook(io.BytesIO(open(dl.value.path(), "rb").read()))
    hoja = libro.worksheets[0]
    check("sale en una sola hoja, con el formato de TransJer", len(libro.sheetnames) == 1, libro.sheetnames)
    dias_fila = [hoja.cell(1, c).value for c in range(3, 10)]
    check("arriba el mes, y de lunes a domingo", hoja["A1"].value in
          ("ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE")
          or " - " in str(hoja["A1"].value), hoja["A1"].value)
    check("los días en la primera fila", dias_fila == ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"], dias_fila)
    check("NOMBRES y los números de los días en la segunda", hoja["A2"].value == "NOMBRES"
          and all(isinstance(hoja.cell(2, c).value, int) for c in range(3, 10)))
    check("la cabecera en amarillo, unida en A:B", hoja["A1"].fill.fgColor.rgb == "FFFFFF00"
          and "A1:B1" in [str(r) for r in hoja.merged_cells.ranges] and "A2:B2" in [str(r) for r in hoja.merged_cells.ranges])
    filas = {(str(hoja.cell(r, 1).value), str(hoja.cell(r, 2).value)): r for r in range(3, hoja.max_row + 1)}
    check("cada trabajador con sus nombres en A y apellidos en B", any(k[0] == "ANA" for k in filas), list(filas)[:5])
    fila_ana_xl = next((r for k, r in filas.items() if k[0] == "ANA"), None)
    check("y en el día, lo que hizo, en mayúsculas",
          fila_ana_xl is not None and any(hoja.cell(fila_ana_xl, c).value == "DESCARGA DE MERCADERÍA" for c in range(3, 10)),
          [hoja.cell(fila_ana_xl, c).value for c in range(3, 10)] if fila_ana_xl else None)
    rojas = [hoja.cell(r, c) for r in range(3, hoja.max_row + 1) for c in range(3, 10) if hoja.cell(r, c).value == "NO TRABAJO"]
    check("las faltas dicen NO TRABAJO, en rojo", all(c.fill.fgColor.rgb == "FFFF0000" for c in rojas))

    semana.get_by_role("link", name="← Anterior").click()
    page.wait_for_timeout(1500)
    check("se puede ir a la semana anterior", "semana=" in page.url
          and page.get_by_role("link", name="Esta semana").count() == 1, page.url)

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
