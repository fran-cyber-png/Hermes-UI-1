import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../canales/conversaciones';
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
  },
  { id: 4, direccion: 'entrante', autor: TELEFONO, texto: '¿Me pasás el precio y las formas de pago?', occurred_at: HACE(9), external_id: 'e4',
    // Una reacción NUESTRA se ve distinta: delineada en navy.
    reacciones: [{ emoji: '❤️', nuestra: true }] },
  { id: 5, direccion: 'entrante', autor: TELEFONO, texto: 'Perfecto, gracias', occurred_at: HACE(6), external_id: 'e5',
    reacciones: [{ emoji: '🙌', nuestra: false }, { emoji: '🙌', nuestra: true }] },
];

const CONVERSACION = {
  clave: `conv:whatsapp:${TELEFONO}:${NUMERO_PROPIO}`,
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: TELEFONO,
  persona_nombre: 'Javier Quispe',
  numero_propio: NUMERO_PROPIO,
  texto: '¿Me pasás el temario y el precio?',
  contexto_texto: null,
  respondida: false,
  ventana_abierta: true,
  pide_info: true,
  n: 4,
  referencia: 'r1',
  ultimo_at: HACE(6),
  dias: 0,
  nivel: 0,
} as Conversacion;

const MB = 1024 * 1024;
const whatsmeow = new URLSearchParams(location.search).has('whatsmeow');

/** Todo endpoint contesta lo mínimo; el envío responde OK pero no persiste nada. */
window.fetch = (async (entrada: RequestInfo | URL) => {
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
