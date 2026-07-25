import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { repartirAprobadas, type ParaAprobar } from '../autorespuesta/aprobar.js';
import { caducoSinAprobar, cuandoCaduca } from '../autorespuesta/caducidad.js';
import { configDesdeEnv, ventanasEfectivas } from '../autorespuesta/config.js';
import { diaLocal } from '../autorespuesta/franja.js';
import { MODOS, nombreDeModo, type ModoAutoRespuesta } from '../autorespuesta/modo.js';
import { faltaEsquema, repositorioDrizzle, type PendienteVista } from '../autorespuesta/repositorio.js';

/**
 * EL INTERRUPTOR, LA BANDEJA Y EL OK — la superficie de la auto-respuesta
 * (#125, ADR 0015 y 0016).
 *
 * El interruptor es, antes que nada, el kill-switch SIN DEPLOY: apagar tiene que
 * costar un click y cero minutos, no un `ssh` + `systemctl restart` (que además
 * le tira la sesión de Cerberus a cada vendedora logueada). Puede hacerlo
 * CUALQUIER vendedora: frenar una máquina que le escribe a sus clientes no es un
 * permiso que haya que pedir.
 *
 * Lo que agrega ADR 0016 es el punto del medio —**supervisada**— y con él tres
 * rutas más, que son las que la vendedora usa todos los días:
 *
 *   · `GET  /bandeja`   qué se le va a mandar a quién, agrupado por campaña;
 *   · `POST /aprobar`   el OK, de a uno o en lote, con el ritmo recalculado;
 *   · `POST /descartar` «esta no va», de a uno o todas.
 *
 * Todas detrás de `requiereVendedora`: aprobar un envío es atribuírselo a
 * alguien, y ese alguien sale del token, nunca del body.
 */
export const autorespuestaRouter = Router();

const cuerpoModo = z.object({
  modo: z.enum(MODOS),
  motivo: z.string().trim().max(300).optional(),
});

/** La ruta vieja (ADR 0015) sigue viva: booleano adentro, modo afuera. */
const cuerpoInterruptor = z.object({
  encendida: z.boolean(),
  motivo: z.string().trim().max(300).optional(),
});

/**
 * Un texto editado por la vendedora. El techo de 1.000 caracteres no es
 * decorativo: lo que sale por acá va a WhatsApp con la marca de automático, y un
 * muro de texto es la forma más rápida de que un número quede marcado.
 */
const cuerpoAprobar = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  /** `{ "12": "texto nuevo" }` — solo las que la vendedora tocó. */
  textos: z.record(z.string(), z.string().trim().min(1).max(1000)).optional(),
});

const cuerpoDescartar = z
  .object({
    ids: z.array(z.number().int().positive()).max(500).optional(),
    /** «Descartar todo»: lo que hoy espera aprobación, entero. */
    todas: z.boolean().optional(),
  })
  .refine((c) => c.todas === true || (c.ids?.length ?? 0) > 0, {
    message: 'mandá `ids` o `todas: true`',
  });

const SIN_TABLAS = 'faltan las tablas de la auto-respuesta: corré `npm run db:push` en el server (ADR 0015/0016).';

/** El estado completo: las dos llaves, los límites y lo que hay en cola hoy. */
autorespuestaRouter.get('/', requiereVendedora, async (_req, res) => {
  const cfg = configDesdeEnv();
  const repo = repositorioDrizzle(db);
  const dia = diaLocal(new Date(), cfg.zona);

  try {
    const [interruptor, pendientes, esperando] = await Promise.all([
      repo.leerInterruptor(),
      repo.listarDelDia(dia),
      repo.listarEsperandoAprobacion(),
    ]);
    res.json({
      habilitadaEnEntorno: cfg.habilitada,
      interruptor,
      modo: interruptor.modo,
      /** Solo manda algo si las DOS llaves están puestas. */
      activa: cfg.habilitada && interruptor.encendida,
      /** Cuántas esperan el OK de una persona. Es lo que anuncia el chip. */
      esperandoAprobacion: esperando.length,
      limites: {
        zona: cfg.zona,
        franja: cfg.franja,
        ventanaDespacho: cfg.ventanaDespacho,
        ventanasEfectivas: ventanasEfectivas(cfg),
        esperaMinutos: cfg.esperaMinutos,
        espaciadoSegundos: cfg.espaciadoSegundos,
        techoPorHora: cfg.techoPorHora,
        techoPorDia: cfg.techoPorDia,
        graciaAprobacionMinutos: cfg.graciaAprobacionMinutos,
      },
      dia,
      pendientes,
    });
  } catch (e) {
    if (!faltaEsquema(e)) throw e;
    // El `db:push` es manual (ver ADR 0015): sin las tablas, esto informa en vez
    // de reventar — y de paso dice exactamente qué falta.
    res.json({ habilitadaEnEntorno: cfg.habilitada, activa: false, sinTablas: true, mensaje: SIN_TABLAS });
  }
});

/**
 * LA BANDEJA DE REVISIÓN — lo que espera el OK, con lo mínimo para decidir en
 * dos minutos: quién, de qué campaña vino, cuánto hace que espera, qué se le
 * manda y hasta cuándo se puede aprobar.
 *
 * Lo que YA caducó no aparece: el barrido del despachador lo marca cada 30 s,
 * pero entre barrido y barrido puede haber una fila vencida, y ofrecerle a la
 * vendedora aprobar algo que el despachador va a tirar sería mentirle. El
 * veredicto lo da la misma función pura (`caducidad.ts`).
 */
autorespuestaRouter.get('/bandeja', requiereVendedora, async (_req, res) => {
  const cfg = configDesdeEnv();
  const ahora = new Date();

  try {
    const [interruptor, esperando] = await Promise.all([
      repositorioDrizzle(db).leerInterruptor(),
      repositorioDrizzle(db).listarEsperandoAprobacion(),
    ]);
    const vivas = esperando.filter((p) => !caducoSinAprobar(p.programadoPara, cfg, ahora).caduco);

    res.json({
      modo: interruptor.modo,
      ahora: ahora.toISOString(),
      total: vivas.length,
      grupos: agruparPorCampana(vivas, cfg, ahora),
    });
  } catch (e) {
    if (!faltaEsquema(e)) throw e;
    res.json({ modo: 'apagada', total: 0, grupos: [], sinTablas: true, mensaje: SIN_TABLAS });
  }
});

/**
 * EL OK — de a uno o en lote. Lo aprobado NO sale junto: se le vuelve a repartir
 * la hora con el ritmo de siempre (`aprobar.ts`), y lo que no entra vuelve con
 * su motivo en vez de apretarse.
 */
autorespuestaRouter.post('/aprobar', requiereVendedora, async (req, res) => {
  const parseo = cuerpoAprobar.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({ ok: false, message: 'mandá `{ ids: number[], textos?: { [id]: string } }`' });
    return;
  }

  const cfg = configDesdeEnv();
  const repo = repositorioDrizzle(db);
  const quien = req.vendedoraId!;
  const ahora = new Date();
  const { ids, textos } = parseo.data;

  try {
    const esperando = await repo.listarEsperandoAprobacion();
    const porId = new Map(esperando.map((p) => [p.id, p]));

    // Lo que caducó no se aprueba, aunque la pantalla todavía lo muestre: la
    // vendedora pudo haber dejado la bandeja abierta desde hace tres horas.
    const vivas: ParaAprobar[] = [];
    const rechazadas: { id: number; motivo: string }[] = [];
    // Sin `Set`, un id repetido en el body ocuparía DOS ranuras del ritmo para
    // un solo mensaje: el techo por hora contaría de más y alguien real se
    // quedaría afuera.
    for (const id of new Set(ids)) {
      const p = porId.get(id);
      if (!p) {
        rechazadas.push({ id, motivo: 'ya no está esperando aprobación (la aprobó o descartó alguien más)' });
        continue;
      }
      const c = caducoSinAprobar(p.programadoPara, cfg, ahora);
      if (c.caduco) {
        rechazadas.push({ id, motivo: c.motivo });
        continue;
      }
      vivas.push({ ...p, texto: textos?.[String(id)]?.trim() || p.texto });
    }

    const ocupadas = await repo.ocupacionDesde(diaLocal(ahora, cfg.zona));
    const reparto = repartirAprobadas(vivas, cfg, ahora, Math.random, ocupadas);

    let aprobadas = 0;
    for (const a of reparto.aprobadas) {
      const original = porId.get(a.id)!;
      const nuevo = textos?.[String(a.id)]?.trim();
      const ok = await repo.aprobar({
        id: a.id,
        programadoPara: a.programadoPara,
        texto: nuevo && nuevo !== original.texto ? nuevo : undefined,
        quien,
        ahora,
      });
      if (ok) aprobadas++;
      else rechazadas.push({ id: a.id, motivo: 'otra vendedora la tomó primero' });
    }

    res.json({
      ok: true,
      aprobadas,
      /** Con hora, para poder decir «salen entre las 08:00 y las 09:12». */
      programadas: reparto.aprobadas.map((a) => ({ id: a.id, programadoPara: a.programadoPara.toISOString() })),
      noEntran: [...reparto.noEntran, ...rechazadas],
    });
  } catch (e) {
    if (!faltaEsquema(e)) throw e;
    res.status(503).json({ ok: false, message: SIN_TABLAS });
  }
});

/** «Esta no va» — de a una o todas. Es una decisión humana y queda con su nombre. */
autorespuestaRouter.post('/descartar', requiereVendedora, async (req, res) => {
  const parseo = cuerpoDescartar.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({ ok: false, message: 'mandá `{ ids: number[] }` o `{ todas: true }`' });
    return;
  }

  const repo = repositorioDrizzle(db);
  const quien = req.vendedoraId!;

  try {
    const ids = parseo.data.todas
      ? (await repo.listarEsperandoAprobacion()).map((p) => p.id)
      : (parseo.data.ids ?? []);
    const descartadas = await repo.descartar(ids, quien, 'la descartó la vendedora');
    res.json({ ok: true, descartadas });
  } catch (e) {
    if (!faltaEsquema(e)) throw e;
    res.status(503).json({ ok: false, message: SIN_TABLAS });
  }
});

/** Cambiar de modo: apagada · supervisada · automática. */
autorespuestaRouter.put('/modo', requiereVendedora, async (req, res) => {
  const parseo = cuerpoModo.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({ ok: false, message: 'mandá `{ modo: "apagada" | "supervisada" | "automatica" }`' });
    return;
  }
  await fijar(req.vendedoraId!, parseo.data.modo, parseo.data.motivo, res);
});

/**
 * La ruta de ADR 0015, intacta por fuera: `{ encendida: boolean }`. Prender por
 * acá deja el modo AUTOMÁTICO, que es lo que ese booleano siempre quiso decir.
 * Sigue viva porque es el kill-switch que alguien puede tener a mano en un
 * `curl` de emergencia, y romperlo el día que se necesite sería el peor momento.
 */
autorespuestaRouter.put('/interruptor', requiereVendedora, async (req, res) => {
  const parseo = cuerpoInterruptor.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({ ok: false, message: 'mandá `{ encendida: boolean, motivo?: string }`' });
    return;
  }
  await fijar(req.vendedoraId!, parseo.data.encendida ? 'automatica' : 'apagada', parseo.data.motivo, res);
});

async function fijar(
  quien: string,
  modo: ModoAutoRespuesta,
  motivo: string | undefined,
  res: Parameters<Parameters<typeof autorespuestaRouter.put>[1]>[1],
): Promise<void> {
  const cfg = configDesdeEnv();
  try {
    const estado = await repositorioDrizzle(db).fijarModo(
      modo,
      motivo?.trim() ||
        (modo === 'apagada' ? `la apagó ${quien}` : `${quien} la puso en ${nombreDeModo(modo)}`),
      quien,
    );
    res.json({
      ok: true,
      interruptor: estado,
      modo: estado.modo,
      activa: cfg.habilitada && estado.encendida,
      // Honestidad: prender acá con la llave de entorno apagada no manda nada.
      aviso:
        estado.encendida && !cfg.habilitada
          ? 'el interruptor quedó encendido, pero `AUTO_RESPUESTA` no está en `on` en el server: no se manda nada'
          : undefined,
    });
  } catch (e) {
    if (!faltaEsquema(e)) throw e;
    res.status(503).json({ ok: false, message: SIN_TABLAS });
  }
}

/**
 * AGRUPADO POR CAMPAÑA — porque es como se decide. «Los 12 de Inteligencia» se
 * aprueban de un vistazo: mismo texto, misma promesa, misma gente. Una lista
 * plana de 40 obligaría a leer 40 veces el mismo mensaje.
 */
function agruparPorCampana(
  filas: readonly PendienteVista[],
  cfg: ReturnType<typeof configDesdeEnv>,
  ahora: Date,
) {
  const grupos = new Map<string, ReturnType<typeof aFila>[]>();
  for (const f of filas) {
    const clave = f.campana ?? 'Sin campaña';
    const lista = grupos.get(clave) ?? [];
    lista.push(aFila(f, cfg, ahora));
    grupos.set(clave, lista);
  }
  return [...grupos.entries()]
    .map(([campana, mensajes]) => ({
      campana,
      /** El texto se repite en todo el grupo salvo donde la editaron: se manda una vez. */
      plantillaId: mensajes[0]?.plantillaId ?? null,
      mensajes,
    }))
    // El grupo más grande primero: es donde un click hace más trabajo.
    .sort((a, b) => b.mensajes.length - a.mensajes.length || a.campana.localeCompare(b.campana));
}

function aFila(f: PendienteVista, cfg: ReturnType<typeof configDesdeEnv>, ahora: Date) {
  return {
    id: f.id,
    clave: f.clave,
    telefono: f.telefono,
    personaNombre: f.personaNombre,
    plantillaId: f.plantillaId,
    texto: f.texto,
    campana: f.campana,
    editada: f.editada,
    /** Cuándo escribió la persona. El front dice «hace 6 h» con esto. */
    disparadaPor: f.disparadaPor.toISOString(),
    /** La hora que tenía reservada, si nadie la aprueba antes. */
    programadoPara: f.programadoPara.toISOString(),
    /** Hasta cuándo se puede aprobar. Es lo que hace la bandeja urgente sin mentir. */
    caducaEn: cuandoCaduca(f.programadoPara, cfg).toISOString(),
    /** Minutos que la persona lleva esperando. Se calcula acá para no depender del reloj del cliente. */
    esperandoMinutos: Math.max(0, Math.round((ahora.getTime() - f.disparadaPor.getTime()) / 60_000)),
  };
}
