import { useDeferredValue, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageCircle,
  Search,
  ShieldOff,
} from 'lucide-react';
import { fechaCorta, formatoTelefono } from '../../lib/formato';
import { BarraReparto } from './BarraReparto';
import {
  usePadron,
  useRepartoPadron,
  type ContactoPadron,
  type FiltrosPadron,
} from './padron';

/**
 * EL PADRÓN — 72.923 contactos que nunca escribieron, en una tabla.
 *
 * ── Qué pregunta responde, y por qué no es la cola ──
 * La cola ordena por urgencia a quien YA escribió. Acá no hay urgencia: nadie
 * escribió. La pregunta es «¿a quiénes les hablamos ahora?», y se responde
 * recortando (país, curso, si compró) y repartiendo. Por eso es una tabla densa
 * y no una lista de tarjetas: se lee comparando renglones, no de a uno.
 *
 * ── Dos pantallas, una ruta ──
 * El supervisor ve el padrón entero y reparte. La vendedora ve **lo que le
 * habilitaron**, sin filtros de universo — no hay universo que recortar. Quién
 * es quién lo decide el server y llega en `supervisor`: acá no se decide nada,
 * se dibuja lo que vino.
 */
export function PantallaPadron({ onEscribir }: { onEscribir?: (telefono: string) => void }) {
  const [texto, setTexto] = useState('');
  const [filtros, setFiltros] = useState<FiltrosPadron>({ pagina: 1, porPagina: 50 });
  const [seleccion, setSeleccion] = useState<number[]>([]);

  // El texto se difiere: escribir «gonzález» son ocho requests si cada tecla
  // dispara una consulta sobre 72.923 filas.
  const q = useDeferredValue(texto);
  const { data, isPending, isError, error, isFetching } = usePadron({ ...filtros, q: q.trim() || undefined });
  const soySupervisor = data?.supervisor ?? false;
  const reparto = useRepartoPadron(soySupervisor);

  function cambiar(parcial: Partial<FiltrosPadron>) {
    // Cualquier cambio de filtro vuelve a la página 1: quedarse en la 7 de un
    // recorte que ahora tiene 2 páginas muestra una tabla vacía sin motivo.
    setFiltros((f) => ({ ...f, ...parcial, pagina: 1 }));
    setSeleccion([]);
  }

  const contactos = data?.contactos ?? [];
  const total = data?.total ?? 0;
  const porPagina = data?.porPagina ?? 50;
  const paginaActual = data?.paginaActual ?? 1;
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  const todosDeLaPagina = contactos.map((c) => c.id);
  const todaLaPaginaElegida =
    todosDeLaPagina.length > 0 && todosDeLaPagina.every((id) => seleccion.includes(id));

  if (isError) {
    return (
      <Aviso
        tono="error"
        titulo="No se pudo leer el padrón"
        // «no se pudo preguntar» ≠ «no hay». Es la cicatriz de ADR 0023: una
        // lista vacía acá se leería como que no hay contactos, y son 72.923.
        detalle={error instanceof Error ? error.message : 'El padrón no respondió.'}
      />
    );
  }

  if (data?.sinSupervisores) {
    return (
      <Aviso
        tono="aviso"
        titulo="Todavía nadie puede repartir el padrón"
        detalle="No hay ningún supervisor configurado en el server, así que nadie ve la lista completa. Se configura en el entorno de Hermes (HERMES_SUPERVISORES) y hace falta reiniciar."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[16rem] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setFiltros((f) => ({ ...f, pagina: 1 }));
              }}
              placeholder="Nombre, teléfono, correo o DNI"
              className="w-full rounded-full border border-border bg-muted py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
          </label>

          {soySupervisor && (
            <>
              <Chip
                activo={filtros.sinHabilitar === true}
                onClick={() => cambiar({ sinHabilitar: !filtros.sinHabilitar || undefined })}
              >
                Sin repartir
              </Chip>
              <Chip
                activo={filtros.conVenta === true}
                onClick={() => cambiar({ conVenta: !filtros.conVenta || undefined })}
                titulo="Los que tienen una venta de verdad, no los que dicen tenerla"
              >
                Ya compraron
              </Chip>
              <Chip
                activo={filtros.conTelefono === true}
                onClick={() => cambiar({ conTelefono: !filtros.conTelefono || undefined })}
              >
                Con teléfono
              </Chip>
              <select
                value={filtros.orden ?? 'recientes'}
                onChange={(e) => cambiar({ orden: e.target.value as FiltrosPadron['orden'] })}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
              >
                <option value="recientes">Más nuevos</option>
                <option value="antiguos">Más antiguos</option>
                <option value="mas_gastaron">Los que más gastaron</option>
                <option value="nombre">Por nombre</option>
              </select>
            </>
          )}
        </div>

        <p className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          {isFetching && <Loader2 size={11} className="animate-spin" />}
          {soySupervisor ? (
            <>
              <span className="font-semibold tabular-nums text-foreground">{total.toLocaleString('es')}</span>{' '}
              {total === 1 ? 'contacto' : 'contactos'} en este recorte
              {/* El aviso de la regla dura #7: cuántos NO se están viendo. */}
              {total > porPagina && (
                <span className="text-muted-foreground">
                  · se ven {contactos.length} en esta página
                </span>
              )}
            </>
          ) : (
            <>
              <span className="font-semibold tabular-nums text-foreground">{total.toLocaleString('es')}</span>{' '}
              {total === 1 ? 'contacto habilitado para vos' : 'contactos habilitados para vos'}
            </>
          )}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : contactos.length === 0 ? (
          <Vacio soySupervisor={soySupervisor} hayFiltro={Boolean(q.trim()) || tieneFiltros(filtros)} />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                {soySupervisor && (
                  <th className="w-9 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Elegir toda la página"
                      checked={todaLaPaginaElegida}
                      onChange={(e) =>
                        setSeleccion((prev) =>
                          e.target.checked
                            ? [...new Set([...prev, ...todosDeLaPagina])]
                            : prev.filter((id) => !todosDeLaPagina.includes(id)),
                        )
                      }
                      className="size-3.5 accent-navy"
                    />
                  </th>
                )}
                <th className="px-3 py-2 font-semibold">Quién</th>
                <th className="px-3 py-2 font-semibold">Teléfono</th>
                <th className="px-3 py-2 font-semibold">País</th>
                <th className="px-3 py-2 font-semibold">Curso</th>
                <th className="px-3 py-2 font-semibold">Compró</th>
                <th className="px-3 py-2 font-semibold">Entró</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {contactos.map((c) => (
                <Fila
                  key={c.id}
                  c={c}
                  elegible={soySupervisor}
                  elegido={seleccion.includes(c.id)}
                  onElegir={(on) =>
                    setSeleccion((prev) => (on ? [...prev, c.id] : prev.filter((id) => id !== c.id)))
                  }
                  onEscribir={onEscribir}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > porPagina && (
        <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border bg-card px-4 py-2 text-xs">
          <button
            type="button"
            disabled={paginaActual <= 1}
            onClick={() => setFiltros((f) => ({ ...f, pagina: (f.pagina ?? 1) - 1 }))}
            className="flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-foreground hover:bg-muted disabled:opacity-30"
          >
            <ChevronLeft size={13} /> Anterior
          </button>
          <span className="tabular-nums text-muted-foreground">
            {paginaActual} de {ultimaPagina.toLocaleString('es')}
          </span>
          <button
            type="button"
            disabled={paginaActual >= ultimaPagina}
            onClick={() => setFiltros((f) => ({ ...f, pagina: (f.pagina ?? 1) + 1 }))}
            className="flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-foreground hover:bg-muted disabled:opacity-30"
          >
            Siguiente <ChevronRight size={13} />
          </button>
        </div>
      )}

      {soySupervisor && (
        <BarraReparto
          seleccion={seleccion}
          destinos={reparto.data?.destinos ?? []}
          carga={reparto.data?.carga ?? []}
          onListo={() => setSeleccion([])}
          onLimpiar={() => setSeleccion([])}
        />
      )}
    </div>
  );
}

function tieneFiltros(f: FiltrosPadron): boolean {
  return Boolean(f.conVenta || f.conTelefono || f.sinHabilitar || f.pais || f.curso || f.etapa);
}

function Fila({
  c,
  elegible,
  elegido,
  onElegir,
  onEscribir,
}: {
  c: ContactoPadron;
  elegible: boolean;
  elegido: boolean;
  onElegir: (on: boolean) => void;
  onEscribir?: (telefono: string) => void;
}) {
  const telefono = (c.telefono ?? '').replace(/\D/g, '');
  return (
    <tr className={`border-b border-border/60 transition-colors ${elegido ? 'bg-primary/5' : 'hover:bg-muted/50'}`}>
      {elegible && (
        <td className="px-3 py-2">
          <input
            type="checkbox"
            aria-label={`Elegir a ${c.nombre ?? c.id}`}
            checked={elegido}
            onChange={(e) => onElegir(e.target.checked)}
            className="size-3.5 accent-navy"
          />
        </td>
      )}
      <td className="max-w-[16rem] px-3 py-2">
        <div className="truncate font-semibold text-foreground">{c.nombre ?? '—'}</div>
        {c.correo && <div className="truncate text-[11px] text-muted-foreground">{c.correo}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
        {telefono ? formatoTelefono(telefono) : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{c.pais ?? '—'}</td>
      <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-muted-foreground">{c.curso ?? '—'}</td>
      <td className="px-3 py-2">
        {/* 🔴 Verde SOLO con venta real. `compras` (el contador de icarus) miente
            en más de la mitad de los casos, así que cuando afirma sin respaldo se
            dibuja en gris y se dice de dónde salió — nunca como un cliente. */}
        {c.conVenta ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">
            <BadgeCheck size={11} /> Sí
          </span>
        ) : c.compras && c.compras > 0 ? (
          <span
            title="icarus dice que compró, pero no hay ninguna venta que lo respalde. Pasa en más de la mitad del padrón."
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            <AlertTriangle size={10} /> sin respaldo
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">
        {c.creadoEn ? fechaCorta(c.creadoEn) : '—'}
      </td>
      <td className="px-3 py-2">
        {onEscribir && telefono.length >= 8 && (
          <button
            type="button"
            onClick={() => onEscribir(telefono)}
            title="Abrir el chat con esta persona"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-navy hover:text-white"
          >
            <MessageCircle size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

function Chip({
  activo,
  onClick,
  titulo,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  titulo?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
        activo
          ? 'border-navy bg-navy text-white'
          : 'border-border bg-card text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function Vacio({ soySupervisor, hayFiltro }: { soySupervisor: boolean; hayFiltro: boolean }) {
  // Tres textos distintos para tres situaciones que se ven igual: un recorte que
  // no dio nada, un padrón sin repartir, y una vendedora sin nada habilitado.
  return (
    <div className="flex flex-col items-center gap-2 p-12 text-center">
      <ShieldOff size={26} className="text-muted-foreground/40" />
      <p className="max-w-sm text-sm text-muted-foreground">
        {hayFiltro
          ? 'Ningún contacto entra en este recorte. Probá aflojando algún filtro.'
          : soySupervisor
            ? 'El padrón no devolvió contactos.'
            : 'Todavía no te habilitaron ningún contacto. Cuando el supervisor te reparta un lote, aparece acá.'}
      </p>
    </div>
  );
}

function Aviso({ tono, titulo, detalle }: { tono: 'error' | 'aviso'; titulo: string; detalle: string }) {
  const tinta =
    tono === 'error'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : 'border-warning/40 bg-warning/10 text-warning-foreground';
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center p-8">
      <div className={`flex max-w-md items-start gap-2.5 rounded-2xl border p-4 text-sm ${tinta}`}>
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-bold">{titulo}</p>
          <p className="mt-1 text-xs leading-relaxed opacity-90">{detalle}</p>
        </div>
      </div>
    </div>
  );
}
