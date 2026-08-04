import postgres from "postgres";

/**
 * LA CONEXIÓN A ICARUS, PARA UNA RUTA QUE VIVE — y por qué no alcanzaba la de los scripts.
 *
 * `clientes:sincronizar`, `ingest:icarus` y el puente de ventas ya abren icarus,
 * pero los tres son scripts: abren, leen todo, cierran, se mueren. Una ruta HTTP
 * no puede pagar el handshake de una conexión nueva por request ni dejar
 * conexiones colgadas contra una base que es de otro producto. Por eso acá el
 * pool es perezoso y compartido, y por eso es CHICO (`max: 3`): Hermes es un
 * invitado en esa base, no su dueño.
 *
 * ── READ-ONLY A NIVEL DE SERVIDOR, no de convención ──
 * `default_transaction_read_only=on` hace que cualquier escritura falle en
 * Postgres. Es lo mismo que hacen los scripts y por el mismo motivo: **icarus es
 * la plataforma multi-tenant de los clientes de consultoría y sirve a un cliente
 * real**. Un bug nuestro no puede escribirle. Que la garantía sea del servidor y
 * no de una revisión de código es el punto entero.
 *
 * ── FAIL-CLOSED y con nombre ──
 * Sin `ICARUS_DATABASE_URL` esto TIRA, con el nombre de la variable adentro. La
 * alternativa —devolver una lista vacía— convierte una config que falta en «no
 * hay contactos», que es la mentira que el catálogo de piezas aprendió a no
 * decir (ADR 0023): un `{ok: true}` con ceros le costó semanas a Ivi.
 */

/** El nombre de la variable, en un solo lugar (regla dura #1: se referencia, no se pega). */
export const ENV_ICARUS = "ICARUS_DATABASE_URL";

/** El error que la ruta traduce a un 503 que se puede leer. */
export class IcarusNoConfigurado extends Error {
  constructor() {
    super(
      `${ENV_ICARUS} no está configurada. Es la conexión READ-ONLY al Postgres de ` +
        `icarus, donde vive el padrón de contactos (ver server/.env.example).`,
    );
    this.name = "IcarusNoConfigurado";
  }
}

export type ConexionIcarus = postgres.Sql;

let pool: ConexionIcarus | null = null;

/**
 * El pool compartido, creado la primera vez que alguien lo pide.
 *
 * Perezoso a propósito: un Hermes sin la variable configurada tiene que arrancar
 * igual y fallar SOLO en esta pantalla. Tirar al importar el módulo dejaría el
 * server entero sin levantar por una función que quizá nadie llame —el CRM
 * completo caído por el padrón— y eso es exactamente al revés de la prioridad.
 */
export function icarus(env: NodeJS.ProcessEnv = process.env): ConexionIcarus {
  if (pool) return pool;

  const url = env[ENV_ICARUS];
  if (!url) throw new IcarusNoConfigurado();

  pool = postgres(url, {
    max: 3,
    idle_timeout: 30,
    connect_timeout: 10,
    connection: {
      default_transaction_read_only: true,
      application_name: "hermes-padron",
    },
    onnotice: () => {},
  });
  return pool;
}

/** Para los tests y el apagado ordenado: suelta el pool y obliga a rearmarlo. */
export async function cerrarIcarus(): Promise<void> {
  if (!pool) return;
  const abierto = pool;
  pool = null;
  await abierto.end({ timeout: 5 });
}
