"""
Prueba de regresión del sistema de EPP ya existente, para confirmar que el módulo de
facturas no rompió nada. Requiere el servidor en http://localhost:3000 con datos de prueba.
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 tests/e2e-epp.py
"""
import os, re, subprocess
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=15000)
BASE = "http://localhost:3000"

def ok(name): print("OK  ", name)
DB = os.environ.get("E2E_DB", "epp")

def psql(q):
    return subprocess.check_output(["su", "postgres", "-c", f'psql -d {DB} -tAc "{q}"']).decode().strip()
def toast(page, text):
    expect(page.get_by_role("status").filter(has_text=text)
           .or_(page.get_by_role("alert").filter(has_text=text)).first).to_be_visible(timeout=10000)
def login(page, user, pw):
    page.goto(BASE + "/login"); page.fill("#identifier", user); page.fill("#password", pw)
    page.get_by_role("button", name="Ingresar").click()
    expect(page).to_have_url(re.compile("/dashboard"))

def limpiar():
    """Deja la base como recién sembrada, para que la prueba se pueda repetir."""
    sentencias = [
        "delete from epp_deliveries where product_id in (select id from products where code='REG-001')",
        "delete from inventory_movements where product_id in (select id from products where code='REG-001')",
        "delete from products where code='REG-001'",
        "delete from users where username in ('almacen2','jalmacen')",
    ]
    for q in sentencias:
        subprocess.run(["su", "postgres", "-c", f'psql -q -d {DB} -c "{q}"'], check=True, stdout=subprocess.DEVNULL)

limpiar()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:160]))
    m = page.get_by_role("dialog")

    # 1. Inicio de sesión
    page.goto(BASE + "/login"); page.fill("#identifier", "admin"); page.fill("#password", "mal")
    page.get_by_role("button", name="Ingresar").click()
    expect(page.get_by_text(re.compile("incorrect", re.I)).first).to_be_visible()
    login(page, "admin", "Admin123!")
    ok("Login: rechaza credenciales erróneas y acepta las correctas")

    # 1b. El sistema se llama Transjer Gestión y muestra el logotipo
    assert "Transjer Gestión" in page.title(), page.title()
    expect(page.get_by_role("img", name="Transjer").first).to_be_visible()
    expect(page.get_by_text("EPP Transjer")).to_have_count(0)
    ok("Nombre nuevo (Transjer Gestión) y logotipo en su lugar")

    # 2. Dashboard de inventario intacto
    expect(page.get_by_role("heading", name="Panel general")).to_be_visible()
    for tarjeta in ["Total de productos", "Stock total", "Stock bajo", "EPP entregados"]:
        expect(page.get_by_text(tarjeta, exact=True)).to_be_visible()
    expect(page.get_by_text("Requieren reposición")).to_be_visible()
    expect(page.get_by_text("Movimientos de los últimos 30 días")).to_be_visible()
    ok("Dashboard conserva las tarjetas y paneles del almacén")

    # 3. Inventario: alta de producto con stock inicial como entrada
    page.goto(BASE + "/inventario")
    page.get_by_role("button", name="Nuevo EPP").click()
    cat = psql("select id from categories where name='Protección de manos'")
    m.locator("#code").fill("REG-001")
    m.locator("#name").fill("Guante de prueba de regresión")
    m.locator("#categoryId").select_option(cat)
    m.locator("#initialStock").fill("12")
    m.locator("#minimumStock").fill("4")
    m.get_by_role("button", name="Registrar EPP").click()
    toast(page, "correctamente")
    assert psql("select stock from products where code='REG-001'") == "12"
    assert psql("select count(*) from inventory_movements mv join products pr on pr.id=mv.product_id "
                "where pr.code='REG-001' and mv.type='ENTRADA'") == "1"
    ok("Inventario: el stock inicial queda registrado como entrada")

    # 4. Salida y tope de stock
    prod = psql("select id from products where code='REG-001'")
    page.get_by_role("button", name="Registrar salida").first.click()
    m.locator("#productId").select_option(prod)
    m.locator("#quantity").fill("99")
    m.locator("#notes").fill("Prueba de regresión")
    m.get_by_role("button", name="Registrar salida").click()
    toast(page, "stock")
    assert psql("select stock from products where code='REG-001'") == "12"
    ok("El stock nunca queda negativo")

    # 5. Entrega descuenta stock y aparece en el historial del trabajador
    emp = psql("select id from employees where is_demo order by last_name limit 1")
    page.goto(BASE + f"/trabajadores/{emp}")
    page.get_by_role("button", name="Registrar entrega").click()
    m.locator("#productId").select_option(prod)
    m.locator("#quantity").fill("2")
    m.get_by_role("button", name="Registrar entrega").click()
    toast(page, "Entrega registrada")
    assert psql("select stock from products where code='REG-001'") == "10"
    expect(page.get_by_role("row").filter(has_text="Guante de prueba de regresión")).to_be_visible()
    ok("Entrega: descuenta stock y queda en el historial del trabajador")

    # 6. Anulación de entrega devuelve el stock
    page.goto(BASE + "/entregas")
    fila = page.get_by_role("row").filter(has_text="Guante de prueba de regresión").first
    fila.get_by_role("button", name="Anular entrega").click()
    m.locator("#voidReason").fill("Prueba de regresión de anulación")
    m.get_by_role("button", name="Anular entrega").click()
    toast(page, "anulada")
    assert psql("select stock from products where code='REG-001'") == "12"
    ok("Anular una entrega devuelve el stock")

    # 7. Categorías y trabajadores siguen operativos
    page.goto(BASE + "/categorias")
    expect(page.get_by_role("row").filter(has_text="Protección de manos")).to_be_visible()
    page.goto(BASE + "/trabajadores")
    expect(page.locator("tbody tr").first).to_be_visible()
    ok("Categorías y trabajadores siguen operativos")

    # 8. Reportes y exportación
    page.goto(BASE + "/reportes?tipo=inventario")
    expect(page.get_by_role("columnheader", name="Stock").first).to_be_visible()
    pdf = page.request.get(BASE + "/api/export?tipo=movimientos&format=pdf")
    assert pdf.status == 200 and pdf.body()[:5] == b"%PDF-"
    xlsx = page.request.get(BASE + "/api/export?tipo=entregas&format=xlsx")
    assert xlsx.status == 200 and len(xlsx.body()) > 1000
    ok("Reportes: se ven y se descargan en PDF y Excel")

    # 9. Auditoría sin contraseñas
    page.goto(BASE + "/auditoria")
    expect(page.locator("tbody tr").first).to_be_visible()
    assert psql("select count(*) from audit_logs where old_data::text like '%passwordHash%' "
                "or new_data::text like '%passwordHash%'") == "0"
    ok("Auditoría registra los cambios y nunca guarda contraseñas")

    # 10. Rol Usuario: permisos del almacén, sin facturas
    page.goto(BASE + "/usuarios")
    page.get_by_role("button", name="Nuevo usuario").click()
    m.locator("#name").fill("Operador Almacén 2")
    m.locator("#username").fill("almacen2")
    m.locator("#email").fill("almacen2@transjer.pe")
    m.locator("#role").select_option("USUARIO")
    m.locator("#password").fill("Almacen456!")
    m.get_by_role("button", name="Crear usuario").click()
    toast(page, "Usuario")

    uctx = b.new_context(viewport={"width": 1440, "height": 950})
    up = uctx.new_page()
    login(up, "almacen2", "Almacen456!")
    nav = up.get_by_role("navigation")
    expect(nav.get_by_role("link", name="Inventario")).to_be_visible()
    expect(nav.get_by_role("link", name="Entregas")).to_be_visible()
    for oculto in ["Facturas", "Proveedores", "Usuarios", "Auditoría", "Reportes"]:
        expect(nav.get_by_role("link", name=oculto)).to_have_count(0)
    up.goto(BASE + "/facturas")
    expect(up).to_have_url(re.compile("denied=1"))
    up.goto(BASE + "/proveedores")
    expect(up).to_have_url(re.compile("denied=1"))
    assert up.request.get(BASE + "/api/export?tipo=inventario&format=csv").status == 403
    uctx.close()
    ok("Rol Usuario: mantiene el almacén y no ve facturas ni proveedores")

    # 10b. Rol Jefe de almacén: manda en el almacén, sin usuarios ni facturas
    page.goto(BASE + "/usuarios")
    page.get_by_role("button", name="Nuevo usuario").click()
    m.locator("#name").fill("Jefe de Almacén")
    m.locator("#username").fill("jalmacen")
    m.locator("#email").fill("jalmacen@transjer.pe")
    m.locator("#role").select_option("JEFE_ALMACEN")
    expect(m.get_by_text("Sin usuarios ni facturas")).to_be_visible()
    m.locator("#password").fill("Almacen789!")
    m.get_by_role("button", name="Crear usuario").click()
    toast(page, "Usuario")

    jctx = b.new_context(viewport={"width": 1440, "height": 950})
    jp = jctx.new_page()
    login(jp, "jalmacen", "Almacen789!")
    jnav = jp.get_by_role("navigation")
    for visible in ["Inventario", "Movimientos", "Entregas", "Trabajadores", "Reportes", "Categorías"]:
        expect(jnav.get_by_role("link", name=visible)).to_be_visible()
    for oculto in ["Facturas", "Proveedores", "Usuarios", "Auditoría"]:
        expect(jnav.get_by_role("link", name=oculto)).to_have_count(0)
    # Puede lo que el rol Usuario no puede
    jp.goto(BASE + "/inventario")
    expect(jp.get_by_role("button", name="Nuevo EPP")).to_be_visible()
    expect(jp.get_by_role("button", name="Registrar ajuste").first).to_be_visible()
    jp.goto(BASE + "/trabajadores")
    expect(jp.get_by_role("button", name="Nuevo trabajador")).to_be_visible()
    # Pero no entra a lo ajeno
    for prohibido in ["/facturas", "/proveedores", "/usuarios", "/auditoria"]:
        jp.goto(BASE + prohibido)
        expect(jp).to_have_url(re.compile("denied=1"))
    jctx.close()
    ok("Rol Jefe de almacén: control total del almacén, sin facturas ni usuarios")

    # 11. Cerrar sesión
    page.goto(BASE + "/dashboard")
    page.get_by_role("button", name="Cerrar sesión").click()
    expect(page).to_have_url(re.compile("/login"))
    page.goto(BASE + "/inventario")
    expect(page).to_have_url(re.compile("/login"))
    ok("Cerrar sesión corta el acceso a las páginas protegidas")

    assert not errors, errors
    ok("Sin errores de JavaScript")
    print("\nEPP: todas las verificaciones superadas")
