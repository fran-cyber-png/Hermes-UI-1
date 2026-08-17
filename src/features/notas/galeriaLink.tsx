import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { queryClient } from '../../lib/datos/cliente';
import { AuditoriaDeLink } from './AuditoriaDeLink';
import { ModalDeLink } from './ModalDeLink';
import type { Nota } from './notas';

/**
 * LA GALERÍA DEL LINK Y SU REGISTRO — la evidencia, sin server ni base.
 *
 *     npx vite --port 5199  →  http://localhost:5199/galeria-link.html
 *
 * Existe por la regla dura #2 (nada de UI se reporta listo sin captura) y porque
 * este frente **no se puede mirar de otra forma sin levantar Postgres**: el modal
 * vive sobre una página guardada y el registro sale de una tabla que hay que
 * migrar primero.
 *
 * ⚠️ **Sirve los casos FEOS, no el ideal** — la lección de ADR 0051 y de la
 * galería del radar: una galería con el caso lindo ya escondió tres defectos una
 * vez. Por eso están el link que nadie abrió, el que ya se cortó, la apertura
 * anónima y —el que más importa— **el server sin la migración**, que es el único
 * estado donde un registro de auditoría puede mentir de verdad.
 *
 *     ?vista=modal          el modal, sobre un link ya repartido (default)
 *     ?vista=modal-nuevo    el modal de una página que todavía no compartió nada
 *     ?vista=registro       el Audit Log con datos
 *     ?vista=registro-vacio el link existe y no lo abrió nadie
 *     ?vista=registro-sin   🔴 falta la migración: «no se pudo saber» ≠ «no pasó nada»
 */

const AHORA = Date.now();
const hace = (ms: number) => new Date(AHORA - ms).toISOString();
const HORA = 3_600_000;
const DIA = 24 * HORA;

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

function pagina(over: Partial<Nota> = {}): Nota {
  return {
    id: 42,
    clave: 'general',
    vendedoraId: 'luz',
    texto: 'Precios del Diploma en Inteligencia\nContado 890, en 3 cuotas 990.',
    doc: null,
    fijada: false,
    creadoAt: hace(9 * DIA),
    editadoAt: hace(2 * DIA),
    archivadoAt: null,
    origen: 'nota',
    espacioId: 7,
    ...over,
  };
}

/**
 * EL REGISTRO QUE LA PANTALLA VA A RECIBIR. Son dos links, uno vivo y uno cortado
 * — el caso que obliga a NO sumar sus usos (`resumirPorLink`).
 */
const EVENTOS = [
  // El link viejo: se abrió al mundo, lo miraron, y se cortó.
  { id: 1, notaId: 42, etiqueta: 'f0e1d2', evento: 'creado', quien: 'luz', alcance: 'publico', permiso: 'ver', venceAt: null, motivo: null, at: hace(9 * DIA) },
  { id: 2, notaId: 42, etiqueta: 'f0e1d2', evento: 'usado', quien: null, alcance: null, permiso: null, venceAt: null, motivo: null, at: hace(9 * DIA - 2 * HORA) },
  { id: 3, notaId: 42, etiqueta: 'f0e1d2', evento: 'usado', quien: null, alcance: null, permiso: null, venceAt: null, motivo: null, at: hace(8 * DIA) },
  { id: 4, notaId: 42, etiqueta: 'f0e1d2', evento: 'cortado', quien: 'luz', alcance: null, permiso: null, venceAt: null, motivo: null, at: hace(7 * DIA) },

  // El de ahora: interno, editable, y con gente de Goberna entrando.
  { id: 5, notaId: 42, etiqueta: 'a1b2c3', evento: 'creado', quien: 'luz', alcance: 'publico', permiso: 'ver', venceAt: null, motivo: null, at: hace(5 * DIA) },
  { id: 6, notaId: 42, etiqueta: 'a1b2c3', evento: 'usado', quien: null, alcance: null, permiso: null, venceAt: null, motivo: null, at: hace(4 * DIA) },
  { id: 7, notaId: 42, etiqueta: 'a1b2c3', evento: 'reconfigurado', quien: 'ventas10@grupogoberna.com', alcance: 'goberna', permiso: 'editar', venceAt: new Date(AHORA + 20 * DIA).toISOString(), motivo: null, at: hace(3 * DIA) },
  { id: 8, notaId: 42, etiqueta: 'a1b2c3', evento: 'usado', quien: 'Sindy', alcance: null, permiso: null, venceAt: null, motivo: null, at: hace(2 * DIA) },
  { id: 9, notaId: 42, etiqueta: 'a1b2c3', evento: 'usado', quien: 'sindy', alcance: null, permiso: null, venceAt: null, motivo: null, at: hace(26 * HORA) },
  { id: 10, notaId: 42, etiqueta: 'a1b2c3', evento: 'usado', quien: 'ventas10@grupogoberna.com', alcance: null, permiso: null, venceAt: null, motivo: null, at: hace(3 * HORA) },
  { id: 11, notaId: 42, etiqueta: 'a1b2c3', evento: 'usado', quien: null, alcance: null, permiso: null, venceAt: null, motivo: null, at: hace(25 * 60_000) },
];

/**
 * ⚠️ El resumen lo calcula el SERVER (`resumirPorLink`), así que acá viaja como
 * dato — igual que en producción. Recalcularlo en la galería mostraría números
 * que la app no produce, y la evidencia dejaría de ser evidencia.
 *
 * 🔴 Mirá los tres números del link `a1b2c3`: **5 aperturas, 2 personas de
 * Goberna, 2 sin cuenta.** No cierran entre sí a propósito — `Sindy` abrió dos
 * veces. Ese es exactamente el motivo por el que no existe una cifra «personas».
 */
const LINKS = [
  { etiqueta: 'a1b2c3', aperturas: 5, personasDeGoberna: 2, anonimas: 2, ultimaApertura: hace(25 * 60_000), creadoPor: 'luz', creadoAt: hace(5 * DIA), cortadoAt: null, reconfiguraciones: 1 },
  { etiqueta: 'f0e1d2', aperturas: 2, personasDeGoberna: 0, anonimas: 2, ultimaApertura: hace(8 * DIA), creadoPor: 'luz', creadoAt: hace(9 * DIA), cortadoAt: hace(7 * DIA), reconfiguraciones: 0 },
];

const PERSONAS = ['luz', 'Sindy', 'ventas10@grupogoberna.com'];

type Vista = 'modal' | 'modal-nuevo' | 'registro' | 'registro-vacio' | 'registro-sin';

const vista = (new URLSearchParams(window.location.search).get('vista') ?? 'modal') as Vista;

/**
 * EL SERVER, DE MENTIRA — pero por la puerta de verdad.
 *
 * Se interviene `fetch` y no el caché de TanStack a propósito: así el componente
 * corre **su camino real** (el hook, el estado de carga, el `sinRegistro`), y lo
 * único falso es la respuesta. Intervenir el caché saltearía justo lo que hay que
 * mirar.
 */
const original = window.fetch.bind(window);
window.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  if (url.includes('/link/historial')) {
    const cuerpo =
      vista === 'registro-sin'
        ? { ok: true, eventos: [], links: [], personas: [], sinRegistro: true }
        : vista === 'registro-vacio'
          ? { ok: true, eventos: [], links: [], personas: [], sinRegistro: false }
          : { ok: true, eventos: EVENTOS, links: LINKS, personas: PERSONAS, sinRegistro: false };
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return original(entrada, init);
}) as typeof window.fetch;

function Galeria() {
  const [abierto, setAbierto] = useState<'modal' | 'registro'>(vista.startsWith('registro') ? 'registro' : 'modal');
  const nota = vista === 'modal-nuevo' ? pagina() : pagina({ token: TOKEN, alcance: 'goberna', permiso: 'editar', venceAt: new Date(AHORA + 20 * DIA).toISOString(), ultimoAccesoAt: hace(25 * 60_000) });

  return (
    <div className="min-h-screen bg-muted p-8">
      {/* El fondo existe para que se vea que el modal se superpone sobre la
          Libreta y no la empuja — que es la mitad de por qué dejó de ser un panel
          desplegado dentro del editor. */}
      <div className="mx-auto max-w-3xl space-y-3 rounded-xl bg-card p-6 shadow-panel">
        <h1 className="text-lg font-semibold text-foreground">Precios del Diploma en Inteligencia</h1>
        <p className="text-sm text-muted-foreground">Contado 890, en 3 cuotas 990.</p>
        <p className="text-sm text-muted-foreground">
          Esta es la página de atrás. El modal se superpone; no empuja el texto hacia abajo.
        </p>
      </div>

      {abierto === 'modal' && (
        <ModalDeLink
          nota={nota}
          onCerrar={() => setAbierto('modal')}
          onGuardar={(v) => console.log('guardar', v)}
          onCortar={() => console.log('cortar')}
          onVerRegistro={() => setAbierto('registro')}
        />
      )}

      {abierto === 'registro' && <AuditoriaDeLink notaId={42} onCerrar={() => setAbierto('modal')} />}
    </div>
  );
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Galeria />
    </QueryClientProvider>
  </StrictMode>,
);
