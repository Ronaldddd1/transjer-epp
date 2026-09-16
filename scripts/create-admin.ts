/**
 * Crea un administrador o restablece su contraseña.
 * Uso: npm run admin:create -- --name "Ronald Santos" --user rsantos --email rsantos@transjer.pe --password "ClaveSegura123"
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "../src/db/schema";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.toLowerCase();
  const password = arg("password");
  const username = (arg("user") ?? email?.split("@")[0] ?? "").toLowerCase();
  const name = arg("name") ?? "Administrador";
  if (!email || !password || password.length < 8 || !/^[a-z0-9._-]{3,50}$/.test(username)) {
    throw new Error('Uso: npm run admin:create -- --name "Nombre" --user usuario --email correo@transjer.pe --password "mínimo 8 caracteres"');
  }
  const client = postgres((process.env.DIRECT_URL || process.env.DATABASE_URL)!, { max: 1 });
  const db = drizzle(client);
  const passwordHash = await bcrypt.hash(password, 12);
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    await db.update(users).set({ passwordHash, role: "ADMIN", active: true }).where(eq(users.id, existing.id));
    console.log(`✔ ${email} ahora es administrador activo y su contraseña fue restablecida.`);
  } else {
    await db.insert(users).values({ name, username, email, passwordHash, role: "ADMIN" });
    console.log(`✔ Administrador creado: ${username} (${email})`);
  }
  await client.end();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
