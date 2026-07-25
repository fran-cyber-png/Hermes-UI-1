import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { configDesdeEnv, ventanasEfectivas } from '../autorespuesta/config.js';
import { diaLocal } from '../autorespuesta/franja.js';
import { repositorioDrizzle } from '../autorespuesta/repositorio.js';
import { esTablaAusente } from '../cola/estadoSql.js';

/**
 * EL INTERRUPTOR Y LA FOTO — el kill-switch SIN DEPLOY de la auto-respuesta
 * (#125, ADR 0015).
 *
 * Es la respuesta a «¿y si se va de las manos?»: apagar tiene que costar un
 * click y cero minutos, no un `ssh` + `systemctl restart` (que además le tira la
 * sesión de Cerberus a cada vendedora logueada). Apagar puede hacerlo CUALQUIER
 * vendedora: frenar una máquina que le escribe a sus clientes no es un permiso
 * que haya que pedir.
 *
 * Prender exige además la otra llave (`AUTO_RESPUESTA=on` en el entorno), que sí
 * es de deploy. Con la de entorno apagada, esto deja prender el interruptor pero
 * no pasa nada — y la respuesta lo dice con todas las letras.
 */
export const autorespuestaRouter = Router();

const cuerpoInterruptor = z.object({
  encendida: z.boolean(),
  motivo: z.string().trim().max(300).optional(),
});

/** El estado completo: las dos llaves, los límites y lo que hay en cola hoy. */
autorespuestaRouter.get('/', requiereVendedora, async (_req, res) => {
  const cfg = configDesdeEnv();
  const repo = repositorioDrizzle(db);
  const dia = diaLocal(new Date(), cfg.zona);

  try {
    const [interruptor, pendientes] = await Promise.all([repo.leerInterruptor(), repo.listarDelDia(dia)]);
    res.json({
      habilitadaEnEntorno: cfg.habilitada,
      interruptor,
      /** Solo manda algo si las DOS llaves están puestas. */
      activa: cfg.habilitada && interruptor.encendida,
      limites: {
        zona: cfg.zona,
        franja: cfg.franja,
        ventanaDespacho: cfg.ventanaDespacho,
        ventanasEfectivas: ventanasEfectivas(cfg),
        esperaMinutos: cfg.esperaMinutos,
        espaciadoSegundos: cfg.espaciadoSegundos,
        techoPorHora: cfg.techoPorHora,
        techoPorDia: cfg.techoPorDia,
      },
      dia,
      pendientes,
    });
  } catch (e) {
    if (!esTablaAusente(e)) throw e;
    // El `db:push` es manual (ver ADR 0015): sin las tablas, esto informa en vez
    // de reventar — y de paso dice exactamente qué falta.
    res.json({
      habilitadaEnEntorno: cfg.habilitada,
      activa: false,
      sinTablas: true,
      mensaje: 'faltan las tablas de la auto-respuesta: corré `npm run db:push` en el server (ADR 0015).',
    });
  }
});

/** Prender o —lo que importa— APAGAR, sin deploy y sin restart. */
autorespuestaRouter.put('/interruptor', requiereVendedora, async (req, res) => {
  const parseo = cuerpoInterruptor.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({ ok: false, message: 'mandá `{ encendida: boolean, motivo?: string }`' });
    return;
  }

  const { encendida, motivo } = parseo.data;
  const quien = req.vendedoraId!;
  const cfg = configDesdeEnv();

  try {
    const estado = await repositorioDrizzle(db).fijarInterruptor(
      encendida,
      motivo?.trim() || (encendida ? `la encendió ${quien}` : `la apagó ${quien}`),
      quien,
    );
    res.json({
      ok: true,
      interruptor: estado,
      activa: cfg.habilitada && estado.encendida,
      // Honestidad: prender acá con la llave de entorno apagada no manda nada.
      aviso:
        encendida && !cfg.habilitada
          ? 'el interruptor quedó encendido, pero `AUTO_RESPUESTA` no está en `on` en el server: no se manda nada'
          : undefined,
    });
  } catch (e) {
    if (!esTablaAusente(e)) throw e;
    res.status(503).json({
      ok: false,
      message: 'faltan las tablas de la auto-respuesta: corré `npm run db:push` en el server (ADR 0015).',
    });
  }
});
