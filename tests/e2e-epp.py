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
        # Las devoluciones van primero: apuntan al movimiento de entrada que las repuso, y
        # sin borrarlas la limpieza de movimientos choca contra esa referencia.
        "delete from epp_returns where product_id in (select id from products where code='REG-001')",
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

    # 5. Entrega: la lista sale entera en cero y solo se escribe lo que se entrega
    emp = psql("select id from employees where is_demo order by last_name limit 1")
    page.goto(BASE + f"/trabajadores/{emp}")
    page.get_by_role("button", name="Registrar entrega").click()
    page.wait_for_timeout(800)
    cantidades = m.locator("input[name^='cantidad_']")
    assert cantidades.count() > 1, cantidades.count()
    assert all(cantidades.nth(i).input_value() == "" for i in range(min(5, cantidades.count())))
    ok("Entrega: todos los EPP aparecen en cero")

    # Se escribe solo el que se entrega; los demás quedan como estaban.
    otro = psql("select id from products where code <> 'REG-001' and active order by code limit 1")
    stock_otro = psql("select stock from products where id = '%s'" % otro)
    m.locator(f"input[name='cantidad_{prod}']").fill("2")
    assert "2 Guante de prueba de regresión" in m.inner_text(), m.inner_text()[:300]
    m.get_by_role("button", name="Registrar entrega").click()
    toast(page, "Entrega registrada")
    assert psql("select stock from products where code='REG-001'") == "10"
    assert psql("select stock from products where id = '%s'" % otro) == stock_otro
    expect(page.get_by_role("row").filter(has_text="Guante de prueba de regresión")).to_be_visible()
    ok("Entrega: descuenta solo lo escrito y queda en el historial del trabajador")

    # 5b. El inventario explica el stock: ingresado − entregado
    page.goto(BASE + "/inventario?q=REG-001")
    page.wait_for_timeout(1200)
    fila_inv = page.get_by_role("row").filter(has_text="REG-001")
    texto_inv = fila_inv.inner_text()
    # Entraron 12, salieron 2 por entrega y 0 por merma: 12 − 2 = 10.
    assert "12" in texto_inv and "10" in texto_inv, texto_inv
    assert "otros" not in texto_inv.lower(), texto_inv
    ok("Inventario: muestra lo ingresado, lo entregado y el stock")

    # Una merma hace que la resta deje de cuadrar, y eso se dice en la fila en vez de
    # dejar un número que parece equivocado.
    page.get_by_role("button", name="Registrar salida").first.click()
    m.locator("#productId").select_option(prod)
    m.locator("#quantity").fill("1")
    m.locator("#reason").select_option("Merma / deterioro")
    m.get_by_role("button", name="Registrar salida").click()
    toast(page, "stock")
    page.goto(BASE + "/inventario?q=REG-001")
    page.wait_for_timeout(1200)
    assert "otros" in page.get_by_role("row").filter(has_text="REG-001").inner_text().lower()
    ok("Inventario: la merma se explica como diferencia, no como error")

    # 5c. El código se puede corregir sin perder el historial
    movs_antes = psql("select count(*) from inventory_movements mv join products pr on pr.id=mv.product_id where pr.code='REG-001'")
    page.get_by_role("button", name="Editar").first.click()
    m.locator("#code").fill("REG-999")
    m.get_by_role("button", name="Guardar cambios").click()
    toast(page, "actualizado")
    assert psql("select count(*) from products where code='REG-999'") == "1"
    assert psql("select count(*) from inventory_movements mv join products pr on pr.id=mv.product_id where pr.code='REG-999'") == movs_antes
    # Y se vuelve a dejar como estaba, para no romper lo que sigue.
    page.goto(BASE + "/inventario?q=REG-999")
    page.wait_for_timeout(1000)
    page.get_by_role("button", name="Editar").first.click()
    m.locator("#code").fill("REG-001")
    m.get_by_role("button", name="Guardar cambios").click()
    toast(page, "actualizado")
    ok("El código del EPP se puede corregir y el historial lo sigue")

    # 6. Anulación de entrega devuelve el stock
    page.goto(BASE + "/entregas")
    fila = page.get_by_role("row").filter(has_text="Guante de prueba de regresión").first
    fila.get_by_role("button", name="Anular entrega").click()
    m.locator("#voidReason").fill("Prueba de regresión de anulación")
    m.get_by_role("button", name="Anular entrega").click()
    toast(page, "anulada")
    # Entraron 12, se entregaron 2 (ahora anuladas, vuelven) y se dio de baja 1 por merma.
    assert psql("select stock from products where code='REG-001'") == "11"
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
    # El menú va por secciones que se pueden contraer, así que se comprueba por destino y no
    # por si el enlace está a la vista en ese momento.
    for visible in ["/inventario", "/entregas"]:
        assert nav.locator(f"a[href='{visible}']").count() > 0, f"falta {visible} en el menú"
    for oculto in ["/facturas", "/proveedores", "/usuarios", "/auditoria", "/reportes", "/detracciones"]:
        assert nav.locator(f"a[href='{oculto}']").count() == 0, f"{oculto} no debería verse"
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
    # El menú pliega las secciones que no se están usando, así que para comprobar qué
    # entradas tiene este rol hay que abrirlas todas primero. Lo que no tenga permiso no
    # aparece ni abriéndolas: esa es la diferencia entre plegado y prohibido.
    for titulo in jnav.get_by_role("button").all():
        if titulo.get_attribute("aria-expanded") == "false":
            titulo.click()
            jp.wait_for_timeout(120)
    for visible in ["/inventario", "/movimientos", "/entregas", "/trabajadores", "/reportes", "/categorias"]:
        assert jnav.locator(f"a[href='{visible}']").count() > 0, f"falta {visible} en el menú"
    for oculto in ["/facturas", "/proveedores", "/usuarios", "/auditoria", "/detracciones", "/mantenimiento"]:
        assert jnav.locator(f"a[href='{oculto}']").count() == 0, f"{oculto} no debería verse"
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
