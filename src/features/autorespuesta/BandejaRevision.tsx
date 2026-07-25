import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Inbox,
  Loader2,
  Pencil,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  comoSeLlama,
  haceCuanto,
  idsDeGrupos,
  resumenDeSeleccion,
  vencimiento,
  type GrupoBandeja,
  type MensajeBandeja,
} from './bandeja';
import { useBandeja, type ResultadoAprobar } from './datos';
import { horaCorta } from './estado';

/**
 * LA BANDEJA DE REVISIÓN — la pantalla que convierte el 33% perdido en
 * respuestas (#125 · ADR 0016).
 *
 * ── Por qué es una hoja y no una vista del riel ──
 * El riel es para LUGARES: seis vistas donde se vive (ADR 0002, ⌘1-6). Esto es
 * una TAREA modal de dos minutos por día: se entra, se despacha, se sale. Una
 * séptima vista permanente para algo que se usa dos minutos diluiría el mapa y
 * dejaría un ícono apagado 23 horas y 58 minutos. Además, la puerta correcta ya
 * existe: el chip de la cabecera es el que anuncia «12 esperando tu OK», y el
 * anuncio y la acción tienen que estar en el mismo lugar — si no, la vendedora
 * lee el número y después tiene que salir a buscar dónde se hace algo con él.
 * Se abre desde cualquier vista (a las 9 de la mañana puede estar en cualquiera)
 * con el botón del chip o con la tecla **A**.
 *
 * ── Por qué agrupada por campaña ──
 * Porque es como se decide. «Los 12 de Inteligencia» se aprueban de un vistazo:
 * mismo texto, misma promesa, misma gente. Una lista plana de 40 obligaría a
 * leer 40 veces el mismo mensaje, y a los 10 la vendedora aprueba sin leer —que
 * es peor que el modo automático, porque encima cree que revisó.
 *
 * El texto se muestra UNA vez por grupo (es el mismo salvo el nombre) y cada
 * fila es una línea: quién, de dónde vino, cuánto hace que espera y cuánto le
 * queda. Quien quiere ver o cambiar SU texto, lo despliega.
 *
 * ── Dónde está el oro ──
 * En un solo lugar: el «vence en 20 min» de lo que está por caducar. En Hermes
 * el dorado significa tiempo que se acaba y acá hay algo que literalmente lo es.
 * En tres filas de cuarenta es información; en las cuarenta sería decoración.
 */
export function BandejaRevision({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const { datos, cargando, error, aprobar, descartar } = useBandeja(abierta);
  const [seleccion, setSeleccion] = useState<ReadonlySet<number>>(new Set());
  const [textos, setTextos] = useState<Record<number, string>>({});
  const [abierto, setAbierto] = useState<number | null>(null);
  const [resultado, setResultado] = useState<ResultadoAprobar | null>(null);

  const grupos = datos?.grupos ?? [];
  const todos = idsDeGrupos(grupos);

  // Al cerrar se olvida todo: una selección vieja aplicada sobre una bandeja
  // nueva aprobaría mensajes que la vendedora nunca vio.
  useEffect(() => {
    if (!abierta) {
      setSeleccion(new Set());
      setTextos({});
      setAbierto(null);
      setResultado(null);
    }
  }, [abierta]);

  useEffect(() => {
    if (!abierta) return;
    const alTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTecla);
    return () => window.removeEventListener('keydown', alTecla);
  }, [abierta, onCerrar]);

  if (!abierta) return null;

  const marcar = (ids: readonly number[], puesto: boolean) => {
    const proximo = new Set(seleccion);
    for (const id of ids) {
      if (puesto) proximo.add(id);
      else proximo.delete(id);
    }
    setSeleccion(proximo);
  };

  const resumen = resumenDeSeleccion(grupos, seleccion);
  const trabajando = aprobar.isPending || descartar.isPending;

  const aprobarIds = (ids: number[]) => {
    if (ids.length === 0) return;
    const editados: Record<string, string> = {};
    for (const id of ids) if (textos[id]?.trim()) editados[String(id)] = textos[id].trim();
    aprobar.mutate(
      { ids, ...(Object.keys(editados).length > 0 ? { textos: editados } : {}) },
      {
        onSuccess: (r) => {
          setResultado(r);
          setSeleccion(new Set());
        },
      },
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Revisión de auto-respuestas"
          className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-card shadow-panel animate-entrar"
        >
          {/* ── CABECERA: qué es esto y por qué no salió todavía ── */}
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-navy px-5 py-3 text-white">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 font-heading text-sm font-bold">
                <Inbox size={16} /> Revisión de auto-respuestas
                {datos && (
                  <span className="rounded-full bg-white/15 px-2 py-0.5 font-mono text-[11px] tabular-nums">
                    {datos.total}
                  </span>
                )}
              </h2>
              <p className="mt-0.5 text-[11px] leading-tight text-white/70">
                Nada de esto salió todavía. Lo que apruebes sale espaciado —uno cada 1 a 4 minutos— y se
                cancela solo si contestás vos primero.
              </p>
            </div>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onCerrar}
              className="shrink-0 rounded-lg p-1 transition-colors hover:bg-white/10"
            >
              <X size={16} />
            </button>
          </header>

          {/* ── BARRA DE LOTE: el «todo» de primera clase ── */}
          {grupos.length > 0 && (
            <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/60 px-5 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-foreground">
                <input
                  type="checkbox"
                  className="size-3.5 accent-navy"
                  checked={seleccion.size > 0 && seleccion.size === todos.length}
                  ref={(el) => {
                    if (el) el.indeterminate = seleccion.size > 0 && seleccion.size < todos.length;
                  }}
                  onChange={(e) => marcar(todos, e.target.checked)}
                />
                Seleccionar las {todos.length}
              </label>
              <span className="font-mono text-[11px] text-muted-foreground">{resumen ?? 'nada seleccionado'}</span>
              {datos?.modo && datos.modo !== 'supervisada' && (
                <span className="ml-auto flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning-foreground">
                  <AlertTriangle size={11} /> la auto-respuesta está en «{datos.modo}»: acá solo queda lo de antes
                </span>
              )}
            </div>
          )}

          {/* ── EL CUERPO ── */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {resultado && <Recibo r={resultado} onCerrar={() => setResultado(null)} />}

            {cargando && <Esqueleto />}
            {error && <Aviso tono="error" texto={error} />}
            {datos?.sinTablas && <Aviso tono="error" texto={datos.mensaje ?? 'faltan las tablas de la auto-respuesta'} />}

            {!cargando && !error && grupos.length === 0 && <Vacio modo={datos?.modo} />}

            <div className="flex flex-col gap-4">
              {grupos.map((g) => (
                <Grupo
                  key={g.campana}
                  grupo={g}
                  ahora={datos?.ahora ? new Date(datos.ahora) : new Date()}
                  seleccion={seleccion}
                  textos={textos}
                  abierto={abierto}
                  trabajando={trabajando}
                  onMarcar={marcar}
                  onAbrir={setAbierto}
                  onEditar={(id, v) => setTextos({ ...textos, [id]: v })}
                  onAprobar={aprobarIds}
                  onDescartar={(ids) => descartar.mutate({ ids })}
                />
              ))}
            </div>
          </div>

          {/* ── EL PIE: la acción de lote, siempre a la vista ── */}
          {grupos.length > 0 && (
            <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-card px-5 py-3">
              <button
                type="button"
                disabled={trabajando}
                onClick={() => descartar.mutate({ todas: true })}
                className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                Descartar todo ({todos.length})
              </button>

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  disabled={seleccion.size === 0 || trabajando}
                  onClick={() => descartar.mutate({ ids: [...seleccion] })}
                  className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-40"
                >
                  <Trash2 size={13} /> Descartar
                </button>
                <button
                  type="button"
                  disabled={seleccion.size === 0 || trabajando}
                  onClick={() => aprobarIds([...seleccion])}
                  className="flex items-center gap-2 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
                >
                  {trabajando ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Aprobar {resumen ? `— ${resumen}` : ''}
                </button>
              </div>
            </footer>
          )}
        </div>
      </div>
    </>
  );
}

/** UNA CAMPAÑA: el texto una vez, la gente en una línea cada uno. */
function Grupo({
  grupo,
  ahora,
  seleccion,
  textos,
  abierto,
  trabajando,
  onMarcar,
  onAbrir,
  onEditar,
  onAprobar,
  onDescartar,
}: {
  grupo: GrupoBandeja;
  ahora: Date;
  seleccion: ReadonlySet<number>;
  textos: Record<number, string>;
  abierto: number | null;
  trabajando: boolean;
  onMarcar: (ids: readonly number[], puesto: boolean) => void;
  onAbrir: (id: number | null) => void;
  onEditar: (id: number, v: string) => void;
  onAprobar: (ids: number[]) => void;
  onDescartar: (ids: number[]) => void;
}) {
  const ids = grupo.mensajes.map((m) => m.id);
  const puestos = ids.filter((id) => seleccion.has(id)).length;
  const muestra = grupo.mensajes[0];

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border bg-secondary/60 px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Seleccionar los ${ids.length} de ${grupo.campana}`}
          className="size-3.5 accent-navy"
          checked={puestos === ids.length}
          ref={(el) => {
            if (el) el.indeterminate = puestos > 0 && puestos < ids.length;
          }}
          onChange={(e) => onMarcar(ids, e.target.checked)}
        />
        <div className="min-w-0">
          <h3 className="truncate font-heading text-xs font-bold text-navy">{grupo.campana}</h3>
          <p className="font-mono text-[10px] text-muted-foreground">
            {ids.length} {ids.length === 1 ? 'persona' : 'personas'} · {grupo.plantillaId}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={trabajando}
            onClick={() => onDescartar(ids)}
            className="rounded-lg px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
          >
            Descartar
          </button>
          <button
            type="button"
            disabled={trabajando}
            onClick={() => onAprobar(ids)}
            className="flex items-center gap-1 rounded-lg bg-navy/10 px-2 py-1 text-[10px] font-bold text-navy transition-colors hover:bg-navy hover:text-white disabled:opacity-50"
          >
            <Check size={11} /> Aprobar {ids.length}
          </button>
        </div>
      </header>

      {/* EL TEXTO, UNA VEZ. Es el mismo para todo el grupo salvo el nombre; verlo
          cuarenta veces es lo que hace que se deje de leer. */}
      {muestra && (
        <blockquote className="border-b border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Se le manda:</span> «{muestra.texto}»
        </blockquote>
      )}

      <ul className="divide-y divide-border">
        {grupo.mensajes.map((m) => (
          <Fila
            key={m.id}
            m={m}
            ahora={ahora}
            puesto={seleccion.has(m.id)}
            texto={textos[m.id]}
            expandida={abierto === m.id}
            trabajando={trabajando}
            onMarcar={(v) => onMarcar([m.id], v)}
            onAbrir={() => onAbrir(abierto === m.id ? null : m.id)}
            onEditar={(v) => onEditar(m.id, v)}
            onAprobar={() => onAprobar([m.id])}
            onDescartar={() => onDescartar([m.id])}
          />
        ))}
      </ul>
    </section>
  );
}

/** UNA PERSONA: quién, cuánto hace que espera, cuánto le queda. Una línea. */
function Fila({
  m,
  ahora,
  puesto,
  texto,
  expandida,
  trabajando,
  onMarcar,
  onAbrir,
  onEditar,
  onAprobar,
  onDescartar,
}: {
  m: MensajeBandeja;
  ahora: Date;
  puesto: boolean;
  texto: string | undefined;
  expandida: boolean;
  trabajando: boolean;
  onMarcar: (v: boolean) => void;
  onAbrir: () => void;
  onEditar: (v: string) => void;
  onAprobar: () => void;
  onDescartar: () => void;
}) {
  const v = vencimiento(m.caducaEn, ahora);
  const editado = texto !== undefined && texto.trim() !== m.texto;

  return (
    <li className={'transition-colors ' + (puesto ? 'bg-secondary/40' : 'hover:bg-muted/50')}>
      <div className="flex items-center gap-3 px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Seleccionar el mensaje para ${comoSeLlama(m)}`}
          className="size-3.5 shrink-0 accent-navy"
          checked={puesto}
          onChange={(e) => onMarcar(e.target.checked)}
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {comoSeLlama(m)}
            {editado && (
              <span className="ml-1.5 rounded bg-navy/10 px-1 py-px font-mono text-[9px] font-bold text-navy">
                editado
              </span>
            )}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {m.telefono} · escribió {haceCuanto(m.esperandoMinutos)}
          </p>
        </div>

        {/* EL ORO, y solo acá: lo que está por caducar. */}
        <span
          className={
            'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums ' +
            (v.apura ? 'bg-gold/15 font-bold text-gold-ink' : 'text-muted-foreground')
          }
          title={`Si nadie la aprueba, caduca sola. Su turno reservado era ${horaCorta(new Date(m.programadoPara))}.`}
        >
          <Clock size={10} /> {v.texto}
        </span>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onAbrir}
            aria-expanded={expandida}
            title="Ver y editar el texto"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-navy"
          >
            {expandida ? <ChevronDown size={13} /> : <Pencil size={13} />}
          </button>
          <button
            type="button"
            disabled={trabajando}
            onClick={onDescartar}
            title="Descartar esta"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            disabled={trabajando}
            onClick={onAprobar}
            title="Aprobar esta"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-navy hover:text-white disabled:opacity-50"
          >
            <Check size={13} />
          </button>
        </div>
      </div>

      {expandida && (
        <div className="px-3 pb-3 pl-9">
          <textarea
            value={texto ?? m.texto}
            onChange={(e) => onEditar(e.target.value)}
            rows={4}
            maxLength={1000}
            className="w-full resize-y rounded-lg border border-input bg-card px-2.5 py-2 text-[11px] leading-relaxed text-foreground outline-none focus-visible:border-primary"
          />
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            Lo que quede acá es exactamente lo que se manda. Sigue diciendo que es automático solo si vos lo dejás.
          </p>
        </div>
      )}
    </li>
  );
}

/** EL RECIBO: qué se aprobó, entre qué horas sale, y qué no entró y por qué. */
function Recibo({ r, onCerrar }: { r: ResultadoAprobar; onCerrar: () => void }) {
  const horas = r.programadas.map((p) => new Date(p.programadoPara).getTime()).sort((a, b) => a - b);
  const desde = horas[0] ? horaCorta(new Date(horas[0])) : null;
  const hasta = horas.length > 1 ? horaCorta(new Date(horas[horas.length - 1])) : null;

  return (
    <div className="mb-4 rounded-xl border border-success/30 bg-success/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Check size={14} className="mt-0.5 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-foreground">
            {r.aprobadas} {r.aprobadas === 1 ? 'aprobada' : 'aprobadas'}
            {desde && (
              <span className="ml-1 font-normal text-muted-foreground">
                — {hasta ? `salen entre las ${desde} y las ${hasta}` : `sale a las ${desde}`}, una por vez
              </span>
            )}
          </p>
          {r.noEntran.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {r.noEntran.map((n) => (
                <li key={n.id} className="font-mono text-[10px] text-warning-foreground">
                  · #{n.id}: {n.motivo}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" onClick={onCerrar} aria-label="Cerrar el aviso" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

function Vacio({ modo }: { modo?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-secondary text-navy">
        <Inbox size={20} />
      </div>
      <p className="text-sm font-bold text-foreground">No hay nada esperando tu OK.</p>
      <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
        {modo === 'supervisada'
          ? 'La cola prepara respuestas para quien escribe fuera de horario y nadie atiende en 30 minutos. Si anoche no entró nadie, esto queda vacío — y está bien.'
          : 'La bandeja se llena con la auto-respuesta en modo supervisada. Cambiala en el chip de arriba.'}
      </p>
    </div>
  );
}

function Aviso({ tono, texto }: { tono: 'error'; texto: string }) {
  return (
    <div
      className={
        'mb-4 flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] ' +
        (tono === 'error' ? 'bg-destructive/10 text-destructive' : '')
      }
    >
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span className="font-semibold">{texto}</span>
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
