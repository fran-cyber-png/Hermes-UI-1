import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { VistaEmbudo } from './VistaEmbudo';

/**
 * LA GALERÍA DEL PIPELINE — la evidencia de la ficha al costado, sin server ni base.
 *
 * Entry APARTE de Vite (`galeria-embudo.html` en la raíz): **no entra al bundle
 * de la app** —`vite build` toma solo `index.html`— y no habla con ningún server.
 *
 *     npx vite --port 5199 → http://localhost:5199/galeria-embudo.html
 *     …/galeria-embudo.html?ficha=1 → con la hoja de la ficha abierta
 *
 * Existe por la regla dura #2, y sobre todo para poder mirar UNA cosa a
 * 1280×720: el `GRID` del tablero declara mínimos que suman **1.000 px** y la
 * hoja se lleva 360. Ése es el ancho donde se decide si la hoja podía empujar
 * las columnas o tenía que superponerse — y la captura es la única forma de
 * verificar que la respuesta elegida no rompe el tablero.
 */

const PARAMS = new URLSearchParams(location.search);

/** Las columnas, con la forma real de producción: casi todo vive en Contactados. */
const POR_ETAPA: Record<string, number> = { contactado: 1389, cotizado: 611, cierre: 12, perdido: 47 };

const NOMBRES = [
  ['Javier Peralta Ríos', 'Diplomado en Gestión Pública', true],
  ['Ana Lucía Quispe Mamani', 'Inteligencia y Contrainteligencia', true],
  ['Roberto Carlos Medina', null, false],
  ['María Fernanda Toledo', 'Foro de Estado', true],
  ['Luis Alberto Chávez Rojas', null, false],
  ['Carmen Rosa Huamán', 'Escuela de Gobierno', true],
  ['Jorge Enrique Salazar', null, false],
  ['Patricia Elena Vargas', 'Diplomado en Gestión Pública', true],
] as const;

/** Cada columna arranca en otro bloque de números: ver abajo por qué importa. */
const DESDE: Record<string, number> = { contactado: 0, cotizado: 100, cierre: 200, perdido: 300 };

/** Una tarjeta con la forma que sirve la cola (`/api/conversaciones`). */
function tarjetas(etapa: string, cuantas: number) {
  return Array.from({ length: cuantas }, (_, i) => {
    const [nombre, curso] = NOMBRES[i % NOMBRES.length];
    const horas = 2 + i * 5;
    const cuando = new Date(Date.now() - horas * 3_600_000).toISOString();
    // ⚠️ La clave tiene que ser ÚNICA ENTRE COLUMNAS. `repartirColumnas` pinta
    // cada clave UNA sola vez (así una tarjeta que se está moviendo no se
    // duplica), así que con el mismo teléfono en las cuatro columnas, las tres
    // últimas salían vacías — con su total en la cabecera diciendo 611. La
    // galería habría mostrado el Pipeline roto sin que el Pipeline lo esté.
    const telefono = `5198765${String(4321 + DESDE[etapa] + i)}`;
    return {
      clave: `conv:whatsapp:${telefono}:51986394450`,
      canal: 'whatsapp',
      tipo: 'mensaje',
      persona_id: telefono,
      persona_nombre: nombre,
      lead_nombre: nombre,
      numero_propio: '51986394450',
      texto: i % 3 === 0 ? '¿me puede pasar más información del diplomado?' : null,
      contexto_texto: null,
      respondida: i % 2 === 0,
      ya_le_hablamos: true,
      // El precio DERIVA la etapa: si la tarjeta tiene precio, está en Cotizados.
      precio_enviado: etapa === 'cotizado',
      etapa_efectiva: etapa,
      interes_curso: etapa === 'cotizado' ? curso : null,
      lead_curso: curso,
      ventana_abierta: false,
      // La VENTANA (ADR 0041): las primeras de cada columna todavía la tienen
      // abierta, y una entra en las últimas 3 h para que se vea el oro. El resto
      // sin ventana, que es como se ve la mayoría de una columna de seguimiento.
      ventana_cierra:
        i % 4 === 0
          ? new Date(Date.now() + (i === 0 ? 40 * 60_000 : (3 + i) * 3_600_000)).toISOString()
          : null,
      pide_info: i % 3 === 0,
      n: 4 + i,
      referencia: cuando,
      ultimo_at: cuando,
      dias: Math.floor(horas / 24),
      nivel: i % 2 === 0 ? 4 : 0,
    };
  });
}

/** El desglose que alimenta la bandeja y los conteos por columna. */
const DESGLOSE = [
  { etapa: 'interesado', yaLeHablamos: false, precio: false, viva: true, n: 218 },
  { etapa: 'interesado', yaLeHablamos: true, precio: false, viva: false, n: 258 },
  // ⚠️ Desde el 8-ago-2026 NINGUNA fila de `contactado` puede tener `precio`:
  // `precio_enviado` deriva `cotizado` (`cola/etapaEfectivaSql.ts`), así que esa
  // combinación ya no existe. Por eso el chip «Con precio» desaparece de
  // Contactados solo — la regla «un recorte que daría cero no se ofrece».
  { etapa: 'contactado', yaLeHablamos: true, precio: false, viva: false, ventana: true, n: 35 },
  { etapa: 'contactado', yaLeHablamos: true, precio: false, viva: false, ventana: false, n: 499 },
  { etapa: 'cotizado', yaLeHablamos: true, precio: true, viva: false, ventana: true, n: 214 },
  { etapa: 'cotizado', yaLeHablamos: true, precio: true, viva: false, ventana: false, n: 2850 },
  { etapa: 'cierre', yaLeHablamos: true, precio: true, viva: false, n: 12 },
  { etapa: 'perdido', yaLeHablamos: true, precio: false, viva: false, n: 47 },
];

/** Lo que la hoja de la ficha le pregunta a Cerberus. */
const FICHA_CERBERUS = {
  estado: 'cliente',
  id: 4821,
  nombre: 'Javier Peralta Ríos',
  codigo: 'CL-4821',
  dni: '41287654',
  pais: 'Perú',
  correo: 'javier.peralta@correo.com',
  ventasCount: 2,
  ventas: [
    { folio: 'F001-2291', estado: 'Pagado', monto: '750.00', moneda: 'PEN', fecha: '2026-07-14' },
    { folio: 'F001-1877', estado: 'Pagado', monto: '500.00', moneda: 'PEN', fecha: '2026-04-02' },
  ],
};

/** Todo endpoint responde de mentira: la galería no toca la red ni una vez. */
window.fetch = (async (entrada: RequestInfo | URL) => {
  const url = String(
    typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada : entrada.url,
  );

  // La foto de perfil NO existe en la galería, y decirlo con un 404 es lo
  // correcto: el Avatar cae a las iniciales ante cualquier problema («sin foto →
  // iniciales, nunca un roto»). Un 200 con JSON adentro le daría un blob que no
  // es una imagen, y la evidencia saldría con ocho íconos rotos.
  if (url.includes('/api/whatsapp/foto/')) {
    return new Response(null, { status: 404 });
  }

  if (url.includes('/api/conversaciones')) {
    const etapa = new URL(url, location.origin).searchParams.get('etapa') ?? 'contactado';
    const total = POR_ETAPA[etapa] ?? 0;
    return respuesta({
      conversaciones: tarjetas(etapa, Math.min(total, etapa === 'contactado' ? 8 : 4)),
      total,
      hayMas: total > 8,
      conteos: POR_ETAPA,
      desglose: DESGLOSE,
    });
  }

  const cuerpo = url.includes('/api/contactos/ficha')
    ? FICHA_CERBERUS
    : url.includes('/api/contactos/lead')
    ? {
        lead: {
          nombre: 'Javier Peralta Ríos',
          fuente: 'meta',
          campana: 'Gestión Pública · julio',
          anuncio: 'Adquiérelo ahora',
          fecha: '2026-07-02T15:12:00.000Z',
        },
      }
    : url.includes('/api/senales')
    ? { senales: {}, umbralDias: 3 }
    : url.includes('/api/gestiones/intereses')
    ? { lista: [{ curso: 'Diplomado en Gestión Pública', creadoAt: '2026-07-20T10:00:00.000Z' }], derivados: [] }
    : {};
  return respuesta(cuerpo);
}) as typeof fetch;

function respuesta(cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `?ficha=1` abre la hoja de la primera tarjeta.
 *
 * Es la evidencia de lo que la vista vino a resolver: hasta hoy, saber quién era
 * esa persona costaba **irse a Mensajes** y perder el tablero.
 */
if (PARAMS.has('ficha')) {
  setTimeout(() => {
    document.querySelector<HTMLElement>('[role="button"][aria-label^="Ver la ficha"]')?.click();
  }, 500);
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <VistaEmbudo onAbrir={() => {}} />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
