import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { queryClient } from '../../lib/datos/cliente';
import { Avisos } from '../../components/Avisos';
import type { Conversacion } from '../../dominio/conversaciones';
import { BarraGestion } from './BarraGestion';
import { ProximoSeguimiento } from '../agenda/ProximoSeguimiento';

/**
 * LA GALERÍA DE LAS ACCIONES DEL CHAT — la evidencia, sin server ni base.
 *
 *     npx vite --port 5199  →  http://localhost:5199/galeria-chat.html
 *
 * Existe por la regla dura #2 (nada de UI se reporta listo sin captura) y por
 * una razón práctica: el frente entero se puede MIRAR sin Postgres, que es
 * exactamente lo que no hay en una máquina de desarrollo recién clonada.
 *
 *  - sin params — un lead nuevo: la barra con `+ Registrar contacto`.
 *  - `?registrado=1` — el contacto ya registrado (el botón muestra el nombre) y
 *    su próximo seguimiento arriba del hilo.
 *  - `?ficha=1` — el drawer del registro rápido, con el prellenado que sale del
 *    alias de WhatsApp «Jorge Martin - JM RUSH AUTOMOTRIZ».
 *  - `?vencido=1` — el mismo seguimiento, pero pasado de hora: el banner grita.
 *
 * ⚠️ Los datos son fixture y se apoyan en el reloj de la máquina, como en la
 * galería de la agenda: la foto tiene que mostrar el caso feo, no el ideal.
 */

const params = new URLSearchParams(location.search);
const registrado = params.has('registrado') || params.has('vencido');
const vencido = params.has('vencido');

const CLAVE = 'conv:whatsapp:51984429504:51955950559';

const CONVERSACION: Conversacion = {
  clave: CLAVE,
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: '51955950559',
  persona_nombre: 'Jorge Martin - JM RUSH AUTOMOTRIZ',
  numero_propio: '51984429504',
  texto: 'Gracias por comunicarte con JM RUSH AUTOMOTRIZ, en qué te podemos ayudar ?',
  contexto_texto: null,
  respondida: true,
  ventana_abierta: true,
  pregunto: false,
  n: 3,
  referencia: new Date().toISOString(),
  ultimo_at: new Date().toISOString(),
  dias: 0,
  nivel: 2,
};

const cuando = new Date();
cuando.setHours(cuando.getHours() + (vencido ? -3 : 18), 0, 0, 0);

/**
 * El server, de mentira. Se stubea `fetch` y no se siembra el caché por lo
 * mismo que en la galería de la agenda: la agenda repregunta sola cada minuto y
 * un refetch fallido pondría la pantalla en error justo al sacar la foto.
 */
const original = globalThis.fetch;
globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url);
  const responder = (cuerpo: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

  if (u.includes('/api/contactos/registro')) {
    return responder({
      ficha: registrado
        ? {
            clave: CLAVE,
            telefono: '51955950559',
            nombre: 'Jorge',
            apellido: 'Martin',
            empresa: 'JM Rush Automotriz',
            email: 'jorge@jmrush.pe',
            prioridad: 'alta',
            vendedoraId: 'luz',
            creadoAt: new Date().toISOString(),
            actualizadoAt: new Date().toISOString(),
          }
        : null,
    });
  }
  if (u.includes('/api/agenda')) {
    return responder({
      recordatorios: registrado
        ? [
            {
              id: 1,
              clave: CLAVE,
              canal: 'whatsapp',
              personaId: '51955950559',
              personaNombre: 'Jorge Martin',
              numeroPropio: '51984429504',
              nota: 'Llamar a Jorge por el Foro de Estado',
              cuando: cuando.toISOString(),
              tipo: 'llamada',
              estado: 'pendiente',
              importancia: 'alta',
            },
          ]
        : [],
    });
  }
  if (u.includes('/api/gestiones/de/')) return responder({ etapa: registrado ? 'cotizado' : 'interesado' });
  if (u.includes('/api/gestiones/etiquetas')) {
    return responder({ etiquetas: registrado ? { [CLAVE]: ['VIP', 'Consultor Político'] } : {} });
  }
  if (u.includes('/api/categorias')) {
    return responder({
      categorias: [
        { id: 1, nombre: 'VIP', color: 'dorado' },
        { id: 2, nombre: 'Consultor Político', color: 'azul' },
        { id: 3, nombre: 'Pidió precio', color: 'verde' },
      ],
    });
  }
  if (u.includes('/api/intereses')) {
    return responder({ lista: registrado ? [{ curso: 'Foro de Estado Perú 2026', creadoAt: new Date().toISOString() }] : [] });
  }
  if (u.includes('/api/contactos/ficha')) return responder({ estado: 'nuevo' });
  if (u.includes('/api/contactos/lead')) return responder({ lead: null });
  if (u.includes('/api/whatsapp/sesion')) {
    return responder({ estado: 'conectado', telefono: '51984429504', transporte: 'cloud-api' });
  }
  return original(url, init);
}) as typeof fetch;

/**
 * El clic que la captura no puede dar: Chrome headless no interactúa, así que
 * la galería abre el drawer por la MISMA puerta que la vendedora —el botón—, no
 * por un atajo que se saltee el componente.
 */
if (params.has('ficha')) {
  setTimeout(() => {
    const boton = [...document.querySelectorAll('button')].find((b) =>
      /Registrar contacto|Jorge/.test(b.textContent ?? ''),
    );
    boton?.click();
  }, 400);
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen flex-col gap-2 bg-background p-4">
        <BarraGestion conversacion={CONVERSACION} miVendedora="luz" />
        <ProximoSeguimiento clave={CLAVE} />
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl bg-card text-xs text-muted-foreground shadow-panel">
          (acá va el hilo de la conversación)
        </div>
        <Avisos />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
