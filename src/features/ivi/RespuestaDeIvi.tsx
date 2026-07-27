import { useState } from 'react';
import {
  BadgeCheck,
  Check,
  Clock,
  Copy,
  Database,
  FileText,
  Quote,
  SearchX,
  TriangleAlert,
} from 'lucide-react';
import type { RespuestaIvi } from './ivi';
import {
  TIPO_IVI,
  cifrasDudosas,
  fuentesLegibles,
  lecturaDeFrescura,
  presentacionDe,
  tramosMarcados,
  type TipoIvi,
} from './presentacion';

/**
 * UNA RESPUESTA DE IVI. Y los tres tipos NO comparten componente por dentro.
 *
 * ══ EL INCIDENTE QUE JUSTIFICA TODO ESTE ARCHIVO ═════════════════════════════
 *
 * El 2026-07-25 se midió en vivo que Ivi reportaba datos de **12 días** como `HECHO`. Toda
 * la capa de honestidad de Ivi —los tres tipos, `grounding_ok`, `edad_del_dato`— existe por
 * ese incidente. Si esta pantalla aplana `HECHO` y `SIN_EVIDENCIA` al mismo componente, esa
 * capa **no protege a nadie: solo hace sentir que sí**.
 *
 * ══ LA GRAMÁTICA: TRES FORMAS DISTINTAS, NO TRES COLORES DEL MISMO CUADRADO ══
 *
 * Un color se aprende; una forma se reconoce sin leer. Por eso lo que cambia entre los tres
 * no es el relleno: es la ANATOMÍA de la caja.
 *
 *   HECHO          filete SÓLIDO de 3 px + fondo BLANCO — el plano que decide.
 *                  Sale de una consulta determinista, y **cita su fuente o lo confiesa**.
 *   CONTEXTO       filete PUNTEADO + fondo HUNDIDO (`bg-muted`) — el plano que se consulta.
 *                  Es la misma bandeja hundida del panel derecho (ADR 0017): en Hermes,
 *                  hundido ya significa «esto se mira, no se decide».
 *   SIN_EVIDENCIA  sin relleno y con el BORDE ENTERO punteado — se ve vacío a propósito.
 *                  Es una respuesta, no un error: Ivi funcionó y no sabe.
 *
 * **Sin oro en ninguna de las tres.** El oro en Hermes significa una sola cosa —tiempo que
 * se acaba— y una respuesta de Ivi no es urgencia. El ámbar que sí aparece es `--warning`,
 * el mismo de «no se pudo saber» del panel, y solo sobre lo que no se pudo verificar.
 *
 * ══ LAS DOS BANDERAS ═════════════════════════════════════════════════════════
 *
 *   `grounding_ok: false`  → se marcan LAS CIFRAS señaladas, y **no se descarta la respuesta
 *                            entera**: el resto del texto puede estar perfecto.
 *   `edad_del_dato: null`  → «no se puede confirmar cuán fresco es este dato». Nunca
 *                            silencio, que es exactamente lo que dejó pasar los 12 días.
 *
 * ══ LO QUE ESTE COMPONENTE DELIBERADAMENTE NO TIENE ══════════════════════════
 *
 * **No hay botón que ponga esto en el composer.** El texto de Ivi lo redacta un LLM, y lo
 * que sale hacia un lead viene del catálogo (ADR 0015). Un botón «poner en la caja» acá
 * dejaría prosa generada a UN clic de una conversación real. Copiar existe —la vendedora
 * puede seleccionar el texto igual— pero el puente no se construye.
 */

interface Piel {
  caja: string;
  rotulo: string;
  aclaracion: string;
  color: string;
  Icono: typeof BadgeCheck;
}

const PIEL: Record<TipoIvi, Piel> = {
  [TIPO_IVI.HECHO]: {
    // Filete sólido + blanco: el plano que decide. Sombra O borde, nunca las dos (regla de la casa).
    caja: 'border-l-[3px] border-primary bg-card ring-1 ring-border',
    rotulo: 'Dato',
    aclaracion: 'Salió de una consulta a los datos, no de un texto.',
    color: 'text-primary',
    Icono: BadgeCheck,
  },
  [TIPO_IVI.CONTEXTO]: {
    // Filete punteado + hundido: el plano que se consulta.
    caja: 'border-l-[3px] border-dashed border-cat-pizarra/60 bg-muted/70 ring-1 ring-border/60',
    rotulo: 'De un documento',
    aclaracion: 'Es texto citado. No es una cifra consultada.',
    color: 'text-cat-pizarra',
    Icono: Quote,
  },
  [TIPO_IVI.SIN_EVIDENCIA]: {
    // Sin relleno y punteada entera: se ve vacía porque está vacía.
    caja: 'border border-dashed border-border bg-transparent',
    rotulo: 'Ivi no tiene con qué responder',
    aclaracion: 'No lo inventa, y no lo va a reintentar solo.',
    color: 'text-muted-foreground',
    Icono: SearchX,
  },
};

/** El texto de la respuesta, con las cifras que el grounding no pudo casar marcadas en su lugar. */
function Cuerpo({ texto, cifras, grande }: { texto: string; cifras: string[]; grande: boolean }) {
  const clase = grande ? 'text-[13px] leading-relaxed' : 'text-xs leading-relaxed';
  return (
    <p className={clase + ' whitespace-pre-wrap text-foreground'}>
      {tramosMarcados(texto, cifras).map((t, i) =>
        t.dudoso ? (
          <mark
            key={i}
            title="Esta cifra no se pudo verificar contra los datos"
            className="rounded-[3px] bg-warning/20 px-0.5 font-mono text-[0.95em] font-semibold text-warning-foreground underline decoration-warning decoration-dotted underline-offset-2"
          >
            {t.texto}
          </mark>
        ) : (
          <span key={i}>{t.texto}</span>
        ),
      )}
    </p>
  );
}

export function RespuestaDeIvi({ respuesta }: { respuesta: RespuestaIvi }) {
  const [copiado, setCopiado] = useState(false);

  const p = presentacionDe(respuesta.tipo);
  const piel = PIEL[p.tipo];
  const esHecho = p.tipo === TIPO_IVI.HECHO;
  const cifras = cifrasDudosas(respuesta.numerosNoVerificados);
  const fuentes = fuentesLegibles(respuesta.fuentes);
  const frescura = lecturaDeFrescura(respuesta.edadDelDato);
  const conGrounding = respuesta.groundingOk === false;
  // Un HECHO sin fuente declarada es lo que hay que poder ver de un vistazo: es un número
  // presentado con confianza y sin de dónde salió.
  const hechoSinFuente = esHecho && fuentes.length === 0;

  return (
    <article
      data-tipo={p.tipo}
      data-reconocido={p.reconocido}
      className={'animate-entrar rounded-xl px-3 py-2.5 ' + piel.caja}
    >
      {/* La cabecera: el rótulo dice QUÉ clase de respuesta es, antes de que se lea nada. */}
      <header className="flex items-start gap-2">
        <piel.Icono size={14} strokeWidth={2.2} className={'mt-px shrink-0 ' + piel.color} />
        <div className="min-w-0 flex-1">
          <h4 className={'font-heading text-[11px] font-bold leading-tight ' + piel.color}>{piel.rotulo}</h4>
          <p className="mt-px text-[10px] leading-tight text-muted-foreground">{piel.aclaracion}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(respuesta.texto);
            setCopiado(true);
            window.setTimeout(() => setCopiado(false), 1500);
          }}
          title="Copiar el texto"
          aria-label="Copiar la respuesta de Ivi"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-200 ease-house hover:bg-secondary hover:text-navy active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          {copiado ? <Check size={12} className="text-success" /> : <Copy size={12} />}
        </button>
      </header>

      {/* Un `tipo` que esta versión no conoce: se dibuja como CONTEXTO —lo conservador— y se
          DICE, en vez de disimularlo. Ivi puede crecer su enum sin coordinar un release. */}
      {!p.reconocido && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-secondary px-2 py-1 text-[10px] leading-snug text-secondary-foreground">
          <TriangleAlert size={11} className="mt-px shrink-0" />
          <span>
            Ivi la marcó como <code className="font-mono font-semibold">{p.crudo || '(sin tipo)'}</code>, un tipo
            que esta versión de Hermes no conoce. Se muestra como contexto por precaución, nunca como dato.
          </span>
        </p>
      )}

      {/* La bandera del grounding va ARRIBA del texto: quien lea la respuesta tiene que
          saber antes de leerla que hay cifras marcadas. Y no descarta nada. */}
      {conGrounding && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] leading-snug text-warning-foreground">
          <TriangleAlert size={11} className="mt-px shrink-0" />
          <span>
            {cifras.length > 0 ? (
              <>
                No se pudo verificar contra los datos:{' '}
                <strong className="font-mono font-semibold">{cifras.join(' · ')}</strong>. El resto de la
                respuesta sigue en pie.
              </>
            ) : (
              <>Alguna cifra no se pudo verificar contra los datos, e Ivi no dijo cuál.</>
            )}
          </span>
        </p>
      )}

      <div className="mt-2">
        <Cuerpo texto={respuesta.texto} cifras={cifras} grande={esHecho} />
      </div>

      {p.tipo === TIPO_IVI.SIN_EVIDENCIA && (
        <p className="mt-2 border-t border-dashed border-border pt-2 text-[10px] leading-snug text-muted-foreground">
          Esto <strong className="font-semibold">no es una falla</strong>: Ivi funcionó y no encontró con qué
          respaldar una respuesta. Probá preguntándolo de otra forma.
        </p>
      )}

      {/* El pie: de dónde salió y de cuándo es. Las dos preguntas que hacen supervisable un
          número, y las dos que estaban ausentes el día del incidente. */}
      {(fuentes.length > 0 || hechoSinFuente || esHecho || !frescura.medido) && (
        <footer className="mt-2.5 space-y-1 border-t border-border/70 pt-2">
          {fuentes.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {fuentes.map((f, i) => (
                <li
                  key={i}
                  title={f.detalle ? `${f.etiqueta} › ${f.detalle}` : f.etiqueta}
                  className={
                    'flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] leading-tight ' +
                    (f.clase === 'sdk'
                      ? 'bg-secondary font-mono text-secondary-foreground'
                      : 'border border-border text-muted-foreground')
                  }
                >
                  {f.clase === 'sdk' ? (
                    <Database size={10} className="shrink-0" />
                  ) : (
                    <FileText size={10} className="shrink-0" />
                  )}
                  <span className="truncate">{f.etiqueta}</span>
                  {f.detalle && <span className="hidden truncate opacity-70 sm:inline">› {f.detalle}</span>}
                </li>
              ))}
            </ul>
          )}

          {hechoSinFuente && (
            <p className="flex items-center gap-1 text-[10px] leading-tight text-warning-foreground">
              <TriangleAlert size={10} className="shrink-0" />
              Ivi lo presentó como dato y no declaró de dónde salió.
            </p>
          )}

          {/* «No medido» NO es «fresco», y el silencio acá fue el incidente. En un HECHO la
              edad decide si el número sirve, así que se dice en ámbar; en los otros dos es
              una nota al pie. */}
          <p
            className={
              'flex items-center gap-1 text-[10px] leading-tight ' +
              (!frescura.medido && esHecho ? 'text-warning-foreground' : 'text-muted-foreground')
            }
          >
            <Clock size={10} className="shrink-0" />
            {frescura.medido ? `Dato ${frescura.texto}.` : 'Ivi no midió la antigüedad: ' + frescura.texto + '.'}
          </p>
        </footer>
      )}
    </article>
  );
}
