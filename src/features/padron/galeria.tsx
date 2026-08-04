import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { PantallaPadron } from './PantallaPadron';

/**
 * LA GALERÍA DEL PADRÓN — la evidencia, sin server ni base.
 *
 * Entry APARTE de Vite (`galeria-padron.html` en la raíz): **no entra al bundle
 * de la app** —`vite build` toma solo `index.html`— y no habla con ningún server.
 *
 *     npx vite --port 5199 → http://localhost:5199/galeria-padron.html
 *     …/galeria-padron.html?vendedora=1 → la misma pantalla para quien NO reparte
 *
 * Existe por la regla dura #2 y para poder ver de una las dos cosas que esta
 * pantalla tiene que resolver sin que nadie lea: que **«compró» de verdad se
 * distinga de «icarus dice que compró»**, y que el número del lote esté a la
 * vista antes de repartirlo.
 */

const SOY_VENDEDORA = new URLSearchParams(location.search).has('vendedora');

const NOMBRES = [
  ['Ana Lucía Quispe Mamani', 'PE', 'Diplomado en Gestión Pública', 'anuncio'],
  ['Roberto Carlos Medina', 'MX', 'Inteligencia y Contrainteligencia', 'formulario'],
  ['María Fernanda Toledo', 'EC', 'Diplomado en Gestión Pública', 'anuncio'],
  ['Luis Alberto Chávez Rojas', 'PE', 'Foro de Estado', 'organico'],
  ['Carmen Rosa Huamán', 'BO', 'Escuela de Gobierno', 'anuncio'],
  ['Jorge Enrique Salazar', 'GT', 'Inteligencia y Contrainteligencia', 'formulario'],
  ['Patricia Elena Vargas', 'PE', 'Diplomado en Gestión Pública', 'anuncio'],
  ['Miguel Ángel Ramírez', 'CO', 'Foro de Estado', 'organico'],
  ['Sandra Milena Ocampo', 'PE', 'Escuela de Gobierno', 'anuncio'],
  ['Diego Armando Flores', 'MX', 'Inteligencia y Contrainteligencia', 'formulario'],
  ['Rosa María Ticona', 'PE', 'Diplomado en Gestión Pública', 'anuncio'],
  ['Fernando José Aguirre', 'EC', 'Foro de Estado', 'organico'],
] as const;

const TOTAL_PADRON = 72_923;

function contactos() {
  return NOMBRES.map(([nombre, pais, curso, fuente], i) => ({
    id: 1000 + i,
    nombre,
    telefono: `${pais === 'MX' ? '52' : pais === 'GT' ? '502' : '51'}9${String(84429504 + i * 137)}`,
    correo: `${nombre.split(' ')[0].toLowerCase()}${i}@correo.com`,
    pais,
    etapa: i % 4 === 0 ? 'interested' : 'contacted',
    nivel: i % 5 === 0 ? 'vip' : 'prospect',
    gastado: i % 5 === 0 ? '1250.00' : null,
    // El caso que hay que poder distinguir de un vistazo: los tres estados de
    // «compró». `conVenta` es el único afirmable.
    compras: i % 3 === 0 ? 3 : null,
    conVenta: i % 5 === 0,
    curso,
    fuente,
    creadoEn: new Date(Date.UTC(2026, 6, 28 - i, 12)).toISOString(),
  }));
}

/** Todo endpoint responde de mentira: la galería no toca la red ni una vez. */
window.fetch = (async (entrada: RequestInfo | URL) => {
  const url = String(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada : entrada.url);
  const cuerpo = url.includes('/api/padron/reparto')
    ? {
        destinos: [
          'ventas11@grupogoberna.com',
          'ventas12@grupogoberna.com',
          'ventas13@grupogoberna.com',
          'ventas14@grupogoberna.com',
          'luz',
        ],
        carga: [
          { vendedoraId: 'ventas11@grupogoberna.com', contactos: 340 },
          { vendedoraId: 'ventas12@grupogoberna.com', contactos: 338 },
          { vendedoraId: 'ventas13@grupogoberna.com', contactos: 12 },
        ],
      }
    : {
        contactos: contactos().slice(0, SOY_VENDEDORA ? 6 : 12),
        total: SOY_VENDEDORA ? 6 : TOTAL_PADRON,
        supervisor: !SOY_VENDEDORA,
        porPagina: 50,
        paginaActual: 1,
        sinSupervisores: false,
      };
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * `?lote=1` marca las primeras filas después de montar, para poder capturar la
 * barra de reparto. La selección es estado interno de la pantalla y no se puede
 * sembrar por props — y el estado que hay que MIRAR es justamente ése: el número
 * del lote junto al destino, antes de apretar (regla dura #7).
 */
if (new URLSearchParams(location.search).has('lote')) {
  setTimeout(() => {
    document
      .querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')
      .forEach((casilla, i) => {
        if (i < 4) casilla.click();
      });
  }, 400);
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <div className="flex h-screen flex-col bg-background">
        <header className="shrink-0 border-b border-border bg-card px-4 py-2.5">
          <h1 className="font-heading text-sm font-bold text-foreground">
            Contactos · Padrón —{' '}
            <span className="font-normal text-muted-foreground">
              {SOY_VENDEDORA ? 'lo que ve una vendedora (solo lo habilitado)' : 'lo que ve el supervisor'}
            </span>
          </h1>
        </header>
        <PantallaPadron onEscribir={() => {}} />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
