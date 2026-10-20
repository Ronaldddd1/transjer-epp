"""
Importar el control de facturas en Excel desde la pantalla, con el archivo real.

Lo que de verdad importa aquí es que se pueda repetir: la encargada sigue llenando la hoja,
así que subirla otra vez tiene que traer solo lo nuevo y no duplicar nada.

    E2E_DB=transjer python3 tests/e2e-importar-excel.py
"""
import os, re, subprocess
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:3000")
USER = os.environ.get("E2E_USER", "admin")
PASS = os.environ.get("E2E_PASS", "Admin123!")
DB = os.environ.get("E2E_DB", "epp")
HOJA = os.path.abspath("tests/datos/control-facturas.xlsx")

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
    """Borra solo lo que deja esta prueba: lo importado del Excel y sus proveedores."""
    ejecutar("delete from invoice_attachments where invoice_id in "
             "(select id from supplier_invoices where notes = 'Importado del control en Excel.')")
    ejecutar("delete from supplier_invoices where notes = 'Importado del control en Excel.'")
    ejecutar("delete from suppliers where notes = 'Creado al importar el control en Excel. Falta el RUC.'")
    ejecutar("delete from audit_logs where module='FACTURAS' and action='IMPORTAR'")


def importar(page, esperar_boton=True):
    page.goto(f"{BASE}/facturas"); page.wait_for_timeout(900)
    page.click("button:has-text('Importar de Excel')")
    page.wait_for_timeout(600)
    page.set_input_files("input[type=file]", HOJA)
    page.wait_for_selector("text=/Se importar/", timeout=30000)
    page.wait_for_timeout(800)
    return page.locator("div.fixed.inset-0.z-50")


def main():
    limpiar()
    antes = int(psql("select count(*) from supplier_invoices"))

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

        # --- Primera carga ---
        modal = importar(page)
        cuerpo = modal.inner_text()
        check("reconoce la hoja del control entre las ocho", "PROVEEDORES LOCAL-PROVINCIA" in cuerpo, cuerpo[:120])
        check("dice cuántas filas leyó", "158 fila(s)" in cuerpo, cuerpo[:200])
        check("avisa de las tres filas sin importe", "Con problemas" in cuerpo and "\n3\n" in cuerpo, cuerpo[:300])
        check("anuncia los proveedores que va a crear", "proveedor(es) que no estaban" in cuerpo)
        # El número anunciado se compara después con los que de verdad se crean. La hoja
        # escribe varios nombres de más de una forma, y esas variantes son un solo proveedor.
        anunciados = int(re.search(r"Se crearán (\d+) proveedor", cuerpo).group(1))
        check("anuncia menos proveedores que formas de escribir el nombre", anunciados < 38, anunciados)
        check("muestra la vista previa con la primera factura", "E001-356" in cuerpo)
        check("el botón dice cuántas se importarán", "Importar 155 factura(s)" in modal.inner_text(),
              modal.inner_text()[-200:])

        modal.locator("button:has-text('Importar 155')").click()
        page.wait_for_timeout(6000)

        creadas = int(psql("select count(*) from supplier_invoices where notes = 'Importado del control en Excel.'"))
        check("importa las 155 facturas con importe", creadas == 155, creadas)
        check("el total de facturas sube en 155",
              int(psql("select count(*) from supplier_invoices")) == antes + 155)

        # Los importes y el dato del servicio llegan completos.
        fila = psql("select total::text || '|' || coalesce(igv::text,'') || '|' || coalesce(plate,'') || '|' || "
                    "coalesce(client_name,'') || '|' || coalesce(volume_m3::text,'') || '|' || status "
                    "from supplier_invoices where series='E001' and number='356'")
        check("guarda importe, IGV, placa, cliente y volumen",
              fila == "4838.00|738.00|D7S943|Sonepar|50.00|PAGADA", fila)

        det = psql("select detraction_amount::text || '|' || detraction_status from supplier_invoices "
                   "where series='E001' and number='356'")
        check("conserva la detracción que dice la hoja", det == "194.00|PAGADA", det)

        # Esta fila es el caso real: la hoja la daba por anulada y, dentro de la celda de
        # estado, anotaba la nota de crédito que la anuló ("NC E001-29").
        anulada = psql("select status || '|' || detraction_status from supplier_invoices "
                       "where series='E001' and number='370'")
        check("una factura anulada con nota de crédito no deja detracción que depositar",
              anulada == "ANULADA|NO_APLICA", anulada)
        nc = psql("select coalesce(credit_note_number,'') || '|' || coalesce(credit_note_amount::text,'') "
                  "from supplier_invoices where series='E001' and number='370'")
        check("y queda guardada la nota de crédito que la anuló, por el importe de la factura",
              nc.startswith("E001-29|") and nc.split("|")[1] not in ("", "0.00"), nc)
        nota = psql("select detraction_notes from supplier_invoices where series='E001' and number='370'")
        check("y conserva lo que decía la hoja", "NC E001-29" in nota, nota)

        sin_ruc = int(psql("select count(*) from suppliers where ruc is null and "
                           "notes = 'Creado al importar el control en Excel. Falta el RUC.'"))
        check("crea exactamente los proveedores que anunció, sin RUC", sin_ruc == anunciados, (sin_ruc, anunciados))
        check("queda registrado en auditoría",
              int(psql("select count(*) from audit_logs where module='FACTURAS' and action='IMPORTAR'")) == 1)

        # --- Segunda carga del mismo archivo ---
        modal = importar(page)
        cuerpo = modal.inner_text()
        check("en la segunda carga no hay nada nuevo",
              "Todo lo de la hoja ya está registrado" in cuerpo, cuerpo[-200:])
        check("y reconoce las 155 como ya registradas", "155" in cuerpo and "Ya registradas" in cuerpo, cuerpo[:300])
        check("el botón de importar queda deshabilitado",
              modal.locator("button:has-text('Importar')").last.is_disabled())
        modal.locator("button:has-text('Cancelar')").last.click()
        page.wait_for_timeout(600)

        check("no se duplicó ninguna factura",
              int(psql("select count(*) from supplier_invoices where notes = 'Importado del control en Excel.'")) == 155)

        # --- Un archivo que no es el control ---
        page.click("button:has-text('Importar de Excel')")
        page.wait_for_timeout(600)
        modal = page.locator("div.fixed.inset-0.z-50")
        page.set_input_files("input[type=file]", os.path.abspath("package.json"))
        page.wait_for_timeout(2500)
        check("rechaza un archivo que no es Excel", "no es un Excel" in modal.inner_text(), modal.inner_text()[:200])
        modal.locator("button:has-text('Cancelar')").last.click()

        check("ninguna pantalla lanzó errores de JavaScript", not errores, errores[:3])
        ctx.close(); nav.close()

    print("\nTodo en orden." if not fails else f"\n{len(fails)} comprobación(es) fallaron: {fails}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
