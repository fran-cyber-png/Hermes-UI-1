import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL no está configurado. Copiá server/.env.example a server/.env.");
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
export { schema };
