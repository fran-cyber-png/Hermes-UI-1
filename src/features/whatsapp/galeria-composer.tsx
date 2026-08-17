import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../../dominio/conversaciones';
import '../../index.css';

/**
 * EL COMPOSER REAL, SIN SERVER NI BASE — para ver ⌘V con un portapapeles de verdad.
 *
 *     npx vite --port 5199  →  http://localhost:5199/galeria-composer.html
 *
 * Monta `HiloWhatsapp` TAL CUAL lo usa la app (no una maqueta: la galería de
 * `galeria-mensajes-completa` es un dibujo y no sirve para probar un handler).
 * Lo único falso es el `fetch`, pisado acá abajo — así el ⌘V que se prueba es
 * el del navegador, con su `DataTransfer` real, y no un evento sintético.
 *
 * `?revision=1` abre el modo revisión, donde pegar un adjunto se rechaza.
 *
 * ⚠️ **Los tres casos de cita que hay abajo NO son decoración.** En este repo una
 * galería con el caso ideal ya escondió tres defectos (radar de leads, 8-ago), así
 * que acá están el bonito Y los dos feos: la cita a un mensaje que Hermes no tiene
 * (el hueco honesto) y la cita a un adjunto sin texto. Los dos van a ser lo NORMAL
 * las primeras semanas del frente, porque la captura empieza de hoy en adelante.
 */

const TELEFONO = '51987654321';
const NUMERO_PROPIO = '51984429504';

const HACE = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const MENSAJES = [
  { id: 1, direccion: 'entrante', autor: TELEFONO, texto: 'Hola, buenas tardes 👋', occurred_at: HACE(94), external_id: 'e1' },
  { id: 2, direccion: 'entrante', autor: TELEFONO, texto: '¿El diploma de Gestión Pública sigue abierto?', occurred_at: HACE(93), external_id: 'e2' },
  {
    id: 3,
    direccion: 'saliente',
    autor: 'luz',
    texto: '¡Hola Javier! Sí, todavía hay cupos. Te paso el temario.',
    occurred_at: HACE(41),
    external_id: 'e3',
    // Lo que hasta hoy se descartaba: el lead reaccionó y nadie lo veía.
    reacciones: [{ emoji: '👍', nuestra: false }],
    entrega: 'leido',
  },
  { id: 4, direccion: 'entrante', autor: TELEFONO, texto: '¿Me pasás el precio y las formas de pago?', occurred_at: HACE(9), external_id: 'e4',
    // Una reacción NUESTRA se ve distinta: delineada en navy.
    reacciones: [{ emoji: '❤️', nuestra: true }] },
  { id: 5, direccion: 'entrante', autor: TELEFONO, texto: 'Perfecto, gracias', occurred_at: HACE(6), external_id: 'e5',
    reacciones: [{ emoji: '🙌', nuestra: false }, { emoji: '🙌', nuestra: true }] },
  // Los cuatro estados, para poder mirarlos juntos.
  { id: 6, direccion: 'saliente', autor: 'luz', texto: 'Te dejo el link de pago', occurred_at: HACE(4), external_id: 'e6', entrega: 'entregado' },
  { id: 7, direccion: 'saliente', autor: 'luz', texto: '¿Lo pudiste abrir?', occurred_at: HACE(3), external_id: 'e7', entrega: 'enviado' },
  // ── LOS TRES FALLIDOS, y los tres se leen distinto a propósito ─────────
  // 1 · EL CASO MEDIDO (17-ago-2026): la ventana de 24 h, con el texto REAL que
  //     rebotó. Es el único motivo que apareció en envíos manuales.
  { id: 8, direccion: 'saliente', autor: 'luz', texto: 'Buenas tardes señor Ronald. ¿Aun te encuentras interesado en inscribirte en el foro?', occurred_at: HACE(2), external_id: 'e8', entrega: 'fallido', entregaMotivo: '131047' },
  // 2 · UN CÓDIGO QUE NO ESTÁ EN EL DICCIONARIO: no se inventa una explicación.
  //     El crudo va al hover, que es de donde sale para poder agregarlo.
  { id: 81, direccion: 'saliente', autor: 'luz', texto: 'Te reenvío el comprobante', occurred_at: HACE(2), external_id: 'e81', entrega: 'fallido', entregaMotivo: '133010' },
  // 3 · UN FALLO SIN CÓDIGO: todo lo anterior a la migración 0028 — o sea, lo
  //     mayoritario las primeras semanas. Se comporta como antes del frente.
  { id: 82, direccion: 'saliente', autor: 'luz', texto: 'Quedo atenta a tu respuesta', occurred_at: HACE(2), external_id: 'e82', entrega: 'fallido' },
  // Un mensaje viejo, de antes de este frente: SIN estado. No dibuja nada.
  { id: 9, direccion: 'saliente', autor: 'luz', texto: 'Cualquier cosa me escribís', occurred_at: HACE(1), external_id: 'e9' },

  // ── LAS TRES CITAS, y dos son el caso feo ──────────────────────────────
  // 1 · El caso bonito: responde a un mensaje que Hermes tiene entero.
  {
    id: 10,
    direccion: 'entrante',
    autor: TELEFONO,
    texto: '¿Esas dos cuotas son sin interés?',
    occurred_at: HACE(1),
    external_id: 'e10',
    cita: {
      mensajeExternalId: 'e3',
      texto: '¡Hola Javier! Sí, todavía hay cupos. Te paso el temario.',
      direccion: 'saliente',
      mediaClase: null,
    },
  },
  // 2 · EL HUECO HONESTO: la cita apunta a algo anterior a la captura. Ni autor
  //     ni texto — y el mensaje se dibuja igual, con su tirita puesta.
  {
    id: 11,
    direccion: 'entrante',
    autor: TELEFONO,
    texto: 'me refería a esto que me mandaron la semana pasada',
    occurred_at: HACE(1),
    external_id: 'e11',
    cita: { mensajeExternalId: 'wa:DE_ANTES', texto: null, direccion: null, mediaClase: null },
  },
  // 3 · Una cita a un ADJUNTO sin texto: se nombra por lo que es.
  {
    id: 12,
    direccion: 'saliente',
    autor: 'luz',
    texto: 'Ese es el flyer de la edición de agosto',
    occurred_at: HACE(1),
    external_id: 'e12',
    cita: { mensajeExternalId: 'e0', texto: null, direccion: 'entrante', mediaClase: 'imagen' },
  },
];

/**
 * LA VENTANA DE 24 H, para ver el aviso de arriba de la caja (ADR 0058).
 *
 * `?ventana=cerrada` es el caso que costó dos mensajes el 16-ago-2026;
 * `?ventana=porcerrar` es el que los habría salvado. Sin el parámetro la ventana
 * está holgada y **no se dibuja nada**, que es el estado normal — un aviso
 * permanente dejaría de leerse a la semana.
 *
 * ⚠️ El aviso solo sale en `cloud-api`: con `?whatsmeow=1` desaparece aunque la
 * ventana esté vencida, porque ahí Meta no rechaza nada. Es el veto de ADR 0041
 * y se puede comprobar combinando los dos parámetros.
 */
const HORA_MS = 60 * 60 * 1000;
const VENTANA = new URLSearchParams(location.search).get('ventana');
const VENTANA_CIERRA = new Date(
  Date.now() + (VENTANA === 'cerrada' ? -4 * HORA_MS : VENTANA === 'porcerrar' ? 1.5 * HORA_MS : 18 * HORA_MS),
).toISOString();

const CONVERSACION = {
  clave: `conv:whatsapp:${TELEFONO}:${NUMERO_PROPIO}`,
  ventana_cierra: VENTANA_CIERRA,
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: TELEFONO,
  persona_nombre: 'Javier Quispe',
  numero_propio: NUMERO_PROPIO,
  texto: '¿Me pasás el temario y el precio?',
  contexto_texto: null,
  respondida: false,
  ventana_abierta: true,
  pregunto: true,
  n: 4,
  referencia: 'r1',
  ultimo_at: HACE(6),
  dias: 0,
  nivel: 0,
} as Conversacion;

const MB = 1024 * 1024;
const whatsmeow = new URLSearchParams(location.search).has('whatsmeow');

/** Todo endpoint contesta lo mínimo; el envío responde OK pero no persiste nada. */
window.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  if (String(entrada).includes('/reaccionar')) console.info('[galeria] reaccionar →', String(init?.body ?? ''));
  const url = String(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

  if (url.includes('/api/whatsapp/sesion'))
    return json({
      estado: 'conectado',
      telefono: NUMERO_PROPIO,
      // La línea del bot es Cloud API: los topes de Meta. `?whatsmeow=1` la
      // cambia por una línea de vendedora, donde el mismo video sí entra.
      transporte: whatsmeow ? 'whatsmeow' : 'cloud-api',
      limitesMedia: whatsmeow
        ? undefined
        : { imagen: 5 * MB, video: 16 * MB, audio: 16 * MB, documento: 64 * MB },
    });
  if (url.includes('/api/whatsapp/conversacion/'))
    return json({ telefono: TELEFONO, mensajes: MENSAJES, origen: { fuente: 'anuncio', anuncio: 'Diploma Gestión Pública — julio', campana: 'GP-2026' } });
  if (url.includes('/api/whatsapp/reaccionar')) {
    // Se loguea para poder verificar desde afuera que la reacción SALE: la
    // galería pisa `window.fetch`, así que no hay request de red que espiar.
    console.info('[galeria] POST /reaccionar', typeof entrada === 'object' && 'body' in entrada ? '' : '');
    return json({ ok: true, quitada: false });
  }
  // Las RESPUESTAS RÁPIDAS del `/`. Son los datos recomendados de verdad: estas
  // frases y estas claves salieron del catálogo de producción, no de un ejemplo
  // lindo — una galería con el caso ideal ya escondió tres defectos.
  if (url.includes('/api/hechos/catalogo'))
    return json({
      editable: true,
      origen: 'tabla',
      hechos: [
        { clave: 'cuotas', rotulo: 'Dos cuotas', texto: 'Se puede pagar en dos cuotas sin interés: la primera reserva tu lugar.', momentos: [], orden: 1, activo: true },
        { clave: 'acceso-un-anio', rotulo: 'Acceso un año', texto: 'El acceso a la plataforma lo tenés por todo un año desde que arranca.', momentos: [], orden: 2, activo: true },
        { clave: 'publico-general', rotulo: 'Para público general', texto: 'Es para público general: no se pide carrera ni experiencia previa.', momentos: [], orden: 3, activo: true },
        { clave: 'certifica', rotulo: 'Quién certifica', texto: 'Certifica la Escuela de Gobierno de Goberna, con registro.', momentos: [], orden: 4, activo: true },
        { clave: 'yape', rotulo: 'Pago con Yape', texto: 'Podés pagar con Yape al 986 394 450 a nombre de Goberna.', momentos: [], orden: 5, activo: true },
      ],
    });
  if (url.includes('/api/whatsapp/enviar')) return json({ ok: true, idExterno: 'wa:galeria' });
  return json({}, 404);
}) as typeof fetch;

const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const enRevision = new URLSearchParams(location.search).has('revision');

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <div className="mx-auto h-screen w-full max-w-3xl px-6 py-6">
        <HiloWhatsapp
          conversacion={CONVERSACION}
          sugerencia={
            enRevision
              ? {
                  id: 7,
                  texto: 'Hola Javier, gracias por escribirnos. Te comparto el temario del diploma.',
                  campana: 'Gestión Pública',
                  paso: { actual: 3, total: 12 },
                  trabajando: false,
                  onAprobar: () => {},
                  onDescartar: () => {},
                }
              : undefined
          }
        />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
