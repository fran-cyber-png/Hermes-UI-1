import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, RefreshCw, SendHorizontal, ShieldAlert, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import { lecturaDeError } from './errores';
import {
  MAX_CARACTERES_PREGUNTA,
  motivoParaNoPreguntar,
  usePreguntarleAIvi,
  type RespuestaIvi,
  type TurnoHistorial,
} from './ivi';
import { RespuestaDeIvi } from './RespuestaDeIvi';

/**
 * PREGUNTARLE A IVI — la superficie de consulta, encima de la mesa y no adentro de ella.
 *
 * ══ POR QUÉ ACÁ Y NO EN UNA PESTAÑA DEL PANEL DERECHO ════════════════════════
 *
 * La regla del panel (ADR 0017) es que **una pestaña guarda lo que se CONSULTA, nunca lo que
 * se DECIDE**, y preguntarle a Ivi es consultar: por esa regla, calificaba. Lo que no
 * califica es por el otro lado — **el panel derecho es de ESTA persona**, de arriba abajo:
 * quién es · qué quiere · qué le mando · su detalle · qué hago con ella. Una pregunta a Ivi
 * («¿el diploma de OSINT tiene cuotas en México?») no es de la persona: es del negocio.
 * Meterla ahí la ataría a tener una conversación abierta y la volvería invisible desde el
 * Dashboard, el Pipeline y la Agenda, que es donde también se pregunta.
 *
 * Y hay una razón de tamaño: el panel mide 360 px con el pie clavado y un solo scroll en el
 * medio (el bug de «Registrar venta» empujado fuera de pantalla). Un hilo de preguntas y
 * respuestas ahí adentro compite por alto con la acción que cierra la venta. **Acá no
 * compite con nada**: es una capa aparte, el panel no cambia ni un píxel, y el pie sigue
 * clavado donde estaba.
 *
 * El molde ya existía en la app: `LibretaPersonal` (#47) es exactamente esto —una hoja a la
 * derecha, global, con una tecla— y esta la copia a propósito en vez de inventar otra forma.
 * Lo que se archivó por ser una hoja encima de la app fue la **bandeja de revisión** (ADR
 * 0018), y por un motivo que acá no aplica: ahí se DECIDE, y decidir tapando la conversación
 * que hay que mirar era el error. Consultar no tapa nada que haga falta ver.
 *
 * ══ LO QUE NO TIENE, A PROPÓSITO ═════════════════════════════════════════════
 *
 * Ni un camino de un clic entre el texto de Ivi y el composer de un lead. El texto que sale
 * hacia una persona viene del catálogo (ADR 0015); esto es prosa de un LLM. Se copia, no se
 * tiende el puente.
 */

interface Turno {
  pregunta: string;
  respuesta: RespuestaIvi | null;
  error: unknown;
}

const EJEMPLOS = [
  '¿Cuántas ventas llevamos este mes?',
  '¿El diploma de OSINT se puede pagar en cuotas?',
  '¿Cuánto cuesta la última edición de Gestión Pública?',
];

/** Las tres formas de la respuesta, explicadas UNA vez para que después se reconozcan sin leer. */
function Leyenda() {
  return (
    <ul className="mt-3 space-y-1.5">
      <li className="flex items-start gap-2 rounded-lg border-l-[3px] border-primary bg-card px-2 py-1.5 ring-1 ring-border">
        <span className="text-[10px] leading-snug">
          <strong className="font-heading font-bold text-primary">Dato</strong>
          <span className="text-muted-foreground"> — salió de una consulta a los datos. Cita su fuente.</span>
        </span>
      </li>
      <li className="flex items-start gap-2 rounded-lg border-l-[3px] border-dashed border-cat-pizarra/60 bg-muted/70 px-2 py-1.5 ring-1 ring-border/60">
        <span className="text-[10px] leading-snug">
          <strong className="font-heading font-bold text-cat-pizarra">De un documento</strong>
          <span className="text-muted-foreground"> — texto citado. No es una cifra consultada.</span>
        </span>
      </li>
      <li className="flex items-start gap-2 rounded-lg border border-dashed border-border px-2 py-1.5">
        <span className="text-[10px] leading-snug">
          <strong className="font-heading font-bold text-muted-foreground">No tiene con qué</strong>
          <span className="text-muted-foreground"> — Ivi no sabe, y te lo dice en vez de inventarlo.</span>
        </span>
      </li>
    </ul>
  );
}

/** El esqueleto de la espera. Dice cuánto puede tardar: el techo real del server son 30 s. */
export function Buscando() {
  return (
    <div className="animate-entrar rounded-xl border-l-[3px] border-border bg-card px-3 py-2.5 ring-1 ring-border">
      <p className="text-[11px] font-semibold text-muted-foreground">Ivi está buscando en los datos…</p>
      <div className="mt-2 space-y-1.5">
        <div className="h-2.5 w-full animate-pulse rounded bg-border" />
        <div className="h-2.5 w-11/12 animate-pulse rounded bg-border" style={{ animationDelay: '120ms' }} />
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-border" style={{ animationDelay: '240ms' }} />
      </div>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Puede tardar hasta 30 segundos. Si se pasa de ahí, te lo dice — no se queda girando.
      </p>
    </div>
  );
}

/** De quién es el problema, en una palabra que sirva para saber a quién avisarle. */
const CULPA: Record<'hermes' | 'ivi' | 'red' | 'sesion', string> = {
  hermes: 'config de Hermes',
  ivi: 'lado de Ivi',
  red: 'conexión',
  sesion: 'tu sesión',
};

/**
 * EL ESTADO DE ERROR, DE PRIMERA CLASE.
 *
 * Hoy la ruta de Ivi devuelve 404 en producción, así que **esto es lo primero que va a ver
 * una vendedora real**. Nunca dice «Ivi no encontró datos»: eso sería exactamente la mentira
 * que la regla fail-closed del repo prohíbe. Dice qué pasó, de quién es, y si reintentar
 * puede servir de algo.
 */
export function FalloDeIvi({ error, onReintentar }: { error: unknown; onReintentar: () => void }) {
  const l = lecturaDeError(error);
  if (!l) return null;
  return (
    <div className="animate-entrar rounded-xl border border-destructive/35 bg-destructive/5 px-3 py-2.5">
      <header className="flex items-start gap-2">
        <ShieldAlert size={14} strokeWidth={2.2} className="mt-px shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <h4 className="font-heading text-[11px] font-bold leading-tight text-destructive">{l.titulo}</h4>
          <p className="mt-0.5 text-[11px] leading-snug text-foreground">{l.detalle}</p>
        </div>
      </header>

      <p className="mt-2 text-[11px] leading-snug text-foreground">{l.queHacer}</p>

      <footer className="mt-2.5 flex items-center justify-between gap-2 border-t border-destructive/20 pt-2">
        <code className="truncate font-mono text-[10px] text-muted-foreground">
          {CULPA[l.culpa]} · {l.codigo}
        </code>
        {l.reintentable && (
          <button
            type="button"
            onClick={onReintentar}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-navy px-2 py-1 text-[11px] font-semibold text-white transition-transform duration-200 ease-house active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <RefreshCw size={11} /> Reintentar
          </button>
        )}
      </footer>

      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Esto es una <strong className="font-semibold">falla</strong>, no una respuesta. Ivi no dijo que no
        sabe: no se pudo hablar con él.
      </p>
    </div>
  );
}

export function ConsultaIvi({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const preguntar = usePreguntarleAIvi();
  const caja = useRef<HTMLTextAreaElement>(null);
  const fondo = useRef<HTMLDivElement>(null);

  // El mismo contrato de Escape que todos los modales de la casa: con el foco fuera de un
  // campo, cierra y corta la propagación (así no se lleva puesta la conversación de atrás).
  //
  // **`abierta` no es opcional acá.** `App.tsx` monta esta hoja SIEMPRE, y este hook
  // registra en captura sobre `window` y corta el evento: sin la guarda, con Ivi cerrado
  // —o sea, casi todo el tiempo— el Escape moría acá y dejaban de andar la tecla que cierra
  // la conversación en Mensajes, la de la Cabina y la de la libreta. El molde que este
  // componente dice copiar (`LibretaPersonal`) no tiene el problema porque no tiene el
  // listener; esta hoja sí lo quiere (para no arrastrar la conversación de atrás al
  // cerrarse), así que lo paga con la condición explícita.
  useEscape(onCerrar, abierta);

  useEffect(() => {
    if (abierta) requestAnimationFrame(() => caja.current?.focus());
  }, [abierta]);

  // Cada turno nuevo trae el final a la vista: si no, la respuesta aparece abajo del pliegue
  // y la pantalla se ve igual que antes de preguntar.
  useEffect(() => {
    fondo.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turnos, preguntar.isPending]);

  if (!abierta) return null;

  /** El historial que viaja: solo los turnos que Ivi contestó. Un fallo no es contexto. */
  function historial(previos: Turno[]): TurnoHistorial[] {
    const h: TurnoHistorial[] = [];
    for (const t of previos) {
      if (!t.respuesta) continue;
      h.push({ rol: 'vendedora', texto: t.pregunta });
      h.push({ rol: 'ivi', texto: t.respuesta.texto });
    }
    return h;
  }

  /**
   * Manda la pregunta del turno `indice` y deja el resultado ahí mismo.
   *
   * El `indice` es explícito —y no «el último»— porque reintentar tiene que poder rehacer un
   * turno del medio **sin borrar los de abajo**: si la vendedora siguió preguntando después
   * de un fallo y después toca «Reintentar» en aquél, perdería todo lo que vino después. El
   * contexto que viaja, en cambio, sí es solo el de ARRIBA del turno: mandarle a Ivi como
   * antecedente una respuesta que todavía no existía sería inventarle el orden.
   */
  function lanzar(pregunta: string, indice: number, contexto: Turno[]) {
    setTurnos((t) => {
      const nuevos = [...t];
      nuevos[indice] = { pregunta, respuesta: null, error: null };
      return nuevos;
    });
    const dejar = (cambio: Partial<Turno>) =>
      setTurnos((t) => t.map((x, i) => (i === indice ? { ...x, ...cambio } : x)));
    preguntar.mutate(
      { pregunta, historial: historial(contexto) },
      {
        onSuccess: (respuesta) => dejar({ respuesta }),
        // Fail-closed: el fallo se guarda como fallo. NUNCA se convierte en una respuesta
        // vacía ni en un «Ivi no encontró datos».
        onError: (error) => dejar({ error }),
      },
    );
  }

  /**
   * La ÚNICA salida hacia Ivi. La condición no se evalúa acá: la da `motivoParaNoPreguntar`,
   * la misma que apaga el botón. Cuando estaban separadas, `⌘↵` se saltaba el tope.
   */
  function enviar() {
    if (motivoParaNoPreguntar(texto, preguntar.isPending)) return;
    setTexto('');
    lanzar(texto.trim(), turnos.length, turnos);
  }

  function reintentar(indice: number) {
    const turno = turnos[indice];
    if (!turno || preguntar.isPending) return;
    lanzar(turno.pregunta, indice, turnos.slice(0, indice));
  }

  const sobrante = texto.length - MAX_CARACTERES_PREGUNTA;
  const noSale = motivoParaNoPreguntar(texto, preguntar.isPending);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-navy/20 sm:p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Preguntarle a Ivi"
    >
      <div
        className="flex h-dvh w-full flex-col overflow-hidden bg-card shadow-panel animate-entrar sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[27rem] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <BrainCircuit size={16} strokeWidth={2.1} className="shrink-0 text-navy-ink" />
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-sm font-bold leading-tight text-navy-ink">Preguntarle a Ivi</h2>
            <p className="truncate text-[10px] leading-tight text-muted-foreground">
              El cerebro de Goberna. Responde con datos del negocio.
            </p>
          </div>
          {turnos.length > 0 && (
            <button
              type="button"
              onClick={() => setTurnos([])}
              className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors duration-200 ease-house hover:bg-muted hover:text-foreground"
            >
              Limpiar
            </button>
          )}
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-200 ease-house hover:text-foreground"
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {turnos.length === 0 && (
            <section className="animate-entrar">
              <p className="text-[11px] leading-snug text-foreground">
                Ivi contesta con lo que hay en los datos del negocio.{' '}
                <strong className="font-semibold">Si no tiene con qué, te lo dice</strong> en vez de
                inventarlo — y cada respuesta viene marcada con de dónde salió.
              </p>
              <Leyenda />
              <p className="mt-3 text-[10px] font-semibold text-muted-foreground">Probá con algo así:</p>
              <div className="mt-1.5 flex flex-col gap-1">
                {EJEMPLOS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      setTexto(e);
                      caja.current?.focus();
                    }}
                    className="rounded-lg border border-border px-2 py-1.5 text-left text-[11px] leading-snug text-muted-foreground transition-colors duration-200 ease-house hover:border-primary/40 hover:text-foreground"
                  >
                    {e}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
                Lo que Ivi responde es para vos: no se manda solo, y no hay un botón que lo pase al chat
                de un lead.
              </p>
            </section>
          )}

          {turnos.map((t, i) => (
            <section key={i} className="space-y-2">
              <p className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-navy px-2.5 py-1.5 text-[11px] leading-snug text-white">
                {t.pregunta}
              </p>
              {t.respuesta && <RespuestaDeIvi respuesta={t.respuesta} />}
              {t.error != null && <FalloDeIvi error={t.error} onReintentar={() => reintentar(i)} />}
              {!t.respuesta && t.error == null && preguntar.isPending && <Buscando />}
            </section>
          ))}
          <div ref={fondo} />
        </div>

        <footer className="shrink-0 border-t border-border p-2.5">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-muted/40 px-2.5 py-2 transition-colors duration-200 ease-house focus-within:border-primary/50">
            <textarea
              ref={caja}
              value={texto}
              rows={2}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                // ⌘↵ manda (la convención de toda la industria, y la misma que la revisión).
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  enviar();
                  return;
                }
                // Enter suelto NO manda: acá se escriben preguntas largas, no mensajes.
                // Escape con texto borra el borrador; vacío, cierra. Es el «Escape es del
                // campo» de la casa, un paso más allá.
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  if (texto) setTexto('');
                  else onCerrar();
                }
              }}
              placeholder="Preguntale algo del negocio…"
              className="max-h-32 min-h-0 w-full resize-none bg-transparent text-xs leading-snug outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={enviar}
              disabled={noSale !== null}
              aria-label="Preguntarle a Ivi"
              className="mb-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-navy text-white transition-transform duration-200 ease-house active:scale-[0.94] disabled:cursor-default disabled:bg-muted disabled:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <SendHorizontal size={13} />
            </button>
          </div>
          <p className="mt-1 flex items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground">
            <span>
              <kbd className="rounded bg-muted px-1 font-mono font-semibold">⌘↵</kbd> para preguntar
            </span>
            {sobrante > 0 && (
              <span className="font-semibold text-destructive">{sobrante} caracteres de más</span>
            )}
          </p>
        </footer>
      </div>
    </div>
  );
}
