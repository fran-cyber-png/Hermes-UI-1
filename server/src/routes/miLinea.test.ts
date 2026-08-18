import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { firmarSesion } from "../auth/sesion.js";
import type { EstadoVinculacion } from "../numeros/dominio.js";
import { VIGENCIA_PAREO_MS } from "../numeros/pareoPropio.js";
import {
  miLineaRouter,
  type DependenciasMiLinea,
  type PuertaVinculador,
  type RepositorioMiLinea,
} from "./miLinea.js";

/**
 * LA AUTO-VINCULACIÓN, INTERROGADA SIN BASE Y SIN WHATSMEOW.
 *
 * Estos tests existen porque el frente salió con CERO: el router importaba `db`,
 * `vinculador` y `wiring` a nivel de módulo, así que abrirlo levantaba Postgres y
 * el binario Go. Con los seams inyectados se puede preguntar lo que importa —de
 * quién es el pareo, qué pasa si el montaje falla, qué pasa si nadie cierra el
 * modal— en milisegundos y sin tocar nada real.
 *
 * El server efímero es 127.0.0.1 (loopback): se prueba NUESTRA ruta con su
 * middleware, no se sale a ningún servicio. Molde: `routes/ivi.test.ts`.
 */

const ANA = "ana";
const BEA = "bea";
const TOKEN_ANA = firmarSesion(ANA);
/** 🔴 La MISMA persona, con la otra grafía viva: Cerberus escribe `Ana`, ella entra `ana`. */
const TOKEN_ANA_MAYUSCULA = firmarSesion("Ana");
const TOKEN_BEA = firmarSesion(BEA);
const MI_NUMERO = "51955135507";

const WHATSMEOW = { WHATSAPP_TRANSPORTE: "whatsmeow" } as NodeJS.ProcessEnv;

// ── Los dobles ────────────────────────────────────────────────────────────────

interface Espia {
  deps: DependenciasMiLinea;
  /** El reloj que ve el router. Moverlo es cómo se interroga la caducidad. */
  avanzar(ms: number): void;
  vinculadorEstado: EstadoVinculacion;
  iniciados: string[];
  cancelados: number;
  cerrados: number;
  montados: string[];
  upserts: { numero: string; vendedoras: string[]; etiqueta: string }[];
  vinculadosMarcados: string[];
}

function armar(
  opciones: {
    lineas?: Record<string, string[]>;
    numerosRegistrados?: Record<string, string[]>;
    montadas?: string[];
    montarLanza?: boolean;
    upsertLanza?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): Espia {
  let ahora = 1_700_000_000_000;
  const espia: Espia = {
    deps: {} as DependenciasMiLinea,
    avanzar: (ms) => {
      ahora += ms;
    },
    vinculadorEstado: { estado: "inactivo" },
    iniciados: [],
    cancelados: 0,
    cerrados: 0,
    montados: [],
    upserts: [],
    vinculadosMarcados: [],
  };
  const lineas = { ...(opciones.lineas ?? {}) };
  const registrados = { ...(opciones.numerosRegistrados ?? {}) };
  const montadas = new Set(opciones.montadas ?? []);

  const repositorio: RepositorioMiLinea = {
    lineasDeVendedora: async (vendedoraId) => lineas[vendedoraId.toLowerCase()] ?? [],
    obtenerNumero: async (numero) =>
      registrados[numero] ? { numero, vendedoras: registrados[numero] } : null,
    upsertNumero: async (numero, datos) => {
      if (opciones.upsertLanza) throw new Error("la base dijo que no");
      espia.upserts.push({ numero, vendedoras: datos.vendedoras, etiqueta: datos.etiqueta });
      return null;
    },
    marcarVinculado: async (numero) => {
      espia.vinculadosMarcados.push(numero);
    },
  };

  const vinculador: PuertaVinculador = {
    estado: () => espia.vinculadorEstado,
    iniciar: async (numero) => {
      espia.iniciados.push(numero);
      espia.vinculadorEstado = { estado: "esperando", numero };
    },
    cerrar: async () => {
      espia.cerrados += 1;
    },
    cancelar: async () => {
      espia.cancelados += 1;
      espia.vinculadorEstado = { estado: "inactivo" };
    },
  };

  espia.deps = {
    repositorio,
    vinculador,
    montarLinea: (numero) => {
      if (opciones.montarLanza) throw new Error("el gestor no lo pudo montar");
      montadas.add(numero);
      espia.montados.push(numero);
    },
    lineaMontada: (numero) => montadas.has(numero),
    sesionDe: () => ({ estado: "conectado", ban: null }),
    ahora: () => ahora,
    env: opciones.env ?? WHATSMEOW,
  };
  return espia;
}

interface Respuesta {
  status: number;
  json: Record<string, unknown>;
}

/** Un server efímero con el router montado, y un cliente mínimo contra él. */
async function conServidor<T>(
  deps: DependenciasMiLinea,
  fn: (pedir: (metodo: string, ruta: string, opciones?: { token?: string; body?: unknown }) => Promise<Respuesta>) => Promise<T>,
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/whatsapp/mi-linea", miLineaRouter(deps));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(async (metodo, rutaHttp, opciones = {}) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opciones.token !== undefined) headers.authorization = `Bearer ${opciones.token}`;
      const resp = await fetch(`http://127.0.0.1:${port}/api/whatsapp/mi-linea${rutaHttp}`, {
        method: metodo,
        headers,
        body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
      });
      const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: resp.status, json };
    });
  } finally {
    server.close();
    await once(server, "close");
  }
}

// ── Los tests ─────────────────────────────────────────────────────────────────

describe("mi-linea — la puerta", () => {
  test("🔴 sin token: 401 en TODAS, y el vinculador ni se entera", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      for (const [metodo, r] of [
        ["GET", "/"],
        ["POST", "/vincular"],
        ["GET", "/vincular/estado"],
        ["DELETE", "/vincular"],
      ] as const) {
        const resp = await pedir(metodo, r, metodo === "POST" ? { body: { numero: MI_NUMERO } } : {});
        assert.equal(resp.status, 401, `${metodo} ${r} tendría que exigir sesión`);
      }
    });
    assert.deepEqual(espia.iniciados, []);
  });

  test("mi línea de hoy: sin ninguna, `numero: null`", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      const resp = await pedir("GET", "/", { token: TOKEN_ANA });
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.json, { numero: null });
    });
  });

  test("mi línea de hoy: con una, viaja su estado de sesión", async () => {
    const espia = armar({ lineas: { ana: [MI_NUMERO] } });
    await conServidor(espia.deps, async (pedir) => {
      const resp = await pedir("GET", "/", { token: TOKEN_ANA });
      assert.equal(resp.json.numero, MI_NUMERO);
      assert.deepEqual(resp.json.sesion, { estado: "conectado", ban: null });
    });
  });
});

describe("POST /vincular — los vetos", () => {
  test("🔴 con el transporte en `falso` no se toca el vinculador: la credencial no se escribe", async () => {
    // Es el caso de PRODUCCIÓN hoy. El 409 es el precio de no dejar 43 MB de
    // sesión de WhatsApp escritos en VPS1 para un transporte que no la usaría.
    const espia = armar({ env: { WHATSAPP_TRANSPORTE: "falso" } as NodeJS.ProcessEnv });
    await conServidor(espia.deps, async (pedir) => {
      const resp = await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      assert.equal(resp.status, 409);
      assert.equal(resp.json.codigo, "transporte_sin_vinculacion");
    });
    assert.deepEqual(espia.iniciados, [], "ni un `iniciar()`: ahí es donde se escribe el .db");
  });

  test("número inválido: 400 y nada en vuelo", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      const resp = await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: "123" } });
      assert.equal(resp.status, 400);
      assert.equal(resp.json.codigo, "entrada_invalida");
    });
    assert.deepEqual(espia.iniciados, []);
  });

  test("un número de OTRA persona: 409 numero_en_uso, sin escanear nada", async () => {
    const espia = armar({ numerosRegistrados: { [MI_NUMERO]: ["bea"] } });
    await conServidor(espia.deps, async (pedir) => {
      const resp = await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      assert.equal(resp.status, 409);
      assert.equal(resp.json.codigo, "numero_en_uso");
    });
    assert.deepEqual(espia.iniciados, []);
  });

  test("🔴 mi propio número, registrado con la OTRA grafía, NO es `numero_en_uso`", async () => {
    // Cerberus lo escribió como `Ana`; ella entra como `ana`. Con `includes`
    // exacto, su propia línea le contestaba que estaba tomada.
    const espia = armar({ numerosRegistrados: { [MI_NUMERO]: ["Ana"] }, lineas: { ana: [MI_NUMERO] } });
    await conServidor(espia.deps, async (pedir) => {
      const resp = await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      assert.equal(resp.status, 200);
      assert.equal(resp.json.estado, "vinculando");
    });
    assert.deepEqual(espia.iniciados, [MI_NUMERO]);
  });

  test("🔴 una línea YA MONTADA no se re-parea: SQLite no admite dos escritores", async () => {
    const espia = armar({
      numerosRegistrados: { [MI_NUMERO]: ["ana"] },
      lineas: { ana: [MI_NUMERO] },
      montadas: [MI_NUMERO],
    });
    await conServidor(espia.deps, async (pedir) => {
      const resp = await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      assert.equal(resp.status, 409);
      assert.equal(resp.json.codigo, "linea_ya_corriendo");
    });
    assert.deepEqual(espia.iniciados, []);
  });

  test("un pareo ajeno en vuelo (por `/vincular` de operador): 409 vinculacion_en_curso", async () => {
    const espia = armar();
    espia.vinculadorEstado = { estado: "qr", numero: "51999999999", qr: "data:," };
    await conServidor(espia.deps, async (pedir) => {
      const resp = await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      assert.equal(resp.status, 409);
      assert.equal(resp.json.codigo, "vinculacion_en_curso");
    });
    assert.deepEqual(espia.iniciados, []);
  });
});

describe("el candado: dueño y caducidad", () => {
  test("mientras Ana parea, Bea recibe 409 y NO ve el estado de Ana", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      const deBea = await pedir("POST", "/vincular", { token: TOKEN_BEA, body: { numero: "51900000000" } });
      assert.equal(deBea.status, 409);
      assert.equal(deBea.json.codigo, "vinculacion_en_curso");

      const estadoDeBea = await pedir("GET", "/vincular/estado", { token: TOKEN_BEA });
      assert.deepEqual(estadoDeBea.json, { estado: "expirado" }, "Bea no puede ver el pareo de Ana");
    });
  });

  test("🔴 el dueño se compara normalizando: `Ana` empezó, `ana` sigue el polling", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA_MAYUSCULA, body: { numero: MI_NUMERO } });
      const resp = await pedir("GET", "/vincular/estado", { token: TOKEN_ANA });
      assert.equal(resp.json.estado, "vinculando", "con `!==` exacto esto decía «expirado»");
    });
  });

  test("🔴 cerrar el modal NO bloquea para siempre: el candado caduca solo", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      // Ana cierra el modal y nunca cancela. Pasa la vigencia.
      espia.avanzar(VIGENCIA_PAREO_MS + 1);
      // El vinculador global también se soltó (misma constante), así que Bea entra.
      espia.vinculadorEstado = { estado: "inactivo" };
      const deBea = await pedir("POST", "/vincular", { token: TOKEN_BEA, body: { numero: "51900000000" } });
      assert.equal(deBea.status, 200, "el candado sin caducidad dejaba esto en 409 hasta reiniciar");
      assert.equal(deBea.json.estado, "vinculando");
    });
  });

  test("mirar el QR sella el candado de nuevo: no caduca con alguien esperando", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      espia.vinculadorEstado = { estado: "qr", numero: MI_NUMERO, qr: "data:,qr" };
      // Cuatro polls repartidos a lo largo de más de una vigencia entera.
      for (let i = 0; i < 4; i++) {
        espia.avanzar(VIGENCIA_PAREO_MS / 2);
        const resp = await pedir("GET", "/vincular/estado", { token: TOKEN_ANA });
        assert.equal(resp.json.estado, "esperando_qr", `el poll ${i + 1} tendría que seguir vivo`);
      }
    });
  });

  test("un rechazo suelta el candado en el acto (no lo deja tomado por el que falló)", async () => {
    const espia = armar({ numerosRegistrados: { [MI_NUMERO]: ["bea"] } });
    await conServidor(espia.deps, async (pedir) => {
      const rechazada = await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      assert.equal(rechazada.json.codigo, "numero_en_uso");
      // Bea, inmediatamente después, tiene que poder entrar.
      const deBea = await pedir("POST", "/vincular", { token: TOKEN_BEA, body: { numero: "51900000000" } });
      assert.equal(deBea.status, 200);
    });
  });

  test("DELETE cancela lo mío; el pareo ajeno es 409, no un silencio", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      const deBea = await pedir("DELETE", "/vincular", { token: TOKEN_BEA });
      assert.equal(deBea.status, 409);
      assert.equal(deBea.json.codigo, "vinculacion_ajena");
      assert.equal(espia.cancelados, 0);

      const deAna = await pedir("DELETE", "/vincular", { token: TOKEN_ANA });
      assert.equal(deAna.status, 200);
      assert.deepEqual(deAna.json, { estado: "inactivo", cancelada: true });
      assert.equal(espia.cancelados, 1);
    });
  });
});

describe("GET /vincular/estado — el camino feliz y sus dos caídas", () => {
  test("🔴 al conectar registra, monta, y contesta `conectado` con `montada`", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      espia.vinculadorEstado = { estado: "conectado", numero: MI_NUMERO, jid: "jid@s" };
      const resp = await pedir("GET", "/vincular/estado", { token: TOKEN_ANA });
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.json, { estado: "conectado", numero: MI_NUMERO, montada: true });
    });
    assert.equal(espia.cerrados, 1, "hay que soltar el .db antes de que lo abra el transporte");
    assert.deepEqual(espia.upserts, [{ numero: MI_NUMERO, vendedoras: [ANA], etiqueta: ANA }]);
    assert.deepEqual(espia.vinculadosMarcados, [MI_NUMERO], "el UPDATE va DESPUÉS del INSERT");
    assert.deepEqual(espia.montados, [MI_NUMERO]);
  });

  test("🔴 el segundo poll después de conectar NO reprocesa ni desmiente: dice `expirado`, no vuelve a escribir", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      espia.vinculadorEstado = { estado: "conectado", numero: MI_NUMERO, jid: "jid@s" };
      await pedir("GET", "/vincular/estado", { token: TOKEN_ANA });
      const segundo = await pedir("GET", "/vincular/estado", { token: TOKEN_ANA });
      assert.deepEqual(segundo.json, { estado: "expirado" });
    });
    assert.equal(espia.upserts.length, 1, "una sola escritura por pareo");
    assert.deepEqual(espia.montados, [MI_NUMERO]);
  });

  test("🔴 si el MONTAJE falla, la fila queda escrita y se dice `montada: false`", async () => {
    // No hay rollback posible: `GestorWhatsapp` no tiene `quitar`. El arreglo es
    // «la fila queda, el montaje se reintenta» — no «se pierde la vinculación».
    const espia = armar({ montarLanza: true });
    await conServidor(espia.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      espia.vinculadorEstado = { estado: "conectado", numero: MI_NUMERO, jid: "jid@s" };
      const resp = await pedir("GET", "/vincular/estado", { token: TOKEN_ANA });
      assert.equal(resp.status, 200);
      assert.equal(resp.json.montada, false, "«¡Listo!» sobre una línea muda es la mentira que hay que evitar");
    });
    assert.equal(espia.upserts.length, 1, "la fila queda: es lo que hace posible el reintento");
  });

  test("🔴 y después de ese fallo el REINTENTO existe: volver a vincular el MISMO número", async () => {
    const espia = armar({
      // El estado en el que queda el mundo tras el fallo de montaje de arriba.
      numerosRegistrados: { [MI_NUMERO]: [ANA] },
      lineas: { ana: [MI_NUMERO] },
    });
    await conServidor(espia.deps, async (pedir) => {
      const resp = await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      assert.equal(resp.status, 200, "sin esto la fila queda escrita y no hay forma de levantarla");
      assert.equal(resp.json.estado, "vinculando");
    });
  });

  test("si la BASE falla, es 500 y el mensaje dice que el teléfono SÍ conectó", async () => {
    const espia = armar({ upsertLanza: true });
    await conServidor(espia.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      espia.vinculadorEstado = { estado: "conectado", numero: MI_NUMERO, jid: "jid@s" };
      const resp = await pedir("GET", "/vincular/estado", { token: TOKEN_ANA });
      assert.equal(resp.status, 500);
      assert.match(String(resp.json.message), /conect/i);
      assert.doesNotMatch(
        String(resp.json.message),
        /la base dijo que no/,
        "el detalle va al log: en drizzle `err.message` es el SQL",
      );
    });
    assert.deepEqual(espia.montados, [], "no se monta una línea que no quedó registrada");
  });

  test("`error` y `baneado` viajan con su motivo y sueltan el candado", async () => {
    const espia = armar();
    await conServidor(espia.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
      espia.vinculadorEstado = { estado: "error", numero: MI_NUMERO, motivo: "whatsmeow no levantó" };
      const resp = await pedir("GET", "/vincular/estado", { token: TOKEN_ANA });
      assert.deepEqual(resp.json, { estado: "error", motivo: "whatsmeow no levantó" });

      // Soltado: Bea puede entrar en el acto.
      espia.vinculadorEstado = { estado: "inactivo" };
      const deBea = await pedir("POST", "/vincular", { token: TOKEN_BEA, body: { numero: "51900000000" } });
      assert.equal(deBea.status, 200);
    });
  });
});

describe("dos routers no comparten candado", () => {
  let uno: Espia;
  let otro: Espia;
  beforeEach(() => {
    uno = armar();
    otro = armar();
  });

  test("el candado es por instancia: un test no le deja el candado tomado al siguiente", async () => {
    await conServidor(uno.deps, async (pedir) => {
      await pedir("POST", "/vincular", { token: TOKEN_ANA, body: { numero: MI_NUMERO } });
    });
    await conServidor(otro.deps, async (pedir) => {
      const resp = await pedir("POST", "/vincular", { token: TOKEN_BEA, body: { numero: MI_NUMERO } });
      assert.equal(resp.status, 200);
    });
  });
});
