import "dotenv/config";
import { db } from "../db/client.js";
import type { DbDePrueba } from "../pruebas/base.js";
import {
  sembrarCalificacionBot,
  sembrarCliente,
  sembrarComentario,
  sembrarEstadoConversacion,
  sembrarInteres,
  sembrarLead,
  sembrarLineaDeVendedora,
  sembrarMensaje,
} from "../pruebas/sembrar.js";

/**
 * DATOS FALSOS PARA TRABAJAR MENSAJES EN LOCAL — `npm run sembrar:desarrollo`.
 *
 * ══ POR QUÉ EXISTE, HABIENDO UNA COPIA DE PRODUCCIÓN ════════════════════════
 *
 * El CLAUDE.md recomienda `pg_dump` de VPS1 para todo frente que toque la cola,
 * y tiene razón: los datos reales encontraron dos bugs que ningún test vio. Pero
 * eso baja conversaciones de gente real —nombre, teléfono, lo que escribieron—
 * a una máquina de trabajo, y para dibujar una pantalla no hace falta.
 *
 * Esto es la otra mitad: gente inventada, pero con LA FORMA que rompe cosas. Un
 * sembrado «bonito» (diez conversaciones iguales, todas respondidas, todas de la
 * misma línea) hace que la pantalla se vea perfecta y esconde los estados que
 * importan. Acá se siembran a propósito:
 *
 *   · **Los cinco niveles de urgencia**, para que la cola tenga qué ordenar.
 *   · **Conversaciones sin responder** de días distintos: la deuda vieja (+7d)
 *     no entra al chip «Te escribieron», y ese corte es la mitad de ADR 0052.
 *   · **La misma persona escribiendo a DOS líneas** — la cola agrupa por
 *     `(canal, persona, numeroPropio)`, así que son dos filas y se nota.
 *   · **Alguien que mandó el formulario tres veces**: el `DISTINCT ON` de
 *     ADR 0051 tiene que dejar UNA tarjeta, no tres.
 *   · **El texto que PRELLENA META** al tocar un anuncio, que es el 82 % de lo
 *     que el chip viejo «Piden info» enganchaba (ADR 0052).
 *   · **Un cliente del padrón** y **una escalada del bot**, que son píldoras que
 *     solo se ven si existe la fila.
 *
 * ⚠️ SOLO DESARROLLO. Aborta si la base no es la local — ver `esLaBaseLocal`.
 */

/** Las dos líneas que corren hoy en producción, para que los números se parezcan. */
const LINEA_META = "51984429504";
const LINEA_CAMPANA = "51963139984";

const VENDEDORAS = ["Jefferson", "luz", "sindy"] as const;

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const hace = (ms: number) => new Date(Date.now() - ms);

/** El texto exacto que Meta prellena al tocar el botón de un anuncio. */
const TEXTO_DE_META = "Hola Quiero más información del Diploma";

/**
 * 🔴 LA GUARDA ANTI-PRODUCCIÓN, y no es decorativa.
 *
 * Este script ESCRIBE. Corrido contra VPS1 metería cuarenta conversaciones
 * inventadas en la cola de las vendedoras, mezcladas con las de verdad y sin
 * forma fácil de distinguirlas. La misma clase de guarda que `montarBase.ts`
 * tiene para los tests con base, y por el mismo motivo.
 *
 * Se mira el HOST y el PUERTO, no el nombre de la base: `hermes_db` en VPS1 y
 * una copia local podrían llamarse igual.
 */
function esLaBaseLocal(url: string): boolean {
  try {
    const u = new URL(url);
    const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    // 5438 es producción y 5442 es el de los tests: ninguno de los dos.
    return local && u.port !== "5438" && u.port !== "5442";
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!esLaBaseLocal(url)) {
    console.error("✋ Esto solo corre contra la base LOCAL. DATABASE_URL apunta a otra parte.");
    process.exit(1);
  }

  // El tipo del sembrador es el de las bases de prueba; el cliente real tiene la
  // misma forma de drizzle. El cast vive en UN lugar y es el borde del andamio.
  const base = db as unknown as DbDePrueba;

  await sembrarLineaDeVendedora(base, LINEA_META, VENDEDORAS);
  await sembrarLineaDeVendedora(base, LINEA_CAMPANA, ["Jefferson"]);

  const gente = [
    { tel: "51987001001", nombre: "Ana Quispe" },
    { tel: "51987001002", nombre: "Luis Rojas" },
    { tel: "51987001003", nombre: "María Mendoza" },
    { tel: "51987001004", nombre: "Carlos Flores" },
    { tel: "51987001005", nombre: "Rosa Huamán" },
    { tel: "51987001006", nombre: "Jorge Vargas" },
    { tel: "51987001007", nombre: "Elena Castillo" },
    { tel: "51987001008", nombre: "Pedro Ramos" },
    { tel: "51987001009", nombre: "Lucía Chávez" },
    { tel: "51987001010", nombre: "Miguel Ríos" },
  ];

  /* ── 1 · Sin responder, de antigüedades distintas ───────────────────────── */
  // El corte de 7 días de «Te escribieron» (ADR 0052) solo se ve con las dos.
  const sinResponder: { tel: string; nombre: string; hace: number; texto: string }[] = [
    { ...gente[0], hace: 20 * 60 * 1000, texto: "Buenas, ¿cuánto sale el diploma?" },
    { ...gente[1], hace: 3 * HORA, texto: "¿Todavía hay cupo para setiembre?" },
    { ...gente[2], hace: 2 * DIA, texto: "Necesito información del temario" },
    { ...gente[3], hace: 11 * DIA, texto: "Hola, me interesa" },
    { ...gente[4], hace: 26 * DIA, texto: TEXTO_DE_META },
  ];
  for (const p of sinResponder) {
    await sembrarMensaje(base, {
      personaId: p.tel,
      personaNombre: p.nombre,
      texto: p.texto,
      direccion: "entrante",
      numeroPropio: LINEA_META,
      occurredAt: hace(p.hace),
      ...(p.texto === TEXTO_DE_META
        ? { origen: { fuente: "anuncio", titulo: "[AGO] OSINT y SOCMINT", adId: "1200045" } }
        : {}),
    });
  }

  /* ── 2 · Una conversación de ida y vuelta, con precio y silencio después ── */
  // Es el caso que ADR 0044 midió en 540: preguntaron, vieron el número y se
  // callaron. Cae en «Saben el precio» y en el recorte «Se callaron».
  await sembrarMensaje(base, {
    personaId: gente[5].tel,
    personaNombre: gente[5].nombre,
    texto: "Hola, ¿me pasás el precio del diplomado?",
    direccion: "entrante",
    numeroPropio: LINEA_META,
    occurredAt: hace(6 * DIA),
  });
  await sembrarMensaje(base, {
    personaId: gente[5].tel,
    texto: "¡Hola Jorge! Son S/ 1.200 al contado o 2 cuotas de S/ 650.",
    direccion: "saliente",
    numeroPropio: LINEA_META,
    occurredAt: hace(6 * DIA - HORA),
  });
  await sembrarInteres(base, {
    clave: `conv:whatsapp:${gente[5].tel}:${LINEA_META}`,
    curso: "Diploma en Inteligencia y Contrainteligencia",
    vendedoraId: "Jefferson",
  });

  /* ── 3 · Respondida y viva: la ventana de 24 h abierta ──────────────────── */
  await sembrarMensaje(base, {
    personaId: gente[6].tel,
    personaNombre: gente[6].nombre,
    texto: "Perfecto, mándame el link de pago",
    direccion: "entrante",
    numeroPropio: LINEA_META,
    occurredAt: hace(2 * HORA),
  });
  await sembrarMensaje(base, {
    personaId: gente[6].tel,
    texto: "Te lo paso ahora mismo 👍",
    direccion: "saliente",
    numeroPropio: LINEA_META,
    occurredAt: hace(90 * 60 * 1000),
  });
  await sembrarEstadoConversacion(base, {
    // ⚠️ El estado personal es POR VENDEDORA: sin el id, la conversación
    // quedaría fijada para «vendedora-prueba» y vos no la verías arriba.
    vendedoraId: "Jefferson",
    clave: `conv:whatsapp:${gente[6].tel}:${LINEA_META}`,
    fijada: true,
    fijadaAt: new Date(),
  });

  /* ── 4 · LA MISMA PERSONA EN DOS LÍNEAS ─────────────────────────────────── */
  // La cola agrupa por `(canal, persona, numeroPropio)`: tienen que salir DOS
  // filas. Con una sola, el agrupamiento está mal y no se nota de otra forma.
  for (const linea of [LINEA_META, LINEA_CAMPANA]) {
    await sembrarMensaje(base, {
      personaId: gente[7].tel,
      personaNombre: gente[7].nombre,
      texto: `Consulta por ${linea === LINEA_META ? "el diploma" : "la campaña"}`,
      direccion: "entrante",
      numeroPropio: linea,
      occurredAt: hace(5 * HORA),
    });
  }

  /* ── 5 · Un cliente del padrón, que pinta la píldora verde ──────────────── */
  await sembrarCliente(base, { telefono: gente[8].tel, pais: "PE", compras: 3, tier: "vip" });
  await sembrarMensaje(base, {
    personaId: gente[8].tel,
    personaNombre: gente[8].nombre,
    texto: "¿Sacaron algo nuevo este mes?",
    direccion: "entrante",
    numeroPropio: LINEA_META,
    occurredAt: hace(9 * HORA),
  });

  /* ── 6 · Una escalada del bot ───────────────────────────────────────────── */
  // `bot_calificaciones` no tenía lectores hasta que se agregó el chip: sin una
  // fila acá, ese chip no aparece nunca y no se puede mirar.
  await sembrarMensaje(base, {
    personaId: gente[9].tel,
    personaNombre: gente[9].nombre,
    texto: "Quiero pagar hoy, ¿cómo hago?",
    direccion: "entrante",
    numeroPropio: LINEA_META,
    occurredAt: hace(40 * 60 * 1000),
  });
  await sembrarCalificacionBot(base, {
    clave: `conv:whatsapp:${gente[9].tel}:${LINEA_META}`,
    escalada: true,
    temperatura: "caliente",
    motivo: "pidio_precio",
  });

  /* ── 7 · Comentarios de Facebook e Instagram ────────────────────────────── */
  await sembrarComentario(base, {
    canal: "facebook",
    personaId: "fb_10001",
    personaNombre: "Rocío Paredes",
    texto: "Info por favor",
    occurredAt: hace(4 * HORA),
  });
  await sembrarComentario(base, {
    canal: "instagram",
    personaId: "ig_20002",
    personaNombre: "kevin.dev",
    texto: "¿Dan certificado?",
    occurredAt: hace(30 * HORA),
  });

  /* ── 8 · Leads de formulario, uno REPETIDO tres veces ───────────────────── */
  // ADR 0051: la misma persona manda el formulario varias veces y sin el
  // `DISTINCT ON` ocupa cuatro tarjetas seguidas. Acá se siembra ese caso.
  for (let i = 0; i < 3; i++) {
    await sembrarLead(base, {
      fullName: "Sandra Ticona",
      email: "sandra@ejemplo.test",
      phone: "51987002001",
      platform: "web",
      formName: "icarus:landing",
      campaignName: "Diploma en Gestión Pública",
      createdTime: hace((i + 1) * 6 * HORA),
    });
  }
  await sembrarLead(base, {
    fullName: "Bruno Salas",
    email: "bruno@ejemplo.test",
    phone: "51987002002",
    platform: "web",
    formName: "icarus:landing",
    campaignName: "Curso de OSINT y SOCMINT",
    createdTime: hace(2 * DIA),
  });

  const cuenta = async (tabla: string) => {
    const [{ n }] = await db.execute<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabla}` as never);
    return n;
  };

  console.log("\n✔ base local sembrada");
  for (const t of ["interactions", "events", "leads", "numeros_wa", "clientes_padron", "bot_calificaciones"]) {
    console.log(`  ${String(await cuenta(t)).padStart(4)}  ${t}`);
  }
  console.log("\n  Abrí Mensajes: hay conversaciones sin responder de 20 min a 26 días,");
  console.log("  una con precio enviado, una fijada, la misma persona en dos líneas,");
  console.log("  un cliente VIP, una escalada del bot, comentarios de FB/IG y");
  console.log("  un formulario mandado tres veces por la misma persona.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
