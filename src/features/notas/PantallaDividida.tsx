import { useState } from 'react';
import { Notebook, Plus, Search, Workflow, X } from 'lucide-react';
import { DiagramaPerezoso, EditorPerezoso } from './perezosos';
import { renglonDeEstado } from './guardado';
import { useAutoguardado, type DestinoDeGuardado } from './useAutoguardado';
import {
  type Nota,
  docParaEditor,
  resumenDeNota,
  tituloDeNota,
  useBuscarNotas,
  useMutacionesNotas,
  useNotaPorId,
} from './notas';

/**
 * DIVIDIR PANTALLA — el panel de la derecha (17-ago-2026).
 *
 * ══ CUATRO ESTADOS, Y LOS CUATRO VIVEN ACÁ Y NO EN `Libreta.tsx` ════════════
 *
 *   1. **Eligiendo**: recién apretaste «Dividir pantalla» — buscador + lista +
 *      «Página nueva» / «Nuevo Diagrama». Local y descartable: nada se
 *      escribió todavía.
 *   2. **Creando** (texto): elegiste «Página nueva» — un editor en blanco.
 *   3. **Creando un diagrama**: elegiste «Nuevo Diagrama» — un lienzo de React
 *      Flow en blanco, con su propia barra de herramientas.
 *      En los dos casos de «creando», el primer cambio la crea (en el mismo
 *      espacio que la de la izquierda — `donde`) Y la divide en el mismo
 *      movimiento (`alCrear` dispara `dividir`).
 *   4. **Dividida**: `divididaId` (que viene de la propia nota de la
 *      izquierda, persistido) ya apunta a algo — se trae con `useNotaPorId` y
 *      se edita con su propio autoguardado. Es la fuente de verdad: gana
 *      sobre los estados de arriba en cuanto el server confirma, y `tipo` de
 *      esa nota decide qué editor se monta.
 *
 * ══ POR QUÉ NO REUSA EL AUTOGUARDADO DE LA IZQUIERDA ════════════════════════
 *
 * Son dos páginas distintas escribiéndose en paralelo. Con un solo hook, tocar
 * la de la derecha reiniciaría el estado de guardado de la izquierda (mismo
 * defecto que el hook entero existe para evitar, del lado de acá).
 */
export function PantallaDividida({
  paginaIzquierdaId,
  divididaId,
  notasDisponibles,
  mutaciones,
  onCerrar,
}: {
  /** La nota de la izquierda — la que se está dividiendo. */
  paginaIzquierdaId: number;
  /** El `paginaDivididaId` YA PERSISTIDO en la nota de la izquierda, o `null`. */
  divididaId: number | null;
  /** La lista ya cargada del lugar actual, para el picker por default (sin buscar). */
  notasDisponibles: Nota[];
  mutaciones: Pick<
    ReturnType<typeof useMutacionesNotas>,
    'crear' | 'editar' | 'dividir' | 'crearDiagrama' | 'autoguardarDiagrama'
  >;
  /** Cierra el panel — solo tiene efecto ANTES de elegir algo. */
  onCerrar: () => void;
}) {
  const [fase, setFase] = useState<'eligiendo' | 'creando' | 'creando-diagrama'>('eligiendo');
  const [busqueda, setBusqueda] = useState('');
  const termino = busqueda.trim();
  const encontradas = useBuscarNotas(termino);
  const notaDerecha = useNotaPorId(divididaId);
  const { crear, editar, dividir, crearDiagrama, autoguardarDiagrama } = mutaciones;

  // El destino cambia de forma sola, sin que nadie tenga que sincronizar dos
  // estados: mientras no hay `divididaId` persistido, `fase` manda; en cuanto
  // el server confirma la división (`divididaId` deja de ser null), ESTE gana
  // — así una página recién creada pasa de {tipo:'nueva'} a {tipo:'nota', id}
  // sin un salto en el medio (misma garantía que `useAutoguardado` ya da).
  const destino: DestinoDeGuardado =
    divididaId !== null
      ? { tipo: 'nota', id: divididaId }
      : fase === 'creando' || fase === 'creando-diagrama'
        ? { tipo: 'nueva' }
        : null;

  /**
   * ¿Estamos con un DIAGRAMA? Dos caminos llegan acá: se está creando uno
   * ahora (`fase`), o ya se cargó uno persistido (`notaDerecha.data.tipo`).
   * De esto depende CUÁL PAR de mutaciones usa el autoguardado — texto o
   * diagrama son dos columnas distintas, `editar`/`crear` no sirven para una
   * página que nunca manda `texto`/`doc`.
   */
  const esDiagrama = fase === 'creando-diagrama' || notaDerecha.data?.tipo === 'diagrama';

  const { estado: estadoGuardado, alCambiar } = useAutoguardado({
    destino,
    puertas: {
      actualizar: (v) => (esDiagrama ? autoguardarDiagrama.mutateAsync({ id: v.id, diagrama: v.doc }) : editar.mutateAsync(v)),
      crear: (v) => (esDiagrama ? crearDiagrama.mutateAsync({ diagrama: v.doc }) : crear.mutateAsync(v)),
    },
    alCrear: (id) => {
      // La creación y la división son DOS escrituras, pero desde afuera se ven
      // como una: apenas hay id, se ata a la izquierda. Si esto falla, la
      // página igual quedó creada y con su contenido — no se pierde nada,
      // solo falta el lazo, que se puede reintentar apretando el botón de
      // nuevo (una vez que `onCortarDivision` la haya soltado del todo).
      dividir.mutate({ id: paginaIzquierdaId, paginaDivididaId: id });
    },
  });

  // 🔴 UN «gestion» NO SE PUEDE ELEGIR: su `id` es de la tabla `gestiones`, no
  // de `notas` — dividir contra ese número apuntaría a lo que sea que la otra
  // tabla tenga con ese id, o a nada. Ídem la propia página de la izquierda.
  const elegibles = (termino ? (encontradas.data ?? []) : notasDisponibles).filter(
    (n) => n.origen === 'nota' && n.id !== paginaIzquierdaId,
  );

  if (divididaId !== null || fase === 'creando' || fase === 'creando-diagrama') {
    const notaLista = divididaId !== null ? notaDerecha.data : undefined;
    const cargando = divididaId !== null && notaDerecha.isPending;
    const fallo = divididaId !== null && notaDerecha.isError;
    const titulo = notaLista ? tituloDeNota(notaLista) || 'Sin título' : esDiagrama ? 'Nuevo diagrama' : 'Página nueva';

    return (
      <div role="region" aria-label="Pantalla dividida">
        <div className="flex h-11 items-center gap-2 border-b border-border px-4">
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{titulo}</p>
          {(() => {
            const r = renglonDeEstado(estadoGuardado, Boolean(notaLista?.editadoAt));
            if (!r.texto) return null;
            return (
              <span
                className={'shrink-0 text-xs ' + (r.hayFallo ? 'font-medium text-destructive' : 'text-muted-foreground')}
                aria-live="polite"
              >
                {r.texto}
              </span>
            );
          })()}
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar la pantalla dividida"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {cargando && <p className="px-6 py-8 text-sm text-muted-foreground">Cargando…</p>}
        {fallo && <p className="px-6 py-8 text-sm text-destructive">No se pudo traer esa página.</p>}

        {/* El diagrama arma su PROPIA barra de herramientas y necesita todo el
            ancho — a diferencia del editor de texto, no lleva el `px-6 py-8`
            de columna de lectura. */}
        {esDiagrama
          ? (fase === 'creando-diagrama' || notaLista) && (
              <DiagramaPerezoso
                key={divididaId !== null ? `div-${divididaId}` : 'div-nueva-diagrama'}
                contenidoInicial={notaLista?.diagrama ?? undefined}
                onCambio={(v) => alCambiar({ diagrama: v })}
              />
            )
          : (fase === 'creando' || notaLista) && (
              <div className="px-6 py-8">
                <EditorPerezoso
                  key={divididaId !== null ? `div-${divididaId}` : 'div-nueva'}
                  contenidoInicial={notaLista ? docParaEditor(notaLista) : undefined}
                  soloLectura={false}
                  onCambio={(doc) => alCambiar({ doc })}
                />
              </div>
            )}
      </div>
    );
  }

  // ── ELIGIENDO ──
  return (
    <div role="region" aria-label="Pantalla dividida">
      <div className="flex h-11 items-center gap-2 border-b border-border px-4">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">Dividir pantalla</p>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cancelar"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="p-3">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar una página…"
            aria-label="Buscar una página para dividir"
            className="h-8 w-full rounded-lg border border-input bg-card pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
          />
        </div>

        {/* «Nuevo Diagrama» va A LA DERECHA de «Página nueva» — las dos formas
            de arrancar en blanco, una al lado de la otra. */}
        <div className="mb-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => setFase('creando')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
          >
            <Plus className="size-4" />
            Página nueva
          </button>
          <button
            type="button"
            onClick={() => setFase('creando-diagrama')}
            title="Un lienzo de nodos y conexiones (React Flow), en vez de texto"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            <Workflow className="size-4" />
            Nuevo Diagrama
          </button>
        </div>

        <div className="space-y-0.5">
          {elegibles.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => dividir.mutate({ id: paginaIzquierdaId, paginaDivididaId: n.id })}
              className="block w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-border hover:bg-muted"
            >
              <span className="block truncate text-sm font-medium text-foreground">{tituloDeNota(n) || 'Sin título'}</span>
              {resumenDeNota(n) && <p className="mt-0.5 truncate text-xs text-muted-foreground">{resumenDeNota(n)}</p>}
            </button>
          ))}

          {elegibles.length === 0 && (
            <p className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-muted-foreground">
              <Notebook className="size-6 text-muted-foreground/40" />
              {termino ? 'Nada con ese término.' : 'No hay otra página acá — creá una nueva.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
