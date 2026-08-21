import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Loader2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import {
  nombreCorto,
  useHabilitar,
  useHabilitarRecorte,
  useQuitarDelReparto,
  type CargaVendedora,
  type FiltrosPadron,
} from './padron';
import { cuantos, necesitaConfirmar, type Seleccion } from './seleccion';

/**
 * REPARTIR EL LOTE — la barra que aparece cuando hay algo elegido.
 *
 * ⚠️ **Dice el número antes de la acción, siempre.** La regla dura #7 pide que
 * todo envío masivo se haga con la lista de destinatarios a la vista, y este es el
 * eslabón donde eso se puede perder: repartir convierte 17.014 filas en 17.014
 * conversaciones que alguien va a abrir. Por eso el botón no dice «Habilitar»
 * sino «Habilitar 12 a Ventas11», cada destino muestra cuánto tiene ya, y a
 * partir de `CONFIRMAR_DESDE` hay un paso más con la cifra escrita.
 *
 * No bloquea: repartir 17.014 es decisión del supervisor. Lo que no puede pasar
 * es que la tome sin saber que son 17.014.
 *
 * ── Dos caminos hacia la misma tabla ──
 * `lista` manda los ids; `recorte` manda el FILTRO y deja que el server resuelva
 * (700 KB de ids no viajan por la red). Cuál se usa lo decide `seleccion.modo`,
 * no un `if` sobre el tamaño.
 */
export function BarraReparto({
  seleccion,
  total,
  filtros,
  destinos,
  carga,
  onListo,
  onLimpiar,
}: {
  seleccion: Seleccion;
  /** El total del recorte: en modo `recorte` es de donde sale «cuántos». */
  total: number;
  filtros: FiltrosPadron;
  destinos: string[];
  carga: CargaVendedora[];
  onListo: () => void;
  onLimpiar: () => void;
}) {
  const [destino, setDestino] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [hecho, setHecho] = useState<{ cuantos: number; a: string } | null>(null);
  const porLista = useHabilitar();
  const porRecorte = useHabilitarRecorte();
  const quitar = useQuitarDelReparto();

  const n = cuantos(seleccion, total);

  // El acuse sobrevive a que la selección se vacíe (que es lo que pasa al
  // terminar): sin esto, repartir 17.014 contactos no deja NINGUNA señal de que
  // algo pasó — la barra simplemente desaparece.
  useEffect(() => {
    if (!hecho) return;
    const t = setTimeout(() => setHecho(null), 8000);
    return () => clearTimeout(t);
  }, [hecho]);

  if (n === 0 && !hecho) return null;

  const trabajando = porLista.isPending || porRecorte.isPending || quitar.isPending;
  const error = porLista.error ?? porRecorte.error ?? quitar.error;

  function repartir() {
    const listo = (r: { habilitados: number; vendedoraId: string }) => {
      // El número del ACUSE es el que devolvió el server, no el que teníamos en
      // la mano: el recorte se resuelve de nuevo allá y pueden haber entrado
      // contactos nuevos. Repetir la cifra vieja esconde la diferencia.
      setHecho({ cuantos: r.habilitados, a: r.vendedoraId });
      setDestino('');
      setConfirmando(false);
      onListo();
    };

    if (seleccion.modo === 'recorte') {
      porRecorte.mutate(
        { filtros, excluidos: seleccion.excluidos, vendedoraId: destino },
        { onSuccess: listo },
      );
      return;
    }
    porLista.mutate({ contactoIds: seleccion.ids, vendedoraId: destino }, { onSuccess: listo });
  }

  if (n === 0 && hecho) {
    return (
      <div className="sticky bottom-0 z-20 flex items-center gap-2 border-t border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
        <Check size={15} className="shrink-0" />
        <span className="font-semibold">
          {hecho.a
            ? `Listos ${hecho.cuantos.toLocaleString('es')} para ${nombreCorto(hecho.a)}.`
            : `${hecho.cuantos.toLocaleString('es')} volvieron al pozo común.`}
        </span>
        {hecho.a && <span className="text-success/80">Ya los ve en su lista de Contactos.</span>}
        <button
          type="button"
          onClick={() => setHecho(null)}
          aria-label="Cerrar aviso"
          className="ml-auto rounded-lg p-1 transition-colors hover:bg-success/15"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <>
      {confirmando && destino && (
        <Confirmacion
          cuantos={n}
          destino={destino}
          trabajando={trabajando}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={repartir}
        />
      )}

      <div className="sticky bottom-0 z-20 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(14,42,82,0.25)] backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex items-center gap-2">
            <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-navy px-1.5 text-[11px] font-bold tabular-nums text-white">
              {n.toLocaleString('es')}
            </span>
            <span className="text-sm font-semibold text-foreground">
              {n === 1 ? 'contacto elegido' : 'contactos elegidos'}
            </span>
            {seleccion.modo === 'recorte' && (
              <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-navy-ink">
                todo el filtro
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onLimpiar}
            className="text-sm font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Limpiar
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ElegirDestino destinos={destinos} carga={carga} elegido={destino} onElegir={setDestino} />

            <button
              type="button"
              disabled={!destino || trabajando}
              onClick={() => (necesitaConfirmar(n) ? setConfirmando(true) : repartir())}
              className="flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-sm font-bold text-white shadow-[0_4px_16px_-6px_rgba(14,42,82,0.6)] transition-[background-color,transform,opacity] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:opacity-35 disabled:shadow-none disabled:active:scale-100"
            >
              {trabajando && !confirmando ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <UserPlus size={13} />
              )}
              {destino ? `Habilitar ${n.toLocaleString('es')} a ${nombreCorto(destino)}` : 'Elegí a quién'}
            </button>

            <button
              type="button"
              disabled={trabajando || seleccion.modo === 'recorte'}
              title={
                seleccion.modo === 'recorte'
                  ? 'Para devolver al pozo común, elegí los contactos de a uno'
                  : 'Devolver al pozo común: dejan de ser de nadie'
              }
              onClick={() => {
                if (seleccion.modo !== 'lista') return;
                quitar.mutate(seleccion.ids, {
                  onSuccess: (r) => {
                    setHecho({ cuantos: r.quitados, a: '' });
                    onListo();
                  },
                });
              }}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-normal text-foreground transition-colors hover:bg-muted disabled:opacity-40"
            >
              {quitar.isPending ? <Loader2 size={13} className="animate-spin" /> : <UserMinus size={13} />}
              Quitar
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {/* El 409 del server enumera a quién SÍ se puede, o dice cuántos son
                y que hay que acotar. Se muestra tal cual: adivinar el motivo es
                cómo un dedazo se vuelve invisible. */}
            {error.message}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * EL PASO DE MÁS, a partir de 500.
 *
 * La regla dura #7 pide la lista de destinatarios a la vista, y a partir de cierto
 * tamaño eso es imposible por definición: nadie revisa 500 filas. Entonces lo que
 * se pone a la vista es **la cifra**, escrita, y la acción deja de ser un clic
 * suelto. No pregunta «¿estás seguro?» —que nadie lee— sino que dice el número y
 * a quién.
 */
function Confirmacion({
  cuantos: cantidad,
  destino,
  trabajando,
  onCancelar,
  onConfirmar,
}: {
  cuantos: number;
  destino: string;
  trabajando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCancelar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar el reparto"
          className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-panel"
        >
          <div className="p-5">
            <p className="font-heading text-lg font-bold text-foreground">
              Vas a habilitar{' '}
              <span className="tabular-nums text-navy-ink">{cantidad.toLocaleString('es')}</span> contactos
              a {nombreCorto(destino)}.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Van a aparecer en su lista de Contactos y deja de verlos cualquier otra persona. Es un
              lote más grande de lo que se puede revisar fila por fila.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              No se manda ningún mensaje: repartir solo decide de quién es cada contacto.
            </p>
          </div>
          <footer className="flex gap-2 border-t border-border p-3">
            <button
              type="button"
              onClick={onCancelar}
              disabled={trabajando}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={onConfirmar}
              disabled={trabajando}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-navy py-2.5 text-sm font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:opacity-50"
            >
              {trabajando ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
              Sí, habilitar {cantidad.toLocaleString('es')}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}

/** El desplegable de destino: cada persona con lo que ya tiene. */
function ElegirDestino({
  destinos,
  carga,
  elegido,
  onElegir,
}: {
  destinos: string[];
  carga: CargaVendedora[];
  elegido: string;
  onElegir: (v: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', afuera);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', afuera);
      document.removeEventListener('keydown', escape, true);
    };
  }, [abierto]);

  const cuanto = new Map(carga.map((c) => [c.vendedoraId.toLowerCase(), c.contactos]));
  const masCargado = Math.max(1, ...carga.map((c) => c.contactos));

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm font-normal text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Users size={13} className="text-muted-foreground" />
        {elegido ? nombreCorto(elegido) : 'Elegir a quién'}
        <ChevronDown size={12} className={abierto ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {abierto && (
        <div className="absolute bottom-full right-0 z-30 mb-1.5 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-panel">
          <p className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            A quién se lo doy
          </p>
          <div className="max-h-64 overflow-y-auto p-1">
            {destinos.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">
                Todavía no hay nadie en el reparto de ninguna línea.
              </p>
            ) : (
              destinos.map((d) => {
                const tiene = cuanto.get(d.toLowerCase()) ?? 0;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      onElegir(d);
                      setAbierto(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted ${
                      d === elegido ? 'bg-muted' : ''
                    }`}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy/10 text-[11px] font-bold uppercase text-navy-ink">
                      {nombreCorto(d).slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">
                        {nombreCorto(d)}
                      </span>
                      {/* La carga, en número y en barra: «336 y 12» se compara
                          leyendo; dos barras se comparan de un vistazo. */}
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-navy/50"
                            style={{ width: `${Math.round((tiene / masCargado) * 100)}%` }}
                          />
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {tiene.toLocaleString('es')}
                        </span>
                      </span>
                    </span>
                    {d === elegido && <Check size={13} className="shrink-0 text-navy-ink" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
