import type { TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { guardarAntiProd, URL_ADMIN } from "./base.js";

/**
 * UN «ICARUS» DE PRUEBA — Postgres de verdad, schema mínimo (ADR 0008).
 *
 * ── Por qué no `baseDePrueba` ──
 * Aquél da un `drizzle` sobre el schema de HERMES. El padrón se consulta contra
 * **icarus**, que es otra base y se habla con el driver crudo. Así que se levanta
 * una base pelada y se le monta un `icarus` con las columnas que las consultas
 * tocan, y ninguna más: si mañana una consulta pide una columna que icarus no
 * tiene, el test falla — que es exactamente el aviso que hace falta cuando la
 * fuente es de otro equipo y otro repo.
 */

/** Monta una base efímera con un `icarus` mínimo y devuelve el driver crudo. */
export async function icarusDePrueba(t: TestContext) {
  guardarAntiProd(URL_ADMIN);

  const admin = postgres(URL_ADMIN, { max: 1, onnotice: () => {} });
  const nombre = `t_padron_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await admin.unsafe(`CREATE DATABASE "${nombre}"`);

  const sql = postgres(URL_ADMIN.replace(/\/[^/]+$/, `/${nombre}`), { max: 2, onnotice: () => {} });

  t.after(async () => {
    await sql.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  });

  await sql.unsafe(`
    CREATE SCHEMA icarus;
    CREATE TABLE icarus.contacts (
      id bigint PRIMARY KEY,
      name text, email text, phone text, dni varchar,
      country text, stage text, buyer_tier text,
      total_usd_spent numeric, n_purchases integer,
      course text, last_course text, source text,
      created_at timestamptz
    );
    CREATE TABLE icarus.sales (
      id bigint PRIMARY KEY, contact_id bigint, sale_date timestamptz
    );
    CREATE TABLE icarus.products (id bigint PRIMARY KEY, name text);
    CREATE TABLE icarus.sale_items (
      id bigint PRIMARY KEY, sale_id bigint, product_id bigint, total_price numeric
    );
  `);

  return sql;
}

/**
 * El corpus: chico, pero con la forma real de los defectos medidos en producción.
 *
 * Cada fila está por un caso, no por volumen — el país con nombre completo (así
 * lo guarda icarus, no ISO-2), el contador de compras que miente, el local de 8
 * dígitos que rompía el match por sufijo, y la fecha nula que tiene que quedar
 * al final en los dos órdenes.
 */
export async function sembrarIcarus(sql: postgres.Sql) {
  await sql.unsafe(`
    INSERT INTO icarus.contacts
      (id, name, email, phone, dni, country, stage, buyer_tier, total_usd_spent, n_purchases, course, last_course, source, created_at)
    VALUES
      -- Dice 3 compras y NO tiene ninguna venta: el 55% del padrón, medido.
      (1,'Ana Mentira','ana@x.com','51986394450','111','Perú','sold','vip',900,3,'Curso A','Curso A','anuncio','2026-01-10'),
      -- Compradora de verdad: tiene fila en sales.
      (2,'Beto Real','beto@x.com','51999888777','222','Perú','sold','single',450,1,'Curso B','Curso B','formulario','2026-03-15'),
      -- Sin teléfono usable.
      (3,'Cami SinTel','cami@x.com','12','333','México','contacted','prospect',NULL,0,'Curso A',NULL,'anuncio','2026-05-20'),
      -- Guatemalteca: local de 8 dígitos, el caso que rompía el match por sufijo.
      -- Entró con «Curso A» y hoy anda en «Curso C»: prueba que curso mira las dos columnas.
      (4,'Dora Guate','dora@x.com','50255123456','444','Guatemala','interested','prospect',NULL,0,'Curso A','Curso C','organico','2026-07-01'),
      -- Sin fecha ni nivel: tiene que quedar AL FINAL, no arriba.
      (5,'Eva SinFecha','eva@x.com','51911222333','555','Perú','contacted',NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    INSERT INTO icarus.sales (id, contact_id, sale_date) VALUES (10, 2, '2026-03-16');
    -- El add-on es MÁS CARO que nada pero menos que el curso: el ítem principal
    -- tiene que ganar, o la tabla diría «compró: Certificado» y no qué curso.
    INSERT INTO icarus.products (id, name) VALUES (100, 'Curso B (comprado)'), (101, 'Certificado');
    INSERT INTO icarus.sale_items (id, sale_id, product_id, total_price)
      VALUES (1000, 10, 100, 450), (1001, 10, 101, 30);
  `);
}

/**
 * EL CASO QUE EL PADRÓN TIENE AL REVÉS DE LO INTUITIVO (medido el 4-ago-2026).
 *
 * Los 477 contactos que entran por el webhook de `cerberus` tienen **venta en el
 * 100 % de los casos y curso en NINGUNO**: `course` lo llena la landing con lo
 * que la persona DIJO que quería, y quien compra por Cerberus nunca llenó ese
 * formulario. En pantalla se ve como una fila sin curso que dice «Sí compró»,
 * al lado de una con curso que dice que no — y las dos son correctas.
 *
 * Va aparte de `sembrarIcarus` para no mover los conteos de los tests que ya
 * existen: quien lo necesita lo pide.
 */
export async function sembrarCompradorSinCurso(sql: postgres.Sql) {
  await sql.unsafe(`
    INSERT INTO icarus.contacts
      (id, name, email, phone, dni, country, stage, buyer_tier, total_usd_spent, n_purchases, course, last_course, source, created_at)
    VALUES (6,'Fabio Cerberus','fabio@x.com','50761112222','666','Panamá','sold','single',380,0,NULL,NULL,'cerberus','2026-08-04');
    INSERT INTO icarus.sales (id, contact_id, sale_date) VALUES (20, 6, '2026-08-04');
    INSERT INTO icarus.products (id, name) VALUES (200, 'Diplomado en Gestión Pública');
    INSERT INTO icarus.sale_items (id, sale_id, product_id, total_price) VALUES (2000, 20, 200, 380);
  `);
}
