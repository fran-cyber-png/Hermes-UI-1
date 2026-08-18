import { Router, type Request } from 'express';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { mandaEnElEquipo } from '../equipo/cargarRol.js';
import { porQueFallo } from '../lib/porQueFallo.js';
import { ruta } from '../lib/ruta.js';
import { leerDestinatario, type MotivoDestinatario } from '../correos/destinatario.js';
import { clasificarRechazo } from '../correos/rechazo.js';
import {
  armarSobre,
  componerCuerpo,
  correoDeVendedora,
  sinSaltos,
  type SobreDeCorreo,
} from '../correos/remitente.js';
import { nombreCortoDeVendedora } from '../correos/nombreVendedora.js';
import { dominiosVerificados, puedeSerRemitente } from '../correos/verificado.js';
import { frenoDeRitmo, TECHO_DIA, TECHO_HORA } from '../correos/ritmo.js';
import { TOPE_ASUNTO, TOPE_CUERPO } from '../correos/limites.js';
import {
  conteosDeRitmo,
  crearRemitente,
  desactivarRemitente,
  editarRemitente,
  guardarCorreo,
  leerCorreo,
  filaPorId,
  leerRemitente,
  listarCorreos,
  listarRemitentes,
  type FilaRemitente,
} from '../correos/repositorio.js';

/**
 * CORREOS — enviar emails desde Hermes, con la filosofía de la casa.
 *
 * Un correo = UNA vendedora → UN destinatario, auditado (tabla `correos`,
 * incluidos los fallidos). Sin listas, sin campañas — eso es otra herramienta y
 * otra política.
 *
 * ══ 🔴 POR DÓNDE SALE, DE VERDAD: ES **AMAZON SES** ═════════════════════════
 *
 * Acá decía «Sale por el SMTP de Goberna (mail.goberna.us)» y en el 503 decía «la
 * cuenta vive en mail.goberna.us». **Las dos frases eran falsas**, y lo fueron
 * durante casi un mes (desde el 21-jul-2026). Medido el 17-ago-2026:
 *
 *   · `SMTP_HOST` es **`email-smtp.us-east-1.amazonaws.com`** — Amazon SES.
 *   · El **MX de `goberna.us` es Google Workspace**, o sea que `mail.goberna.us`
 *     no es por donde sale nada: es —a lo sumo— por donde se recibe.
 *
 * El detalle importa más de lo que parece porque **ese nombre de host es lo que un
 * operador busca justo cuando algo falla**, que es el peor momento posible para
 * leer un servidor equivocado: manda a revisar un buzón de Google mientras el
 * problema está en la consola de SES, con un lead esperando del otro lado. Una
 * doc que miente sobre un dato de diagnóstico no es doc vieja, es una pista falsa.
 *
 * De ahí salen dos reglas que este archivo aplica y que no son obvias sin el
 * contexto de SES:
 *
 *   1. **El `From` tiene que vivir en un dominio VERIFICADO** o SES contesta 554.
 *      Se chequea al DAR DE ALTA el remitente (`correos/verificado.ts`), no al
 *      mandar. `goberna.us` está verificado; **`grupogoberna.com` no** — y tres de
 *      las nueve tienen su `vendedora_id` ahí.
 *   2. **El `Reply-To` NO lo verifica SES**, y ésa es la rendija por la que entra
 *      la decisión D2: la respuesta del lead vuelve a la vendedora que escribió.
 *
 * Credenciales por nombre en el `.env` (regla dura #1): `SMTP_HOST`, `SMTP_PORT`,
 * `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_DOMINIOS_VERIFICADOS`. Sin
 * configurar → 503 honesto: la UI dice qué falta, no finge.
 *
 * ══ QUÉ DECIDE ESTE ARCHIVO, Y QUÉ NO ══════════════════════════════════════
 *
 * **Es costura.** El veredicto lo dan los módulos puros y no se re-escribe acá:
 * quién es el destinatario (`destinatario.ts`), cómo queda el sobre
 * (`remitente.ts`), qué dominio puede ser `From` (`verificado.ts`), si hay cupo
 * (`ritmo.ts`) y cuánto entra (`limites.ts`). Lo único propio de este archivo es
 * el ORDEN en que se preguntan, los códigos de la respuesta y que nada salga sin
 * dejar fila.
 */
export const correosRouter = Router();
correosRouter.use(requiereVendedora);

function transporte() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const puerto = Number(SMTP_PORT ?? 587);
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: puerto,
    // 465 es TLS desde el saludo; 587 arranca en claro y sube con STARTTLS.
    secure: puerto === 465,
    // Fail-closed: sin esto, en el 587 el STARTTLS es OPORTUNISTA — si el
    // servidor no lo anuncia (o alguien se mete en el medio y lo saca del
    // saludo), nodemailer sigue igual y manda usuario y contraseña en claro,
    // sin un solo error. Con esto, ahí falla, que es lo correcto: preferimos un
    // correo que no sale a una credencial que sí.
    requireTLS: puerto !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/**
 * EL BUZÓN DE COMPATIBILIDAD: por dónde sale un correo si no hay ni un remitente
 * dado de alta. Es como funcionó Correos desde el 21-jul-2026.
 *
 * 🔴 **`SMTP_USER` YA NO ES EL RESPALDO, Y SACARLO ES UNA CORRECCIÓN DE
 * SEGURIDAD.** La versión vieja hacía `SMTP_FROM ?? SMTP_USER` y lo publicaba en
 * `GET /estado`, que es lo primero que pide la vista. Con un SMTP común eso era
 * inofensivo —ahí el usuario ES el buzón—, pero **en SES el `SMTP_USER` es un
 * Access Key ID de IAM**: la mitad de una credencial. O sea que ese `??` mandaba
 * un identificador de credencial al navegador de las nueve, lo dejaba en el caché
 * de IndexedDB (ADR 0007) y lo ponía en cualquier captura de la pestaña de red.
 * Es la regla dura #1 entrando por una puerta que nadie miraba.
 *
 * Y como respaldo tampoco servía: puesto en el `From`, SES lo rechaza con un 554
 * porque un Access Key no es una dirección verificada. Sin `SMTP_FROM` no hay
 * remitente de compatibilidad, y eso se dice (503), no se disfraza.
 */
function buzonDeCompatibilidad(): string | null {
  // ⚠️ Pasa por `sinSaltos` como TODA cabecera, aunque venga del `.env` y no de una
  // caja de texto. Era la única del frente que no lo hacía, y la excepción no se
  // sostiene: un `.env` se edita a mano por SSH y un salto de línea pegado ahí sin
  // querer es la misma inyección de cabeceras que se le prohíbe al asunto. La regla
  // vale más entera que con una excepción que alguien tenga que recordar.
  const desde = sinSaltos(process.env.SMTP_FROM ?? '');
  return desde === '' ? null : desde;
}

/** Un remitente como lo ve el composer: lo justo para DIBUJAR el sobre antes de mandar. */
function comoPublico(r: FilaRemitente) {
  return {
    id: r.id,
    direccion: r.direccion,
    nombre: r.nombre,
    responderA: r.responderA,
    firma: r.firma,
  };
}

/**
 * Un remitente como lo ve quien lo administra: lo de arriba más `activo` (sin él
 * no habría cómo volver a prender lo apagado) y el rastro del alta.
 *
 * ⚠️ Se enumera campo por campo en vez de mandar la fila, por lo mismo que
 * `listarCorreos` proyecta: con `res.json(fila)` una columna nueva del schema
 * **nace servida** y quien la agrega ni se entera. Acá hoy no sobra nada; el
 * hábito es lo que evita que mañana sobre.
 */
function comoAdministrable(r: FilaRemitente) {
  return {
    ...comoPublico(r),
    activo: r.activo,
    creadoPor: r.creadoPor,
    creadoAt: r.creadoAt,
  };
}

/** El `:id` de la ruta, o `null` si eso no es un id. */
function idDeRuta(crudo: string | undefined): number | null {
  const n = Number(crudo);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * El 403 de las cuatro rutas de remitentes. **Es el molde del Dashboard**
 * (ADR 0036): un 403 con su código, nunca un recorte silencioso ni una lista
 * vacía — «no te toca» y «no hay» se ven igual en pantalla y se arreglan distinto.
 *
 * ⚠️ Pregunta `mandaEnElEquipo(req)` y **no** `esSupervisor(id, env)`: desde la
 * tabla `equipo` (migración 0028) el rol es una ESCALERA, así que un **admin**
 * tiene que entrar acá igual que un supervisor. Con la comparación vieja contra
 * el CSV, el admin quedaba afuera de la única pantalla desde la que se configura
 * el canal. El CSV no se pierde: la cascada cae a `HERMES_SUPERVISORES` cuando la
 * migración no está o la persona no tiene fila.
 */
function noManda(req: Request): boolean {
  return !mandaEnElEquipo(req);
}

const NO_ES_SUPERVISOR = {
  ok: false as const,
  codigo: 'no_es_supervisor',
  message: 'Los remitentes de correo los administra un supervisor.',
};

// ════════════════════════════════════════════════════════════════════════════
// ESTADO
// ════════════════════════════════════════════════════════════════════════════

/**
 * ¿SE PUEDE MANDAR, POR DÓNDE Y CUÁNTO QUEDA? La vista pregunta antes de dibujar
 * el composer.
 *
 * ⚠️ **`sinRemitentes` tiene que ser EXACTAMENTE la condición bajo la cual
 * `POST /enviar` cae al buzón de compatibilidad**, no «parecida». Si se
 * calcularan distinto, la pantalla pediría elegir un remitente que la ruta no
 * exige (o al revés: mandaría sin elegir y comería un 400). Por eso las dos
 * miran la misma lista de ACTIVOS.
 *
 * ⚠️ Los inactivos no viajan acá: se sirven sólo por `GET /remitentes`, que está
 * detrás del 403. Un buzón retirado en el selector es un envío que va a fallar.
 */
correosRouter.get('/estado', ruta(async (req, res) => {
  const activos = await listarRemitentes(db);

  res.json({
    conectado: Boolean(transporte()),
    desde: buzonDeCompatibilidad(),
    remitentes: activos.map(comoPublico),
    sinRemitentes: activos.length === 0,
    supervisor: mandaEnElEquipo(req),
    dominiosVerificados: dominiosVerificados(process.env),
    ritmo: await ritmoDe(req.vendedoraId!),
  });
}));

/**
 * Cuánto cupo le queda a esta vendedora — **informativo, la garantía es el 429**.
 *
 * 🔴 **Si no se puede contar, el campo NO viaja; nunca viaja en cero.** Un
 * contador inventado diría «te quedan 20» mientras el envío se frena, que es
 * peor que no decir nada: el front lee `ritmo` como opcional justamente para eso
 * («ausente = no se dibuja el contador y no se frena nada acá»).
 *
 * ⚠️ Y por eso el `catch` está acá y no adentro de `conteosDeRitmo`, que **no
 * degrada a propósito**: allá un cero significa «mandá tranquila», o sea un techo
 * que se abre solo cuando la base hipa. La misma consulta, dos consumidores, dos
 * respuestas correctas y opuestas ante el mismo fallo.
 */
async function ritmoDe(vendedoraId: string) {
  try {
    const c = await conteosDeRitmo(db, vendedoraId, new Date());
    return {
      techoHora: TECHO_HORA,
      techoDia: TECHO_DIA,
      usadoHora: c.ultimaHora,
      usadoDia: c.ultimoDia,
    };
  } catch (e) {
    console.warn(`[correos] no se pudo contar el ritmo de «${vendedoraId}» — ${porQueFallo(e)}`);
    return undefined;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REMITENTES — las cuatro van detrás del 403
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ **VAN ANTES QUE `GET /:id`, y el orden es funcional, no estético**: Express
// resuelve por orden de declaración, así que con `/:id` arriba, `GET
// /api/correos/remitentes` entraría por el detalle de un correo con `id =
// "remitentes"` y contestaría 400 sobre una ruta que existe.

const cuerpoRemitenteNuevo = z.object({
  direccion: z.string(),
  nombre: z.string(),
  // `null` explícito = «este remitente no firma / no tiene responder-a»;
  // ausente = lo mismo. Se aceptan las dos formas porque el navegador manda la
  // primera y un script a mano manda la segunda.
  responderA: z.string().nullish(),
  firma: z.string().nullish(),
});

const cuerpoRemitenteCambios = z.object({
  nombre: z.string().optional(),
  responderA: z.string().nullish(),
  firma: z.string().nullish(),
  activo: z.boolean().optional(),
});

/** TODOS, incluidos los retirados: sin eso no habría cómo volver a prender nada. */
correosRouter.get('/remitentes', ruta(async (req, res) => {
  if (noManda(req)) {
    res.status(403).json(NO_ES_SUPERVISOR);
    return;
  }
  const filas = await listarRemitentes(db, { incluirInactivos: true });
  res.json({ remitentes: filas.map(comoAdministrable) });
}));

/**
 * DAR DE ALTA UN BUZÓN.
 *
 * 🔴 **`puedeSerRemitente` se pregunta ANTES de escribir, y ése es el punto del
 * frente.** SES contesta **554** a un `From` de un dominio que no verificó, y un
 * remitente mal dado de alta **no se ve mal en ningún lado**: la fila queda, la
 * pantalla lo lista, el selector lo ofrece — y el defecto aparece días después,
 * en el correo de OTRA persona, como «el correo no salió, volvé a intentar». Acá
 * hay alguien mirando la config y la respuesta se puede explicar; allá hay un
 * lead esperando una cotización.
 */
correosRouter.post('/remitentes', ruta(async (req, res) => {
  if (noManda(req)) {
    res.status(403).json(NO_ES_SUPERVISOR);
    return;
  }

  const parseo = cuerpoRemitenteNuevo.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({
      ok: false,
      codigo: 'cuerpo_invalido',
      message: 'Se esperan `direccion` y `nombre`; `responderA` y `firma` son opcionales.',
    });
    return;
  }

  // ⚠️ `direccion`, `nombre` y `responderA` pasan por `sinSaltos`: los tres
  // terminan en una CABECERA, y una cabecera es una línea. La `firma` NO —es
  // cuerpo, y una firma de tres renglones es lo normal: limpiarla la aplastaría
  // en uno solo y nadie entendería por qué.
  const direccion = sinSaltos(parseo.data.direccion);
  const nombre = sinSaltos(parseo.data.nombre);
  const responderA = parseo.data.responderA == null ? null : sinSaltos(parseo.data.responderA);
  const firma = parseo.data.firma == null ? null : parseo.data.firma.trim();

  if (direccion === '') {
    // Se pregunta antes que el dominio: a quien dejó la caja vacía, «SES sólo deja
    // mandar desde goberna.us» lo manda a pelear con una regla que no es la suya.
    res.status(400).json({
      ok: false,
      codigo: 'falta_direccion',
      message: 'Falta la dirección por la que sale el correo.',
    });
    return;
  }
  if (nombre === '') {
    res.status(400).json({
      ok: false,
      codigo: 'falta_nombre',
      message: 'Falta el nombre que va a ver quien reciba el correo.',
    });
    return;
  }

  const dominios = dominiosVerificados(process.env);
  if (!puedeSerRemitente(direccion, dominios)) {
    res.status(400).json({
      ok: false,
      codigo: 'dominio_no_verificado',
      dominios,
      message:
        `Amazon SES sólo deja mandar desde ${dominios.join(' · ')}. Con otro dominio la fila se guarda bien ` +
        'acá y SES la rechaza con un 554 recién al mandar, con el lead esperando del otro lado.',
    });
    return;
  }

  const alta = await crearRemitente(db, {
    direccion,
    nombre,
    responderA: responderA === '' ? null : responderA,
    firma: firma === '' ? null : firma,
    // La grafía que vino, sin reescribir: es rastro, no una llave.
    creadoPor: req.vendedoraId!,
  });

  if (!alta.ok) {
    // ⚠️ El 23505 no se deja propagar: al que llama le llegaría como un 500 «se
    // rompió», y lo que pasó es entendible — ese buzón ya está. Y como el índice
    // va sobre `lower(direccion)`, la fila que choca **puede no verse igual** a la
    // que acaban de escribir; el mensaje tiene que decirlo o la pantalla no puede
    // explicar por qué rebotó algo que en la lista no aparece.
    res.status(409).json({
      ok: false,
      codigo: 'remitente_repetido',
      message:
        'Ese buzón ya está dado de alta (las mayúsculas no lo hacen distinto). Si no aparece en la lista, ' +
        'está retirado: reactivalo en vez de crearlo de nuevo.',
    });
    return;
  }

  res.status(201).json({ remitente: comoAdministrable(alta.remitente) });
}));

/**
 * EDITAR lo editable.
 *
 * 🔴 **`direccion` no se puede cambiar, y mandarla es un 400 — nunca un campo que
 * se ignora en silencio.** Es la identidad del remitente: es lo que se chequeó
 * contra los dominios verificados al DAR DE ALTA —el único control que existe— y
 * es lo que ya viajó en el `desde` de cada correo que salió por él. Un PATCH que
 * la aceptara sería la puerta de atrás para meter un dominio sin verificar
 * salteándose ese control, y el 554 aparecería después, en el correo de otra
 * persona. Ignorarla callado es peor todavía: la pantalla mostraría el cambio
 * como hecho. Para cambiar de buzón se da de alta otro y se retira éste.
 */
correosRouter.patch('/remitentes/:id', ruta(async (req, res) => {
  if (noManda(req)) {
    res.status(403).json(NO_ES_SUPERVISOR);
    return;
  }

  const id = idDeRuta(req.params.id);
  if (id === null) {
    res.status(400).json({ ok: false, codigo: 'id_invalido', message: 'Ese no es un id de remitente.' });
    return;
  }

  if (req.body != null && typeof req.body === 'object' && 'direccion' in req.body) {
    res.status(400).json({
      ok: false,
      codigo: 'direccion_congelada',
      message:
        'La dirección de un remitente no se edita: es contra lo que se verificó el dominio en SES y lo que ' +
        'ya salió en los correos anteriores. Dá de alta otro buzón y retirá éste.',
    });
    return;
  }

  const parseo = cuerpoRemitenteCambios.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({
      ok: false,
      codigo: 'cuerpo_invalido',
      message: 'Se esperan `nombre`, `responderA`, `firma` o `activo`.',
    });
    return;
  }

  // ⚠️ Sólo se tocan las claves que VINIERON. `firma: undefined` (ausente) no es
  // `firma: null` (sacarla): con un objeto armado a lo bruto, editar el nombre le
  // borraba la firma a un remitente sin que nadie lo pidiera.
  const { nombre, responderA, firma, activo } = parseo.data;

  // 🔴 **REACTIVAR ES UN ALTA, Y POR ESO VUELVE A PREGUNTAR POR EL DOMINIO.**
  //
  // Éste era el segundo camino al 554 de SES, y lo encontró una CAPTURA, no un
  // test. El razonamiento que lo dejó abierto suena impecable: la dirección no se
  // puede editar (el `409` de acá arriba lo impide), así que si entró verificada
  // sigue verificada — el chequeo del alta alcanza. **Y es falso, porque lo que
  // puede cambiar no es la fila: es la LISTA.** `SMTP_DOMINIOS_VERIFICADOS` vive
  // en el `.env`, y el día que se saque un dominio —o que alguien lo quite de la
  // consola de SES— los remitentes retirados de ese dominio quedan ahí, esperando
  // que alguien apriete «Reactivar» desde la pantalla que promete que lo verifica.
  //
  // Ahí SES contesta 554 con un lead esperando, que es exactamente el momento que
  // `correos/verificado.ts` existe para evitar. Preguntar de nuevo cuesta una
  // comparación de cadenas; no preguntar cuesta el correo.
  //
  // ⚠️ Sólo cuando se está PRENDIENDO (`activo === true`). Retirar un remitente de
  // un dominio que ya no vale tiene que seguir funcionando —es justo lo que hay
  // que poder hacer— y editarle el nombre a uno apagado, también.
  //
  // ⚠️ Se lee con `filaPorId` y no con `leerRemitente`: aquélla filtra por `activo`
  // y devolvería `null` justo para el retirado que se quiere reactivar.
  if (activo === true) {
    const actual = await filaPorId(db, id);
    const verificados = dominiosVerificados(process.env);
    if (actual && !puedeSerRemitente(actual.direccion, verificados)) {
      res.status(400).json({
        ok: false,
        codigo: 'dominio_no_verificado',
        message:
          `No se puede reactivar «${actual.direccion}»: su dominio ya no está entre los verificados en SES ` +
          `(${verificados.join(', ')}). SES rechazaría cada envío con un 554 y el correo no saldría. ` +
          'Verificá el dominio en SES, o dá de alta un buzón de otro dominio.',
      });
      return;
    }
  }

  const fila = await editarRemitente(db, id, {
    ...(nombre === undefined ? {} : { nombre: sinSaltos(nombre) }),
    ...(responderA === undefined ? {} : { responderA: normalizarCabecera(responderA) }),
    ...(firma === undefined ? {} : { firma: normalizarFirma(firma) }),
    ...(activo === undefined ? {} : { activo }),
  });

  if (!fila) {
    res.status(404).json({
      ok: false,
      codigo: 'remitente_desconocido',
      message: 'Ese remitente ya no está: alguien lo borró mientras tenías la pantalla abierta.',
    });
    return;
  }

  res.json({ remitente: comoAdministrable(fila) });
}));

/**
 * RETIRAR = baja lógica.
 *
 * Con un `DELETE` de verdad, los correos que ya salieron por él quedan con un
 * `remitente_id` que no apunta a nada: la auditoría pierde de qué buzón salió
 * justo cuando alguien pregunta por uno viejo. Mismo criterio que `alias_curso`.
 * Volver a prenderlo es el `PATCH` con `activo: true`.
 */
correosRouter.delete('/remitentes/:id', ruta(async (req, res) => {
  if (noManda(req)) {
    res.status(403).json(NO_ES_SUPERVISOR);
    return;
  }

  const id = idDeRuta(req.params.id);
  if (id === null) {
    res.status(400).json({ ok: false, codigo: 'id_invalido', message: 'Ese no es un id de remitente.' });
    return;
  }

  const habia = await desactivarRemitente(db, id);
  if (!habia) {
    res.status(404).json({
      ok: false,
      codigo: 'remitente_desconocido',
      message: 'Ese remitente ya no está.',
    });
    return;
  }

  res.json({ ok: true });
}));

/** Una cabecera vacía es no tener cabecera: `''` y `'   '` valen `null`, no una línea en blanco. */
function normalizarCabecera(crudo: string | null | undefined): string | null {
  if (crudo == null) return null;
  const limpio = sinSaltos(crudo);
  return limpio === '' ? null : limpio;
}

/** La firma conserva sus renglones (ver el alta); lo único que se saca son los bordes. */
function normalizarFirma(crudo: string | null | undefined): string | null {
  if (crudo == null) return null;
  const limpio = crudo.trim();
  return limpio === '' ? null : limpio;
}

// ════════════════════════════════════════════════════════════════════════════
// LA AUDITORÍA
// ════════════════════════════════════════════════════════════════════════════

/**
 * LOS ÚLTIMOS DEL EQUIPO, **SIN EL CUERPO**.
 *
 * 🔴 Antes era un `select` sin proyectar sobre la tabla `correos`, o sea las nueve
 * columnas: **el texto que una vendedora le escribió a un lead —la cotización, el
 * precio, lo que le prometió— viajaba al navegador de las otras ocho en cada carga.**
 * La pantalla no lo dibujaba, y por eso nadie lo vio; pero un recorte hecho en el
 * navegador no existe — los datos ya viajaron, ya están en el caché de IndexedDB
 * (ADR 0007) y ya salieron en cualquier captura de la pestaña de red. Es lo que
 * ADR 0035 y 0036 prohíben. La proyección vive en `listarCorreos`.
 *
 * ⚠️ Sigue **sin** `WHERE vendedora_id`, a propósito: esto se mira para no
 * escribirle dos veces a la misma persona, y para eso hacen falta los de las
 * otras. Lo que cambió no es a quién se le muestra: es QUÉ.
 */
correosRouter.get('/', ruta(async (_req, res) => {
  const filas = await listarCorreos(db);
  res.json({ correos: filas });
}));

/**
 * UN correo, cuerpo incluido — porque acá SÍ se pidió.
 *
 * ⚠️ **No filtra por autora, y eso es un FILTRO que no existe, no una frontera
 * que se rompió.** La auditoría de qué se le dijo a un lead es del equipo, igual
 * que el hilo de WhatsApp: cualquiera puede abrir cualquier conversación. La
 * diferencia con la lista es **quién pide**: acá hay una persona abriendo un
 * correo puntual, allá una pantalla que se refresca sola. Si algún día esto tiene
 * que ser una frontera, va en el `WHERE` —como el padrón y el Dashboard—, nunca
 * en un `if` del navegador.
 */
correosRouter.get('/:id', ruta(async (req, res) => {
  const id = idDeRuta(req.params.id);
  if (id === null) {
    res.status(400).json({ ok: false, codigo: 'id_invalido', message: 'Ese no es un id de correo.' });
    return;
  }

  const fila = await leerCorreo(db, id);
  if (!fila) {
    res.status(404).json({ ok: false, codigo: 'correo_desconocido', message: 'Ese correo no existe.' });
    return;
  }

  res.json({ correo: fila });
}));

// ════════════════════════════════════════════════════════════════════════════
// ENVIAR
// ════════════════════════════════════════════════════════════════════════════

/** Cómo se lee cada rechazo del destinatario. Uno por motivo: no se colapsan. */
const LECTURA_DESTINATARIO: Record<MotivoDestinatario, string> = {
  vacio: 'Falta a quién se lo mandás: la casilla «Para» quedó vacía.',
  // 🔴 El caso que da nombre a `destinatario.ts`. Se dice el DISEÑO, no un error:
  // quien escribió `a@b.com, c@d.com` cree que puso una lista y que el sistema
  // falló, y con un «no se pudo enviar» vuelve a apretar. Hasta este frente esa
  // cadena SALÍA —nodemailer la parte en dos destinatarios sin decir nada— y la
  // tabla `correos` guardaba UNA fila con la cadena entera.
  varios: 'Un correo va a una sola persona, y en «Para» hay más de una dirección. Mandale a cada una por separado.',
  forma: 'Esa dirección no se lee como un correo. Revisá que tenga arroba y dominio, y nada más.',
  salto_de_linea: 'La dirección tiene un salto de línea. Escribila en un solo renglón.',
};

/**
 * MANDAR UN CORREO.
 *
 * ══ EL ORDEN DE LAS PREGUNTAS ES PARTE DEL CONTRATO ═════════════════════════
 *
 * destinatario → asunto → cuerpo → ritmo → remitente → SMTP → salir. Lo barato y
 * lo que corrige la persona va primero; lo que cuesta una consulta va después.
 * Y el ritmo va **antes** de resolver el remitente porque un techo quemado no se
 * arregla eligiendo otro buzón: contestar «elegí un remitente» a quien ya no
 * puede mandar la manda a probar cosas que no la van a destrabar.
 */
correosRouter.post('/enviar', ruta(async (req, res) => {
  const cuerpoCrudo = (req.body ?? {}) as Record<string, unknown>;
  const vendedoraId = req.vendedoraId!;

  // ── 1. UNA persona, y una sola ──────────────────────────────────────────
  // ⚠️ Lo que no es una cadena entra como cadena vacía, **no como `String(x)`**:
  // el body de un POST puede traer un número o un objeto, y `leerDestinatario`
  // define que eso es «no escribió una dirección» (motivo `vacio`). Con
  // `String({})` sería `"[object Object]"` y la pantalla contestaría «esa
  // dirección no se lee como un correo» sobre algo que no es una dirección.
  const crudoPara = cuerpoCrudo.para;
  const lectura = leerDestinatario(typeof crudoPara === 'string' ? crudoPara : '');
  if (!lectura.ok) {
    res.status(400).json({
      ok: false,
      codigo: 'destinatario',
      // El motivo viaja aparte del texto: la pantalla ramifica por él (los cuatro
      // tienen lectura propia allá también), y colapsarlos en una frase deja a
      // quien escribió `Ana <ana@x.com>` buscando una coma que no existe.
      motivo: lectura.motivo,
      message: LECTURA_DESTINATARIO[lectura.motivo],
    });
    return;
  }
  const destinatario = lectura.direccion;

  // ── 2. El asunto es una CABECERA ────────────────────────────────────────
  // 🔴 `sinSaltos` acá no es higiene: un retorno de carro adentro del asunto
  // CIERRA la cabecera y lo que sigue se manda como una cabecera nueva. O sea que
  // desde la caja de asunto de la pantalla se podía agregar un `Bcc:` y mandarle
  // el correo a quien quisiera, sin tocar la API y sin dejar rastro en `correos`.
  // Es el único agujero de este frente que se explota desde la UI.
  //
  // ⚠️ **Y lo que no es una cadena entra como cadena vacía, igual que en `para`.**
  // El argumento ya estaba escrito cinco líneas más arriba y este renglón lo
  // contradecía con un `String(x ?? '')`: con `{"asunto":{}}` salía
  // `"[object Object]"`, que mide 15, no está vacío, pasa el tope de 200 y
  // **llega al buzón del lead como el asunto del correo**. No es un caso
  // rebuscado: un composer que manda un objeto donde antes mandaba texto es un
  // refactor del front, no un ataque, y el server contestaba `ok: true`.
  const crudoAsunto = cuerpoCrudo.asunto;
  const asunto = sinSaltos(typeof crudoAsunto === 'string' ? crudoAsunto : '');
  if (asunto === '') {
    res.status(400).json({
      ok: false,
      codigo: 'asunto',
      motivo: 'asunto_vacio',
      message: 'Falta el asunto. Sin asunto el correo entra al buzón como un mensaje sospechoso.',
    });
    return;
  }
  if (asunto.length > TOPE_ASUNTO) {
    // ⚠️ Se rechaza, no se recorta. La versión vieja hacía `.slice(0, 200)`: al
    // lead le llegaba un asunto cortado a la mitad de una palabra y en la pantalla
    // se veía entero — dos cosas distintas que nadie podía atar.
    res.status(400).json({
      ok: false,
      codigo: 'asunto',
      motivo: 'asunto_largo',
      message: `El asunto pasa de los ${TOPE_ASUNTO} caracteres: sobran ${asunto.length - TOPE_ASUNTO}.`,
    });
    return;
  }

  // ── 3. El cuerpo ────────────────────────────────────────────────────────
  // ⚠️ Se mide la cadena CRUDA, sin recortar los bordes, porque el front mide
  // exactamente eso (`campos.cuerpo.length`). Con un `trim()` de un solo lado el
  // borde sería distinto en cada mitad y la pantalla diría que entra algo que acá
  // rebota.
  // ⚠️ **Lo que no es una cadena es «no escribió nada», nunca `String(x)`** — el
  // mismo criterio que `para` y que el asunto. Un `{"cuerpo":{}}` mandaba
  // `"[object Object]"` como texto del correo: no está vacío, entra en el tope, y
  // el lead recibe eso. Un `cuerpo_vacio` es la respuesta cierta.
  const crudoCuerpo = cuerpoCrudo.cuerpo;
  const cuerpoTexto = typeof crudoCuerpo === 'string' ? crudoCuerpo : '';
  if (cuerpoTexto.trim() === '') {
    res.status(400).json({
      ok: false,
      codigo: 'cuerpo',
      motivo: 'cuerpo_vacio',
      message: 'El correo no tiene texto.',
    });
    return;
  }
  if (cuerpoTexto.length > TOPE_CUERPO) {
    res.status(400).json({
      ok: false,
      codigo: 'cuerpo',
      motivo: 'cuerpo_largo',
      message: `El correo pasa de los ${TOPE_CUERPO} caracteres: sobran ${cuerpoTexto.length - TOPE_CUERPO}.`,
    });
    return;
  }

  // ── 4. El ritmo ─────────────────────────────────────────────────────────
  // 🔴 «Nada masivo» era una frase de la pantalla hasta acá. `destinatario.ts`
  // garantiza que un envío es a UNA persona; esto garantiza el VOLUMEN — mil
  // correos de a uno siguen siendo una campaña, y la tabla los audita DESPUÉS,
  // cuando ya salieron.
  // ⚠️ `conteosDeRitmo` **no degrada**: si no se puede contar, esto tira y el
  // envolvente contesta 500. Es lo correcto — un techo que se abre solo cuando la
  // base hipa no es un techo.
  const freno = frenoDeRitmo(await conteosDeRitmo(db, vendedoraId, new Date()));
  if (freno.frena) {
    res.status(429).json({
      ok: false,
      codigo: 'techo_de_ritmo',
      // El motivo dice CUÁNDO se destraba, no cualquiera de los dos techos que
      // esté pasado: con «60 por día» la vendedora se va a esperar hasta mañana
      // cuando lo que la libera es el próximo cambio de hora.
      motivo: freno.motivo,
      techo: freno.techo,
      usado: freno.usado,
      message:
        freno.motivo === 'techo_dia'
          ? `Llegaste al techo de correos del día (${freno.usado} de ${freno.techo}). Sigue mañana.`
          : `Llegaste al techo de correos de esta hora (${freno.usado} de ${freno.techo}). Se destraba al cambiar la hora.`,
    });
    return;
  }

  // ── 5. Con qué sobre sale ───────────────────────────────────────────────
  const pedido = cuerpoCrudo.remitenteId;
  let sobre: SobreDeCorreo;
  let firma: string | null = null;
  let remitenteId: number | null = null;

  if (pedido != null) {
    const id = idDeRuta(String(pedido));
    // `leerRemitente` filtra por `activo` y devuelve `null` para las dos cosas
    // —no existe, está retirado—, que es lo correcto para el envío. Acá se
    // distinguen sólo para explicar: «lo borraron» y «lo apagaron» se arreglan de
    // maneras distintas, y esa segunda consulta se paga sólo en el camino de error.
    const r = id === null ? null : await leerRemitente(db, id);
    if (!r) {
      const todos = await listarRemitentes(db, { incluirInactivos: true });
      const retirado = id !== null && todos.some((f) => f.id === id);
      res.status(retirado ? 409 : 404).json({
        ok: false,
        codigo: retirado ? 'remitente_retirado' : 'remitente_desconocido',
        message: retirado
          ? 'Ese remitente se retiró. Elegí otro de la lista: lo que ya salió por él no cambia.'
          : 'Ese remitente no existe. Refrescá la pantalla y elegí uno de la lista.',
      });
      return;
    }
    sobre = armarSobre(r, vendedoraId, nombreCortoDeVendedora(vendedoraId));
    firma = r.firma;
    remitenteId = r.id;
  } else {
    const activos = await listarRemitentes(db);
    if (activos.length > 0) {
      // ⚠️ No se elige uno «por defecto» acá. Con qué nombre sale un correo es una
      // decisión de quien escribe, y elegirla por ella la haría descubrir el
      // remitente equivocado recién en la respuesta del lead.
      res.status(400).json({
        ok: false,
        codigo: 'falta_remitente',
        message: 'Elegí con qué correo sale antes de mandar.',
      });
      return;
    }
    // El camino de compatibilidad: así funcionó Correos desde el 21-jul-2026, y
    // se conserva **por la ventana N4↔N5** — el front nuevo puede estar hablándole
    // a un server sin la migración 0029, y ahí no hay remitentes que elegir.
    const desde = buzonDeCompatibilidad();
    if (!desde) {
      res.status(503).json({
        ok: false,
        codigo: 'smtp_no_configurado',
        message:
          'No hay ningún remitente dado de alta y falta `SMTP_FROM` en el .env del server, así que no hay ' +
          'buzón por el que salir. Es un paso de sistemas.',
      });
      return;
    }
    // ⚠️ El `Reply-To` se calcula IGUAL que con remitente (D2): sin esto, en el
    // camino viejo la respuesta del lead volvería a caer en el buzón compartido
    // —el agujero que este frente vino a tapar— y encima la pantalla mostraría lo
    // contrario, porque `resumenDelSobre` del front sí lo pone en este caso.
    sobre = { from: desde, replyTo: correoDeVendedora(vendedoraId) };
  }

  // ── 6. El canal ─────────────────────────────────────────────────────────
  const smtp = transporte();
  if (!smtp) {
    res.status(503).json({
      ok: false,
      codigo: 'smtp_no_configurado',
      message:
        'El canal de correo no está conectado: faltan SMTP_HOST/SMTP_USER/SMTP_PASS en el .env del server ' +
        '(la cuenta es de Amazon SES, no de mail.goberna.us). Es un paso de sistemas, no algo que hayas hecho mal.',
    });
    return;
  }

  // Lo que se AUDITA es lo que SALE: el cuerpo va con la firma ya pegada, y el
  // `desde`/`responderA` se copian del sobre en vez de leerse del remitente por
  // join — un remitente se edita y se retira, y la pregunta que vale es con qué
  // salió ESE correo, no con qué saldría hoy (el criterio de `envios_wa`).
  const textoFinal = componerCuerpo(cuerpoTexto.trim(), firma);
  const fila = {
    vendedoraId,
    para: destinatario,
    asunto,
    cuerpo: textoFinal,
    // 🔴 La clave del hilo: sin ella el correo no aparece en ningún timeline ni en
    // ninguna medición. En producción las tres filas que existen la tienen en
    // `null`, o sea que hasta hoy un correo era un hecho suelto.
    clave: typeof cuerpoCrudo.clave === 'string' && cuerpoCrudo.clave.trim() !== ''
      ? cuerpoCrudo.clave.trim()
      : null,
    remitenteId,
    desde: sobre.from,
    responderA: sobre.replyTo,
  };

  // ── 7. Salir ────────────────────────────────────────────────────────────
  // 🔴 **El `try` envuelve SÓLO el envío, y ésa es la razón por la que el motivo
  // del proveedor puede llegar a la pantalla.** Antes un mismo `try` cubría el
  // `sendMail` Y el `INSERT`, así que el error podía ser el diálogo del SMTP o el
  // SQL entero de drizzle (`porQueFallo` lo documenta): por eso se contestaba un
  // texto genérico. Separados, acá adentro sólo puede caer lo que dijo SES — y eso
  // es lo ÚNICO que distingue «esa casilla no existe» de «se cayó un momento», dos
  // fallas que se arreglan al revés y que un mensaje genérico deja iguales.
  let idExterno: string | null = null;
  try {
    const info = await smtp.sendMail({
      from: sobre.from,
      to: destinatario,
      subject: asunto,
      text: textoFinal,
      ...(sobre.replyTo ? { replyTo: sobre.replyTo } : {}),
    });
    // ⚠️ **Tenerlo no significa que llegó: significa que SES aceptó el POST.** El
    // rebote, el buzón lleno y la queja de spam pasan después y sin webhook de
    // bounce no hay forma de enterarse. Sirve para una sola cosa y hay que usarlo
    // sólo para esa: cruzar esta fila contra los logs de SES.
    idExterno = typeof info?.messageId === 'string' ? info.messageId : null;
  } catch (err) {
    const motivo = porQueFallo(err);
    console.error(`el correo a ${destinatario} no salió — ${motivo}`);

    // ⚠️ La auditoría del fallido va en su propio `try`: un intento que no salió es
    // un dato, no un silencio, pero si además falla la escritura, lo que la
    // vendedora tiene que leer sigue siendo que **el correo no salió** — no un 500
    // sobre la base. Se pierde higiene, no la respuesta.
    try {
      await guardarCorreo(db, { ...fila, estado: 'fallido', motivo });
    } catch (e) {
      console.error(`tampoco se pudo auditar el correo fallido a ${destinatario} — ${porQueFallo(e)}`);
    }

    // 🔴 **NO TODO FALLO ES DEL DESTINATARIO, y hasta acá se contestaban todos
    // igual.** `clasificarRechazo` separa de quién es el problema, que es lo que
    // decide qué hacer:
    //
    //   · del MENSAJE   → se muestra el detalle de SES. Es lo único accionable
    //                     que hay («esa casilla no existe»), y aplanarlo le saca
    //                     a la vendedora la única pista que tenía.
    //   · de la CONFIG  → NO se muestra el diálogo SMTP y se dice que avise a
    //                     sistemas. 🔴 El caso que obliga: SES contesta **554**
    //                     cuando el `From` no está verificado, y un 554 en
    //                     cualquier otro servidor es un rechazo de destinatario.
    //                     Leído así, manda a corregir la caja que está bien —y
    //                     reintentar no puede funcionar nunca.
    //   · del CANAL     → es lo ÚNICO reintentable, y se dice.
    //
    // ⚠️ La columna `correos.motivo` guarda el `motivo` CRUDO igual: la auditoría
    // necesita el texto entero, y esa fila la lee el equipo, no un desconocido.
    const rechazo = clasificarRechazo(motivo);
    res.status(502).json({
      ok: false,
      codigo: 'envio_rechazado',
      clase: rechazo.clase,
      reintentable: rechazo.reintentable,
      message: rechazo.mensaje,
    });
    return;
  }

  // 🔴 **EL CORREO YA SALIÓ, ASÍ QUE ESTA ESCRITURA NO PUEDE CAMBIAR LA RESPUESTA.**
  //
  // Esto tuvo el `try` del lado equivocado durante una hora y vale dejar escrito por
  // qué: el camino de FALLO sí envolvía su `guardarCorreo` —donde reintentar es
  // inofensivo— y el de ÉXITO no. Como el handler está envuelto en `ruta()`, un hipo
  // de la base (un `ETIMEDOUT` de postgres.js, o `correos.remitente_id` que todavía
  // no existe porque N5 no corrió) se convertía en un **500 genérico sobre un correo
  // que el lead ya tiene en la bandeja**. Y un 500 en un composer significa una cosa
  // sola para quien lo mira: volver a apretar Enviar. Le llegan dos.
  //
  // La asimetría estaba exactamente al revés de donde duele. Ahora las dos ramas
  // atrapan, y ésta contesta que salió —que es la verdad— con el hueco en el log,
  // que es donde alguien lo puede buscar. **Se pierde la auditoría, no el correo ni
  // la certeza de quien lo mandó.**
  let id: number | null = null;
  try {
    id = (await guardarCorreo(db, { ...fila, estado: 'enviado', idExterno })).id;
  } catch (e) {
    console.error(
      `el correo a ${destinatario} SALIÓ y no se pudo auditar — ${porQueFallo(e)}` +
        (idExterno ? ` (messageId de SES: ${idExterno})` : ''),
    );
  }

  // ⚠️ **La respuesta NO devuelve la fila.** Es el mismo criterio que la lista: el
  // cuerpo no viaja si nadie lo pidió, y acá nadie lo pidió —la pantalla vacía el
  // composer y vuelve a pedir la lista—. El id alcanza para colgarlo de un timeline.
  // ⚠️ `id: null` es «salió y no se pudo anotar», no un error: el `ok: true` es sobre
  // el envío, que es lo único que la vendedora no puede deshacer.
  res.json({ ok: true, id });
}));
