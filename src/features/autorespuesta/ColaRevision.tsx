import { AlertTriangle, Check, Clock, Inbox, X } from 'lucide-react';
import { comoSeLlama, haceCuanto, vencimiento, type GrupoBandeja, type MensajeBandeja } from './bandeja';
import type { ResultadoAprobar } from './datos';
import { horaCorta } from './estado';
import { paso } from './revision';

/**
 * LA COLA, EN MODO REVISIÓN — la columna izquierda cuando se revisan las
 * sugerencias (ADR 0018).
 *
 * ── Por qué ocupa el lugar de la cola y no es una hoja encima ──
 * Porque revisar una sugerencia ES mirar una conversación. Lo que ADR 0016 puso
 * en una hoja modal —el texto, el nombre, cuánto esperó— se leía sin ver **a
 * quién** se le manda ni **qué había preguntado**: la vendedora aprobaba a
 * ciegas o abría el chat aparte y perdía el lugar. Acá la lista se corre a la
 * izquierda, la conversación real queda en el medio y el porqué a la derecha.
 * Es la mesa de siempre, filtrada a lo que hay que decidir.
 *
 * ── Por qué sigue agrupada por campaña ──
 * Es el argumento de ADR 0016 y no caducó: mismo texto, misma promesa, misma
 * gente. Lo que cambia es que ahora el texto no se lee en la lista —se lee en el
 * composer, una vez por campaña, mientras se recorre el grupo—. La cabecera del
 * grupo conserva el **lote**, que es de primera clase: «los 8 de Inteligencia»
 * se aprueban de un golpe.
 *
 * ── El lote global no existe, y es a propósito ──
 * Hay «Descartar todo» pero **no** «Aprobar todo». No es simetría rota por
 * descuido: descartar no le llega a nadie y se paga con trabajo perdido;
 * aprobar 40 mensajes de 5 campañas sin haber leído 5 textos es el modo
 * automático con pasos de más. El lote existe **dentro** de una campaña, que es
 * donde la vendedora acaba de leer el texto que se manda.
 *
 * ── El oro ──
 * En un solo lugar: lo que está por caducar. En Hermes el dorado significa
 * tiempo que se acaba y una preparada caduca sola. En tres filas de cuarenta es
 * información; en las cuarenta sería decoración.
 */
export function ColaRevision({
  grupos,
  fila,
  actualId,
  cargando,
  error,
  trabajando,
  recibo,
  onElegir,
  onAprobarGrupo,
  onDescartarTodo,
  onCerrarRecibo,
  onSalir,
}: {
  grupos: readonly GrupoBandeja[];
  fila: readonly MensajeBandeja[];
  actualId: number | null;
  cargando: boolean;
  error: string | null;
  trabajando: boolean;
  recibo: ResultadoAprobar | null;
  onElegir: (m: MensajeBandeja) => void;
  onAprobarGrupo: (ids: number[], campana: string) => void;
  onDescartarTodo: () => void;
  onCerrarRecibo: () => void;
  onSalir: () => void;
}) {
  const donde = paso(fila, actualId);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-navy/30 bg-card shadow-panel">
      {/* ── CABECERA: dónde estoy y cómo salgo ── */}
      <header className="shrink-0 border-b border-border bg-navy px-3 py-2 text-white">
        <div className="flex items-center gap-2">
          <Inbox size={14} className="shrink-0" />
          <h2 className="font-heading text-xs font-bold">Revisión</h2>
          {donde.total > 0 && (
            <span className="rounded-full bg-white/15 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
              {donde.actual} de {donde.total}
            </span>
          )}
          <button
            type="button"
            onClick={onSalir}
            title="Salir de la revisión · Esc"
            className="ml-auto flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 font-mono text-[10px] transition-colors duration-200 ease-house hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
          >
            Salir <X size={11} />
          </button>
        </div>
        <p className="mt-1 text-[10px] leading-tight text-white/70">
          Nada de esto salió. Lo que apruebes entra a la cola espaciada —una cada 1 a 4 min— y se cancela sola si
          contestás vos primero.
        </p>
      </header>

      {recibo && <Recibo r={recibo} onCerrar={onCerrarRecibo} />}

      {/* ── EL CUERPO ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {cargando && <Esqueleto />}
        {error && (
          <p className="m-3 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-[11px] font-semibold text-destructive">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {!cargando && !error && grupos.length === 0 && <Vacio />}

        {grupos.map((g) => (
          <Grupo
            key={g.campana}
            grupo={g}
            actualId={actualId}
            trabajando={trabajando}
            onElegir={onElegir}
            onAprobarGrupo={onAprobarGrupo}
          />
        ))}
      </div>

      {/* ── EL PIE: la única acción de lote global, y es la barata ── */}
      {grupos.length > 0 && (
        <footer className="shrink-0 border-t border-border px-3 py-2">
          <button
            type="button"
            disabled={trabajando}
            onClick={onDescartarTodo}
            className="rounded-lg px-1.5 py-1 font-mono text-[10px] font-semibold text-muted-foreground transition-colors duration-200 ease-house hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50"
          >
            Descartar todo ({fila.length})
          </button>
        </footer>
      )}
    </div>
  );
}

/** UNA CAMPAÑA: la cabecera con su lote, y adentro la gente. */
function Grupo({
  grupo,
  actualId,
  trabajando,
  onElegir,
  onAprobarGrupo,
}: {
  grupo: GrupoBandeja;
  actualId: number | null;
  trabajando: boolean;
  onElegir: (m: MensajeBandeja) => void;
  onAprobarGrupo: (ids: number[], campana: string) => void;
}) {
  const ids = grupo.mensajes.map((m) => m.id);
  const ordenados = [...grupo.mensajes].sort((a, b) => b.esperandoMinutos - a.esperandoMinutos);

  return (
    <section>
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-secondary/95 px-3 py-1.5 backdrop-blur-sm">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-[11px] font-bold text-navy">{grupo.campana}</h3>
          <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {ids.length} {ids.length === 1 ? 'persona' : 'personas'}
          </p>
        </div>
        <button
          type="button"
          disabled={trabajando}
          onClick={() => onAprobarGrupo(ids, grupo.campana)}
          title={`Aprobar las ${ids.length} de ${grupo.campana}. Salen espaciadas, no juntas.`}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-navy/10 px-2 py-1 text-[10px] font-bold text-navy transition-[background-color,color,transform] duration-200 ease-house hover:bg-navy hover:text-white active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50"
        >
          <Check size={11} /> Aprobar {ids.length}
        </button>
      </header>

      <ul className="divide-y divide-border">
        {ordenados.map((m) => (
          <Fila key={m.id} m={m} activa={m.id === actualId} onElegir={() => onElegir(m)} />
        ))}
      </ul>
    </section>
  );
}

/**
 * UNA PERSONA. Dos datos y nada más: **quién** y **cuánto hace que espera**.
 *
 * Cuánto espera es el argumento para aprobar, no un adorno: en #153 el enganche
 * cae de ~20% a 0,7% cuando nadie responde. Por eso está en el renglón de abajo
 * en monoespaciada y no escondido en un `title`.
 */
function Fila({ m, activa, onElegir }: { m: MensajeBandeja; activa: boolean; onElegir: () => void }) {
  const v = vencimiento(m.caducaEn, new Date());
  const escribioA = horaCorta(new Date(m.disparadaPor));

  return (
    <li>
      <button
        type="button"
        onClick={onElegir}
        aria-current={activa ? 'true' : undefined}
        className={
          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-200 ease-house focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ' +
          (activa ? 'bg-secondary' : 'hover:bg-muted/60')
        }
      >
        {/* La marca de «acá estoy»: una barra, no un fondo de color más — el
            fondo ya se usa para el hover y dos señales de fondo se confunden. */}
        <span
          className={'h-7 w-[3px] shrink-0 rounded-full ' + (activa ? 'bg-navy' : 'bg-transparent')}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">{comoSeLlama(m)}</p>
          <p className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
            escribió {escribioA} · {haceCuanto(m.esperandoMinutos)}
          </p>
        </div>

        {/* EL ORO, y solo acá: lo que está por caducar. */}
        {v.apura && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-md bg-gold/15 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-gold-ink"
            title="Si nadie la aprueba, caduca sola y esa persona no recibe nada."
          >
            <Clock size={10} /> {v.texto}
          </span>
        )}
      </button>
    </li>
  );
}

function Vacio() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-secondary text-navy">
        <Inbox size={18} />
      </div>
      <p className="text-sm font-bold text-foreground">No queda nada por revisar.</p>
      <p className="max-w-[16rem] text-[11px] leading-relaxed text-muted-foreground">
        Despachaste todo. La cola vuelve a prepararse esta noche, con quien escriba fuera de horario y no reciba
        respuesta en 30 minutos.
      </p>
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-2 p-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}

/**
 * EL RECIBO — a qué hora sale lo que se acaba de aprobar, y qué no entró.
 *
 * Aprobar no manda: programa. Sin decir la hora, la vendedora abre el hilo,
 * no ve el mensaje, y concluye que no funcionó. Y lo que NO entró (porque
 * caducó, o porque otra vendedora lo tomó, o porque se llenó el techo de la
 * hora) vuelve con su motivo en vez de desaparecer en silencio — un lote que
 * dice «12 aprobadas» habiendo entrado 9 es la clase de mentira que se descubre
 * tres días después.
 */
function Recibo({ r, onCerrar }: { r: ResultadoAprobar; onCerrar: () => void }) {
  const horas = r.programadas.map((p) => new Date(p.programadoPara).getTime()).sort((a, b) => a - b);
  const desde = horas[0] ? horaCorta(new Date(horas[0])) : null;
  const hasta = horas.length > 1 ? horaCorta(new Date(horas[horas.length - 1])) : null;

  return (
    <div className="shrink-0 border-b border-success/30 bg-success/10 px-3 py-2 duration-300 ease-house animate-in fade-in slide-in-from-top-1">
      <div className="flex items-start gap-2">
        <Check size={13} className="mt-0.5 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-foreground">
            {r.aprobadas} {r.aprobadas === 1 ? 'aprobada' : 'aprobadas'}
            {desde && (
              <span className="font-normal text-muted-foreground">
                {' — '}
                {hasta ? `salen entre ${desde} y ${hasta}` : `sale ${desde}`}, una por vez
              </span>
            )}
          </p>
          {r.noEntran.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {r.noEntran.map((n) => (
                <li key={n.id} className="font-mono text-[10px] leading-tight text-warning-foreground">
                  · no entró #{n.id}: {n.motivo}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar el aviso"
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
