import { Router } from 'express';
import { detectarOrigen } from '../whatsapp/origen.js';
import { resolverAnuncio } from '../meta/anuncio.js';
import { proyectarMensaje } from '../whatsapp/proyectar.js';
import { repositorioDrizzle } from '../whatsapp/repositorioDrizzle.js';
import { ruta } from '../lib/ruta.js';
import type { MensajeWhatsapp } from '../whatsapp/transporte.js';

/**
 * SIMULAR LA DETECCIÓN DEL ORIGEN DE UN LEAD — sin depender de un anuncio real.
 *
 * Construye el mismo proto crudo que WhatsApp mandaría en un click-to-WhatsApp (o
 * el texto de una landing), lo pasa por la MISMA detección que corre en vivo, lo
 * enriquece con la Graph API, y lo persiste como un lead más en la cola. Sirve
 * para probar toda la cadena de atribución antes de tener tráfico real de un
 * anuncio.
 *
 * Es una herramienta de dev: se monta solo fuera de producción.
 */
export const simularRouter = Router();

function nuevoId(): string {
  return `sim-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

async function persistir(m: MensajeWhatsapp): Promise<void> {
  const proy = proyectarMensaje(m);
  if ('evento' in proy) await repositorioDrizzle.persistir(proy.evento, proy.interaccion);
}

/** Simula un lead que vino de un ANUNCIO (Click-to-WhatsApp). */
simularRouter.post('/anuncio', ruta(async (req, res) => {
  const { telefono, texto, adId, ctwaClid, nombre } = req.body ?? {};
  if (!telefono || !texto || !adId) {
    res.status(400).json({ ok: false, message: 'faltan telefono, texto o adId' });
    return;
  }
  const numeroPropio = process.env.WHATSAPP_NUMERO ?? '51987654321';

  // El proto tal como lo arma WhatsApp cuando la persona tocó "Enviar mensaje"
  // en un anuncio.
  const message = {
    extendedTextMessage: {
      text: String(texto),
      contextInfo: {
        externalAdReply: {
          sourceType: 'ad',
          sourceId: String(adId),
          ctwaClid: ctwaClid ? String(ctwaClid) : null,
          title: 'anuncio',
        },
      },
    },
  };

  const origen = detectarOrigen(message, String(texto));
  const anuncio = origen?.fuente === 'anuncio' ? await resolverAnuncio(origen.adId) : null;

  await persistir({
    idExterno: nuevoId(),
    numeroPropio,
    telefono: String(telefono).replace(/\D/g, ''),
    esMio: false,
    esGrupo: false,
    ocurridoEn: new Date(),
    nombreVisible: nombre ? String(nombre) : null,
    texto: String(texto),
    clase: 'texto',
    origen,
  });

  res.json({ ok: true, origen, anuncio });
}));

/** Simula un lead que vino de una LANDING (código entre corchetes en el texto). */
simularRouter.post('/landing', ruta(async (req, res) => {
  const { telefono, texto, nombre } = req.body ?? {};
  if (!telefono || !texto) {
    res.status(400).json({ ok: false, message: 'faltan telefono o texto' });
    return;
  }
  const numeroPropio = process.env.WHATSAPP_NUMERO ?? '51987654321';
  const origen = detectarOrigen({ conversation: String(texto) }, String(texto));

  await persistir({
    idExterno: nuevoId(),
    numeroPropio,
    telefono: String(telefono).replace(/\D/g, ''),
    esMio: false,
    esGrupo: false,
    ocurridoEn: new Date(),
    nombreVisible: nombre ? String(nombre) : null,
    texto: String(texto),
    clase: 'texto',
    origen,
  });

  res.json({ ok: true, origen });
}));
