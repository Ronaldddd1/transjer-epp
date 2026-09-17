import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Define DATABASE_URL (o DIRECT_URL) en tu archivo .env");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  console.log("Aplicando migraciones…");
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Migraciones aplicadas correctamente.");
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
