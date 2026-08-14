import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  esquemaUpsert,
  normalizarNumero,
  estadoSesionAContrato,
  sesionPublicada,
  estadoVinculacionAContrato,
  estadoVinculacionVigente,
  VIGENCIA_QR_MS,
  esPareoEnVuelo,
} from "./dominio.js";

test("normalizarNumero: dígitos, mínimo 8, y prefija 51 a un móvil peruano de 9", () => {
  assert.equal(normalizarNumero("51986394450"), "51986394450");
  assert.equal(normalizarNumero("+51 986 394 450"), "51986394450");
  assert.equal(normalizarNumero("986394450"), "51986394450"); // 9 dígitos, móvil PE
  assert.equal(normalizarNumero("123"), null); // muy corto
  assert.equal(normalizarNumero(""), null);
});

test("🔴 esquemaUpsert: `proposito` y `activo` ausentes quedan AUSENTES, no en un default", () => {
  // Este test afirmaba lo contrario y por eso fijaba el defecto: con un
  // `.default()`, un push de Cerberus que omitiera `proposito` bajaba la línea del
  // candidato de `campana` a `escuela` y el comando de campaña pasaba a ver la cola
  // entera de la Escuela (`cola/lineas.ts:72` deriva `esDeCampana` de ese campo).
  // Son campos que Hermes inventó y Cerberus no conoce: ausente significa «no lo
  // toques», y quien pone el valor inicial es el INSERT de una fila nueva.
  const ok = esquemaUpsert.parse({ etiqueta: "Escuela" });
  assert.equal(ok.proposito, undefined, "un proposito ausente no se inventa");
  assert.equal(ok.activo, undefined, "un activo ausente no resucita una línea retirada");
  assert.deepEqual(ok.vendedoras, []);
  assert.equal(ok.referencia, null);

  const conTodo = esquemaUpsert.parse({
    etiqueta: " Campaña ",
    proposito: "campana",
    referencia: " ad_123 ",
    activo: false,
    vendedoras: ["ana", "bea"],
  });
  assert.equal(conTodo.etiqueta, "Campaña");
  assert.equal(conTodo.referencia, "ad_123");
  assert.equal(conTodo.activo, false);
  assert.deepEqual(conTodo.vendedoras, ["ana", "bea"]);

  assert.equal(esquemaUpsert.safeParse({ etiqueta: "" }).success, false);
  assert.equal(esquemaUpsert.safeParse({ etiqueta: "X", proposito: "otro" }).success, false);
});

test("estadoSesionAContrato: mapea cada estado del transporte, y el ban se ve", () => {
  assert.deepEqual(estadoSesionAContrato({ estado: "conectado", telefono: "519" }), {
    estado: "conectado",
    ban: null,
  });
  assert.deepEqual(estadoSesionAContrato({ estado: "conectando" }), { estado: "desconectado", ban: null });
  assert.deepEqual(estadoSesionAContrato({ estado: "desconectado", motivo: "x" }), {
    estado: "desconectado",
    ban: null,
  });
  assert.deepEqual(estadoSesionAContrato({ estado: "cerrada", motivo: "x" }), {
    estado: "sin_vincular",
    ban: null,
  });
  assert.deepEqual(estadoSesionAContrato({ estado: "sin-vincular", qr: null, codigo: null }), {
    estado: "sin_vincular",
    ban: null,
  });
  assert.deepEqual(estadoSesionAContrato({ estado: "baneado", codigo: "451", expira: "2026-07-25" }), {
    estado: "baneado",
    ban: { codigo: "451", expira_at: "2026-07-25" },
  });
});

test("estadoVinculacionAContrato: el QR pasa como esperando_qr; arranque como vinculando", () => {
  assert.deepEqual(estadoVinculacionAContrato({ estado: "inactivo" }), { estado: "expirado" });
  assert.deepEqual(estadoVinculacionAContrato({ estado: "esperando", numero: "519" }), {
    estado: "vinculando",
  });
  assert.deepEqual(estadoVinculacionAContrato({ estado: "qr", numero: "519", qr: "data:img" }), {
    estado: "esperando_qr",
    qr: "data:img",
  });
  assert.deepEqual(estadoVinculacionAContrato({ estado: "conectado", numero: "519", jid: "519@s" }), {
    estado: "conectado",
    jid: "519@s",
  });
  assert.deepEqual(estadoVinculacionAContrato({ estado: "error", numero: "519", motivo: "boom" }), {
    estado: "error",
    motivo: "boom",
  });
});

test("estadoVinculacionVigente: un QR que dejó de refrescarse deja de tomar el vinculador", () => {
  const qr = { estado: "qr", numero: "51941654039", qr: "data:img" } as const;
  const t0 = 1_700_000_000_000;

  // Vivo: whatsmeow lo rota cada ~20 s, así que uno recién llegado se muestra.
  assert.deepEqual(estadoVinculacionVigente(qr, t0, t0 + 19_000), qr);
  assert.deepEqual(estadoVinculacionVigente(qr, t0, t0 + VIGENCIA_QR_MS), qr);

  // Muerto: nadie escaneó, el canal se cerró. Deja de bloquear a los demás números.
  assert.deepEqual(estadoVinculacionVigente(qr, t0, t0 + VIGENCIA_QR_MS + 1), {
    estado: "inactivo",
  });

  // El contrato lo dice como `expirado`, que es lo que hace que la consola pida otro.
  assert.deepEqual(
    estadoVinculacionAContrato(estadoVinculacionVigente(qr, t0, t0 + 10 * 60_000)),
    { estado: "expirado" }
  );
});

test("estadoVinculacionVigente: un arranque colgado también caduca", () => {
  const t0 = 1_700_000_000_000;
  const esperando = { estado: "esperando", numero: "519" } as const;

  // Arrancando: whatsmeow tarda unos segundos en dar el primer QR.
  assert.deepEqual(estadoVinculacionVigente(esperando, t0, t0 + 5_000), esperando);

  // Colgado: `client.init()` nunca volvió. Sin esto el candado quedaba tomado sin
  // un solo QR de por medio — no había nada que envejeciera.
  assert.deepEqual(estadoVinculacionVigente(esperando, t0, t0 + VIGENCIA_QR_MS + 1), {
    estado: "inactivo",
  });
});

test("estadoVinculacionVigente: solo caduca lo que está en vuelo — lo demás pasa intacto", () => {
  const t0 = 1_700_000_000_000;
  const viejo = t0 - 60 * 60_000;

  // `conectado` no caduca: la sesión quedó hecha, el reloj no la deshace.
  const conectado = { estado: "conectado", numero: "519", jid: "519@s" } as const;
  assert.deepEqual(estadoVinculacionVigente(conectado, viejo, t0), conectado);

  // Un `error` viejo se sigue reportando: es el motivo que la pantalla muestra.
  const error = { estado: "error", numero: "519", motivo: "boom" } as const;
  assert.deepEqual(estadoVinculacionVigente(error, viejo, t0), error);

  // Un QR sin marca de tiempo no se puede juzgar: se muestra, no se inventa que murió.
  const qr = { estado: "qr", numero: "519", qr: "data:img" } as const;
  assert.deepEqual(estadoVinculacionVigente(qr, null, t0), qr);
});

test("esPareoEnVuelo: el ÉXITO no toma el candado — era el bloqueo eterno del próximo número", () => {
  // Lo que muerde: al terminar bien, `cerrar()` suelta el cliente pero el estado
  // se queda en `conectado`. Con el candado tomado por cualquier estado, vincular
  // un número NUEVO daba 409 para siempre después de una vinculación exitosa.
  assert.equal(esPareoEnVuelo({ estado: "conectado", numero: "519", jid: "519@s" }), false);

  // Fallas terminales: el cliente está muerto o inservible, e `iniciar()` empieza
  // cerrando. No hay nada que proteger.
  assert.equal(esPareoEnVuelo({ estado: "error", numero: "519", motivo: "boom" }), false);
  assert.equal(
    esPareoEnVuelo({ estado: "baneado", numero: "519", codigo: "451", expira: "2026-08-01" }),
    false
  );
  assert.equal(esPareoEnVuelo({ estado: "inactivo" }), false);

  // Los dos que SÍ: hay un cliente vivo esperando al teléfono. Ahí el candado protege.
  assert.equal(esPareoEnVuelo({ estado: "esperando", numero: "519" }), true);
  assert.equal(esPareoEnVuelo({ estado: "qr", numero: "519", qr: "data:img" }), true);
});

/**
 * EL SEMÁFORO DEL PANEL, CON VARIAS LÍNEAS (#50).
 *
 * El defecto que esto cierra: `sesionDeNumero()` le preguntaba a
 * `WHATSAPP_NUMERO`, así que **solo el primer número podía reportar estado
 * real**. Una segunda línea conectada y atendiendo se veía «Desconectado» en el
 * panel de Cerberus — y un semáforo que miente sobre lo que se acaba de agregar
 * enseña a no mirarlo, justo cuando más se lo mira.
 */
describe("sesionPublicada — el estado que ve el panel", () => {
  test("una línea VIVA reporta su estado real, sea la primera o la quinta", () => {
    assert.deepEqual(sesionPublicada({ estado: "conectado", telefono: "51999888777" }, true), {
      estado: "conectado",
      ban: null,
    });
  });

  test("el ban de una línea viva viaja con su código y su fecha", () => {
    assert.deepEqual(sesionPublicada({ estado: "baneado", codigo: "191", expira: "en 24 horas" }, true), {
      estado: "baneado",
      ban: { codigo: "191", expira_at: "en 24 horas" },
    });
  });

  test("vinculada pero NO corriendo: `desconectado`, no `conectado`", () => {
    // Es el caso de un número que se vinculó y todavía no se agregó a
    // WHATSAPP_NUMEROS. No está andando, y decir que sí sería la mentira inversa.
    assert.deepEqual(sesionPublicada(null, true), { estado: "desconectado", ban: null });
  });

  test("sin sesión y sin archivo: `sin_vincular` — nunca se vinculó", () => {
    assert.deepEqual(sesionPublicada(null, false), { estado: "sin_vincular", ban: null });
  });

  test("🔴 una línea viva NO se confunde con una vinculada-y-apagada", () => {
    // El corazón del bug: antes las dos daban `desconectado` porque el estado real
    // solo se consultaba para `WHATSAPP_NUMERO`.
    const viva = sesionPublicada({ estado: "conectado", telefono: "51999888777" }, true);
    const apagada = sesionPublicada(null, true);
    assert.notDeepEqual(viva, apagada);
    assert.equal(viva.estado, "conectado");
  });

  test("el archivo NO puede ascender a una línea viva que se cayó", () => {
    // Si el transporte dice `desconectado`, tener el `.db` no lo mejora: manda el
    // estado vivo, siempre.
    assert.equal(sesionPublicada({ estado: "desconectado", motivo: "se cayó" }, true).estado, "desconectado");
  });
});
