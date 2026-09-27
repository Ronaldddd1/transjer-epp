/** Elimina SOLO los datos de prueba (is_demo = true) y todo su historial asociado. */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Define DATABASE_URL en tu archivo .env");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.begin(async (tx) => {
    const d = await tx`
      delete from epp_deliveries
      where product_id in (select id from products where is_demo) or employee_id in (select id from employees where is_demo)`;
    // Movimientos de productos REALES hechos a trabajadores de prueba: se conservan para que el
    // historial siga cuadrando con el stock; solo se quita el vínculo con el trabajador.
    const kept = await tx`
      update inventory_movements
      set employee_id = null,
          notes = concat_ws(' ', notes, '[Trabajador de prueba eliminado]')
      where employee_id in (select id from employees where is_demo)
        and product_id not in (select id from products where is_demo)`;
    const m = await tx`
      delete from inventory_movements
      where product_id in (select id from products where is_demo)`;
    const p = await tx`delete from products where is_demo`;
    const e = await tx`delete from employees where is_demo`;
    const c = await tx`delete from categories where is_demo and id not in (select category_id from products)`;
    // Facturas de prueba: se borran con sus adjuntos (en cascada) y se sueltan los correos ligados.
    const fa = await tx`
      delete from invoice_attachments
      where invoice_id in (select id from supplier_invoices where is_demo)`;
    const fi = await tx`delete from supplier_invoices where is_demo`;
    // Un proveedor de prueba solo se borra si ya no le queda ninguna factura real.
    const pr = await tx`
      delete from suppliers
      where is_demo and id not in (select supplier_id from supplier_invoices)`;
    await tx`insert into audit_logs (action, module, description, user_name)
             values ('ELIMINAR', 'PRODUCTOS', 'Se eliminaron los datos de prueba del sistema.', 'Sistema')`;
    console.log(`✔ Eliminados: ${p.count} productos, ${e.count} trabajadores, ${c.count} categorías, ${m.count} movimientos, ${d.count} entregas de prueba.`);
    console.log(`✔ Eliminados: ${fi.count} facturas (${fa.count} adjuntos) y ${pr.count} proveedores de prueba.`);
    if (kept.count) console.log(`ℹ ${kept.count} movimiento(s) de productos reales se conservaron (su trabajador era de prueba).`);
  });
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
