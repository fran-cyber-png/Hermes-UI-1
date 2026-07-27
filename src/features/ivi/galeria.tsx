import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { ErrorApi, queryClient } from '../../lib/datos/cliente';
import { Buscando, ConsultaIvi, FalloDeIvi } from './ConsultaIvi';
import type { RespuestaIvi } from './ivi';
import { RespuestaDeIvi } from './RespuestaDeIvi';

/**
 * LA GALERÍA DE LA SUPERFICIE DE IVI — la evidencia, reproducible y sin nada vivo detrás.
 *
 * Entry APARTE de Vite (`galeria-ivi.html` en la raíz): **no entra al bundle de la app**
 * —`vite build` toma solo `index.html`— y no habla con ningún server. Se abre a mano:
 *
 *     npx vite --port 5199        →  http://localhost:5199/galeria-ivi.html
 *
 * Existe por la regla dura #2 (nada de UI se reporta listo sin captura) y por la misma razón
 * que `imprimirHechos.ts`: poder VER lo que la vendedora va a ver sin base, sin red y sin
 * riesgo de tocarle el hilo a nadie. Los fixtures son copias literales de lo que emite
 * `contrato_hermes()` (ivi-cerebro/rag/api_contrato.py), ya traducidas a camelCase por la
 * costura del server.
 */

const HECHO: RespuestaIvi = {
  texto:
    'En México llevamos 642 ventas cobradas este mes, 18 % más que el mes pasado. El curso que más se vendió es el Diploma en Inteligencia y Contrainteligencia.',
  tipo: 'HECHO',
  fuentes: ['SDK:governa.ventas.porPais', 'SDK:governa.ventas.porCurso'],
  groundingOk: true,
  numerosNoVerificados: [],
  edadDelDato: 1840,
};

const CONTEXTO: RespuestaIvi = {
  texto:
    'La política de pagos permite dividir el diploma en dos cuotas sin recargo, siempre que la segunda quede saldada antes de la clase de cierre. Para tres o más cuotas hace falta autorización de coordinación.',
  tipo: 'CONTEXTO',
  fuentes: ['politica-de-pagos.md › Cuotas › Sin recargo', 'reglamento-escuela.md › Matrícula'],
  groundingOk: true,
  numerosNoVerificados: [],
  edadDelDato: null,
};

const SIN_EVIDENCIA: RespuestaIvi = {
  texto:
    'No tengo con qué responder eso: la pregunta pide un dato (monto) y ninguna herramienta lo cubrió. Decime a qué edición te referís y lo busco de nuevo.',
  tipo: 'SIN_EVIDENCIA',
  fuentes: [],
  groundingOk: true,
  numerosNoVerificados: [],
  edadDelDato: null,
};

const GROUNDING_ROTO: RespuestaIvi = {
  texto:
    'Este mes cerramos 214 ventas en Perú, con un ticket promedio de S/. 1.200 y una conversión del 12 % sobre los leads que respondieron.',
  tipo: 'HECHO',
  fuentes: ['SDK:governa.ventas.porPais'],
  groundingOk: false,
  numerosNoVerificados: ['S/. 1.200', '12 %'],
  edadDelDato: null,
};

const TIPO_NUEVO: RespuestaIvi = {
  texto:
    'Para este momento de la venta conviene mandar primero el temario y después la duración: es lo que más veces vino seguido de una respuesta.',
  tipo: 'ENSAMBLADO',
  fuentes: ['SDK:hermes.piezas.rendimiento'],
  groundingOk: true,
  numerosNoVerificados: [],
  edadDelDato: 3600,
};

/** El 502 que hoy devuelve producción: la ruta de Ivi todavía no está publicada (404 → http_inesperado). */
const ERROR_HOY = new ErrorApi(
  'Ivi respondió con un estado inesperado (404).',
  502,
  undefined,
  undefined,
  'http_inesperado',
);
const ERROR_TIMEOUT = new ErrorApi('Ivi no respondió a tiempo (30 s).', 502, undefined, undefined, 'timeout');

function Caja({ titulo, nota, children }: { titulo: string; nota: string; children: React.ReactNode }) {
  return (
    <section data-caja={titulo} className="w-[26rem] max-w-full">
      <h3 className="font-heading text-[11px] font-bold uppercase tracking-wide text-navy">{titulo}</h3>
      <p className="mb-1.5 mt-0.5 text-[10px] leading-snug text-muted-foreground">{nota}</p>
      {children}
    </section>
  );
}

function Galeria() {
  const sheet = new URLSearchParams(location.search).get('hoja') === '1';
  if (sheet) {
    return (
      <QueryClientProvider client={queryClient}>
        <div className="h-dvh bg-background p-6">
          <p className="font-heading text-sm font-bold text-navy">Hermes · la mesa de siempre, detrás</p>
          <p className="mt-1 text-xs text-muted-foreground">
            La hoja de Ivi es una capa: el panel derecho no cambia y «Registrar venta» sigue clavado.
          </p>
        </div>
        <ConsultaIvi abierta onCerrar={() => {}} />
      </QueryClientProvider>
    );
  }
  return (
    <div className="min-h-dvh bg-background p-5">
      <h1 className="font-heading text-lg font-bold text-navy">La superficie de Ivi — los seis estados</h1>
      <p className="mt-1 max-w-3xl text-xs leading-snug text-muted-foreground">
        Tres formas distintas, no tres colores del mismo cuadrado: filete sólido + blanco es un dato;
        filete punteado + hundido es una cita; borde punteado y sin relleno es «no sé». Sin oro — el oro
        en Hermes significa tiempo que se acaba.
      </p>
      <div className="mt-5 flex flex-wrap items-start gap-5">
        <Caja titulo="HECHO" nota="Determinista. Se muestra con confianza y cita su fuente.">
          <RespuestaDeIvi respuesta={HECHO} />
        </Caja>
        <Caja titulo="CONTEXTO" nota="Texto citado, no una cifra. Se ve hundido: el plano que se consulta.">
          <RespuestaDeIvi respuesta={CONTEXTO} />
        </Caja>
        <Caja titulo="SIN_EVIDENCIA" nota="Ivi funcionó y no sabe. Es una respuesta, no una falla.">
          <RespuestaDeIvi respuesta={SIN_EVIDENCIA} />
        </Caja>
        <Caja
          titulo="grounding_ok: false"
          nota="Se marcan LAS CIFRAS señaladas; el resto de la respuesta no se descarta."
        >
          <RespuestaDeIvi respuesta={GROUNDING_ROTO} />
        </Caja>
        <Caja titulo="tipo desconocido" nota="Un tipo nuevo de Ivi cae en la rama conservadora y se dice.">
          <RespuestaDeIvi respuesta={TIPO_NUEVO} />
        </Caja>
        <Caja titulo="Carga" nota="Dice cuánto puede tardar: el techo real del server son 30 s.">
          <Buscando />
        </Caja>
        <Caja titulo="Error — lo que se ve HOY" nota="La ruta de Ivi da 404 en producción. Nunca «no encontró datos».">
          <FalloDeIvi error={ERROR_HOY} onReintentar={() => {}} />
        </Caja>
        <Caja titulo="Error transitorio" nota="Solo lo que puede dar otro resultado ofrece «Reintentar».">
          <FalloDeIvi error={ERROR_TIMEOUT} onReintentar={() => {}} />
        </Caja>
      </div>
    </div>
  );
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <Galeria />
  </StrictMode>,
);
