import { useDeferredValue, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageCircle,
  Search,
  ShieldOff,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { fechaCorta, formatoTelefono } from '../../lib/formato';
import { conversacionDeTelefono } from '../canales/conversacionNueva';
import { HojaContacto } from '../panel/HojaContacto';
import { useSesionWa } from '../whatsapp/conversacionWa';
import { BarraReparto } from './BarraReparto';
import { FiltroFaceta } from './FiltroFaceta';
import {
  alternarFila,
  alternarPagina,
  cuantos,
  estaElegido,
  NADA,
  ofrecerElRecorte,
  todoElRecorte,
  type Seleccion,
} from './seleccion';
import {
  alternar,
  contarActivos,
  DIMENSIONES,
  usePadron,
  useFacetas,
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
 * recortando y repartiendo. Por eso es una tabla densa y no una lista de
 * tarjetas: se lee comparando renglones, no de a uno.
 *
 * ── Dos pantallas, una ruta ──
 * El supervisor ve el padrón entero y reparte. La vendedora ve **lo que le
 * habilitaron**, sin filtros de universo. Quién es quién lo decide el server y
 * llega en `supervisor`: acá no se decide nada, se dibuja lo que vino.
 */
export function PantallaPadron({
  onEscribir,
  miVendedora,
}: {
  onEscribir?: (telefono: string) => void;
  /** Quién mira — la `HojaContacto` la necesita para el timeline (ADR 0037). */
  miVendedora?: string | null;
}) {
  const [texto, setTexto] = useState('');
  const [filtros, setFiltros] = useState<FiltrosPadron>({ pagina: 1, porPagina: 50 });
  const [seleccion, setSeleccion] = useState<Seleccion>(NADA);
  /**
   * DE QUIÉN SE ESTÁ LEYENDO LA FICHA. La tabla dice lo que icarus guardó; la
   * ficha dice lo que Cerberus sabe HOY — si compró, cuánto y con qué folios.
   * Son dos fuentes distintas y la segunda es la que decide a quién repartir.
   */
  const [ficha, setFicha] = useState<ContactoPadron | null>(null);
  // La línea propia con la que se arma la clave de conversación. Sin WhatsApp
  // conectado queda `null` y la ficha se abre igual (ver `conversacionDeTelefono`).
  const { data: sesionWa } = useSesionWa();
  const miLinea = sesionWa?.estado === 'conectado' ? sesionWa.telefono : null;
  /**
   * La conversación que consume el panel. Memoizada porque la fábrica estampa
   * `new Date()`: sin esto, cada render de la tabla —y la tabla se repinta con
   * cada tecla del buscador— devolvería un objeto nuevo y el panel entero se
   * recalcularía por debajo de una hoja que no cambió de persona.
   */
  const conversacionDeLaFicha = useMemo(
    () =>
      ficha?.telefono
        ? conversacionDeTelefono({
            telefono: ficha.telefono,
            numeroPropio: miLinea,
            nombre: ficha.nombre,
          })
        : null,
    [ficha?.telefono, ficha?.nombre, miLinea],
  );

  // El texto se difiere: escribir «gonzález» son ocho requests si cada tecla
  // dispara una consulta sobre 72.923 filas.
  const q = useDeferredValue(texto);
  const conBusqueda: FiltrosPadron = { ...filtros, q: q.trim() || undefined };

  const { data, isPending, isError, error, isFetching } = usePadron(conBusqueda);
  const soySupervisor = data?.supervisor ?? false;
  const facetas = useFacetas(conBusqueda, soySupervisor);
  const reparto = useRepartoPadron(soySupervisor);

  /** Cualquier cambio de recorte vuelve a la página 1 y suelta la selección. */
  function cambiar(parcial: Partial<FiltrosPadron>) {
    // Quedarse en la página 7 de un recorte que ahora tiene 2 muestra una tabla
    // vacía sin motivo; y conservar la selección repartiría filas que ya no se ven.
    setFiltros((f) => ({ ...f, ...parcial, pagina: 1 }));
    setSeleccion(NADA);
  }

  const contactos = data?.contactos ?? [];
  const total = data?.total ?? 0;
  const porPagina = data?.porPagina ?? 50;
  const paginaActual = data?.paginaActual ?? 1;
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));
  const activos = contarActivos(conBusqueda);

  const idsDeLaPagina = contactos.map((c) => c.id);
  const todaLaPaginaElegida =
    idsDeLaPagina.length > 0 && idsDeLaPagina.every((id) => estaElegido(seleccion, id));
  const elegidos = cuantos(seleccion, total);

  if (isError) {
    return (
      <Aviso
        tono="error"
        titulo="No se pudo leer el padrón"
        // «no se pudo preguntar» ≠ «no hay». Cicatriz de ADR 0023: una lista vacía
        // acá se leería como que no hay contactos, y son 72.923.
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
    // `relative`: la hoja de la ficha se ancla acá adentro, no al viewport.
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[15rem] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setFiltros((f) => ({ ...f, pagina: 1 }));
                setSeleccion(NADA);
              }}
              placeholder="Nombre, teléfono, correo o DNI"
              className="w-full rounded-full border border-border bg-muted py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            {texto && (
              <button
                type="button"
                aria-label="Borrar la búsqueda"
                onClick={() => setTexto('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-border hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </label>

          {soySupervisor && (
            <select
              value={filtros.orden ?? 'recientes'}
              onChange={(e) => cambiar({ orden: e.target.value as FiltrosPadron['orden'] })}
              aria-label="Ordenar"
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
            >
              <option value="recientes">Más nuevos</option>
              <option value="antiguos">Más antiguos</option>
              <option value="mas_gastaron">Los que más gastaron</option>
              <option value="nombre">Por nombre</option>
            </select>
          )}
        </div>

        {soySupervisor && (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <SlidersHorizontal size={13} className="mr-0.5 shrink-0 text-muted-foreground" />
              {DIMENSIONES.map((d) => (
                <FiltroFaceta
                  key={d.id}
                  rotulo={d.rotulo}
                  opciones={facetas.data?.facetas[d.id] ?? []}
                  elegidos={filtros[d.id] ?? []}
                  cargando={facetas.isPending}
                  onAlternar={(v) => cambiar({ [d.id]: alternar(filtros[d.id], v) })}
                  onLimpiar={() => cambiar({ [d.id]: [] })}
                />
              ))}

              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

              <Toggle activo={filtros.sinHabilitar === true} onClick={() => cambiar({ sinHabilitar: !filtros.sinHabilitar || undefined })}>
                Sin repartir
              </Toggle>
              <Toggle
                activo={filtros.conVenta === true}
                onClick={() => cambiar({ conVenta: !filtros.conVenta || undefined })}
                titulo="Los que tienen una venta de verdad, no los que dicen tenerla"
              >
                Ya compraron
              </Toggle>
              <Toggle activo={filtros.conTelefono === true} onClick={() => cambiar({ conTelefono: !filtros.conTelefono || undefined })}>
                Con teléfono
              </Toggle>
            </div>

            {activos > 0 && <ChipsActivos filtros={conBusqueda} onCambiar={cambiar} onLimpiarTexto={() => setTexto('')} />}
          </>
        )}

        <p className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          {isFetching && <Loader2 size={11} className="animate-spin" />}
          <span className="font-semibold tabular-nums text-foreground">{total.toLocaleString('es')}</span>
          {soySupervisor ? (
            <>
              {total === 1 ? 'contacto en este recorte' : 'contactos en este recorte'}
              {/* El aviso de la regla dura #7: cuántos NO se están viendo. */}
              {total > porPagina && <span>· se ven {contactos.length} en esta página</span>}
            </>
          ) : (
            <>{total === 1 ? 'contacto habilitado para vos' : 'contactos habilitados para vos'}</>
          )}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/*
          LA BANDA DEL RECORTE ENTERO — el puente entre «los 50 de esta página» y
          «los 17.014 que filtré». Aparece SOLO con la página completa tildada y
          más contactos afuera: ofrecerla siempre sería ruido, y ofrecerla con la
          página a medias invita a saltar de 3 elegidos a 17.014 sin querer.
        */}
        {soySupervisor && ofrecerElRecorte(seleccion, idsDeLaPagina, total) && (
          <div className="flex flex-wrap items-center justify-center gap-2 border-b border-border bg-navy/5 px-4 py-2 text-xs">
            <span className="text-muted-foreground">
              Elegiste {idsDeLaPagina.length} de esta página.
            </span>
            <button
              type="button"
              onClick={() => setSeleccion(todoElRecorte())}
              className="font-bold text-navy underline underline-offset-2 hover:text-navy/80"
            >
              Elegir los {total.toLocaleString('es')} de este filtro
            </button>
          </div>
        )}

        {soySupervisor && seleccion.modo === 'recorte' && (
          <div className="flex flex-wrap items-center justify-center gap-2 border-b border-border bg-navy/5 px-4 py-2 text-xs">
            <span className="font-semibold text-navy">
              Están elegidos los {elegidos.toLocaleString('es')} contactos de este filtro
              {seleccion.excluidos.length > 0 &&
                ` (sacaste ${seleccion.excluidos.length})`}
              .
            </span>
            <button
              type="button"
              onClick={() => setSeleccion(NADA)}
              className="font-bold text-navy underline underline-offset-2 hover:text-navy/80"
            >
              Elegir solo esta página
            </button>
          </div>
        )}

        {isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : contactos.length === 0 ? (
          <Vacio soySupervisor={soySupervisor} hayFiltro={activos > 0} />
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
                        setSeleccion((prev) => alternarPagina(prev, idsDeLaPagina, e.target.checked))
                      }
                      className="size-3.5 accent-navy"
                    />
                  </th>
                )}
                <th className="px-3 py-2 font-semibold">Quién</th>
                <th className="px-3 py-2 font-semibold">Teléfono</th>
                <th className="px-3 py-2 font-semibold">País</th>
                <th className="px-3 py-2 font-semibold">Curso / compra</th>
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
                  elegido={estaElegido(seleccion, c.id)}
                  onElegir={() => setSeleccion((prev) => alternarFila(prev, c.id))}
                  onEscribir={onEscribir}
                  onFicha={setFicha}
                  abierta={ficha?.id === c.id}
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
          total={total}
          filtros={conBusqueda}
          destinos={reparto.data?.destinos ?? []}
          carga={reparto.data?.carga ?? []}
          onListo={() => setSeleccion(NADA)}
          onLimpiar={() => setSeleccion(NADA)}
        />
      )}

      {/* LA FICHA AL COSTADO. Lo que se ve acá no sale del padrón: la ficha de
          Cerberus y el formulario que llenó se buscan por TELÉFONO, en vivo. El
          timeline y las señales, en cambio, van por clave de conversación y para
          alguien que nunca escribió vienen vacíos — que es la verdad, no una
          falla de carga: el padrón son justamente los que nunca escribieron. */}
      {conversacionDeLaFicha && (
        <HojaContacto
          conversacion={conversacionDeLaFicha}
          onCerrar={() => setFicha(null)}
          miVendedora={miVendedora}
        />
      )}
    </div>
  );
}

/**
 * LO QUE ESTÁ PUESTO, EN UNA LÍNEA.
 *
 * Con cinco desplegables cerrados no hay forma de saber qué está recortando sin
 * abrirlos de a uno. Cada chip se saca de a uno con su ×, que es la operación
 * que más se hace al armar un lote: probar un país, medirlo, sacarlo.
 */
function ChipsActivos({
  filtros,
  onCambiar,
  onLimpiarTexto,
}: {
  filtros: FiltrosPadron;
  onCambiar: (p: Partial<FiltrosPadron>) => void;
  onLimpiarTexto: () => void;
}) {
  const puestos: { llave: string; rotulo: string; quitar: () => void }[] = [];

  for (const d of DIMENSIONES) {
    for (const v of filtros[d.id] ?? []) {
      puestos.push({
        llave: `${d.id}:${v}`,
        rotulo: v,
        quitar: () => onCambiar({ [d.id]: (filtros[d.id] ?? []).filter((x) => x !== v) }),
      });
    }
  }
  if (filtros.sinHabilitar) puestos.push({ llave: 'sinHabilitar', rotulo: 'Sin repartir', quitar: () => onCambiar({ sinHabilitar: undefined }) });
  if (filtros.conVenta) puestos.push({ llave: 'conVenta', rotulo: 'Ya compraron', quitar: () => onCambiar({ conVenta: undefined }) });
  if (filtros.conTelefono) puestos.push({ llave: 'conTelefono', rotulo: 'Con teléfono', quitar: () => onCambiar({ conTelefono: undefined }) });
  if (filtros.q) puestos.push({ llave: 'q', rotulo: `«${filtros.q}»`, quitar: onLimpiarTexto });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {puestos.map((p) => (
        <span
          key={p.llave}
          className="flex items-center gap-1 rounded-full bg-navy/10 py-0.5 pl-2.5 pr-1 text-[11px] font-semibold text-navy"
        >
          {p.rotulo}
          <button
            type="button"
            onClick={p.quitar}
            aria-label={`Quitar ${p.rotulo}`}
            className="rounded-full p-0.5 transition-colors hover:bg-navy/20"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => {
          onLimpiarTexto();
          onCambiar({
            pais: [], curso: [], etapa: [], nivel: [], fuente: [],
            sinHabilitar: undefined, conVenta: undefined, conTelefono: undefined,
          });
        }}
        className="ml-1 text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Limpiar todo
      </button>
    </div>
  );
}

function Fila({
  c,
  elegible,
  elegido,
  onElegir,
  onEscribir,
  onFicha,
  abierta,
}: {
  c: ContactoPadron;
  elegible: boolean;
  elegido: boolean;
  onElegir: () => void;
  onEscribir?: (telefono: string) => void;
  /** Un clic en la fila abre la ficha al costado. */
  onFicha?: (c: ContactoPadron) => void;
  abierta?: boolean;
}) {
  const telefono = (c.telefono ?? '').replace(/\D/g, '');
  // La ficha se busca POR TELÉFONO (así habla `cerberus/ficha.ts`): sin uno
  // usable no hay nada que abrir, y una hoja vacía se leería como «no es
  // cliente» cuando lo que pasa es que no se lo pudo preguntar.
  const conFicha = onFicha && telefono.length >= 8 ? () => onFicha(c) : null;
  return (
    <tr
      role={conFicha ? 'button' : undefined}
      tabIndex={conFicha ? 0 : undefined}
      aria-label={conFicha ? `Ver la ficha de ${c.nombre ?? telefono}` : undefined}
      onClick={conFicha ?? undefined}
      onKeyDown={
        conFicha
          ? (e) => {
              // Solo con el foco en la fila: si no, Espacio sobre el checkbox
              // de reparto abriría la ficha además de tildar.
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                conFicha();
              }
            }
          : undefined
      }
      className={
        `border-b border-border/60 transition-colors ${elegido ? 'bg-primary/5' : 'hover:bg-muted/50'}` +
        (conFicha ? ' cursor-pointer' : '') +
        // De cuál se está leyendo la ficha. Tiene que ganarle al `hover:` de
        // arriba: con la hoja abierta el puntero está del otro lado de la
        // pantalla, y sin marca no hay forma de saber a quién se está mirando.
        // `bg-secondary` y no `bg-muted`: el gris de la casa es #F5F7FB, a un
        // pelo del blanco de la tabla, y sobre un renglón de 32 px no se ve. El
        // tinte azul es el mismo que marca «mirá esta» en el radar.
        (abierta ? ' bg-secondary hover:bg-secondary' : '')
      }
    >
      {elegible && (
        // El clic del check NO abre la ficha: repartir es la acción de esta
        // columna, y tildar 50 filas abriendo 50 hojas sería inusable.
        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Elegir a ${c.nombre ?? c.id}`}
            checked={elegido}
            onChange={() => onElegir()}
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
      {/*
        🔴 DOS DATOS DISTINTOS EN UNA COLUMNA, y por eso se dibujan distinto.
        `comprado` es lo que PAGÓ (sale de la venta) y va con peso; `curso` es lo
        que DECLARÓ en la landing y va tenue, en cursiva y rotulado. Antes se
        mostraba solo el declarado, y por eso la tabla se leía al revés: filas con
        curso que decían «no compró» junto a filas sin curso que decían «Sí».
      */}
      <td className="max-w-[14rem] px-3 py-2">
        {c.comprado ? (
          <span className="block truncate text-xs font-medium text-foreground" title={c.comprado}>
            {c.comprado}
          </span>
        ) : c.curso ? (
          <span className="block truncate text-xs italic text-muted-foreground" title={`Le interesa: ${c.curso}`}>
            {c.curso}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        {c.comprado && c.curso && c.curso !== c.comprado && (
          <span className="block truncate text-[10px] italic text-muted-foreground" title={`Le interesa: ${c.curso}`}>
            le interesa: {c.curso}
          </span>
        )}
      </td>
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
            onClick={(e) => {
              // Abrir el chat se lleva la vista entera a Mensajes: dejar además
              // una ficha abierta atrás sería un rastro que nadie pidió.
              e.stopPropagation();
              onEscribir(telefono);
            }}
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

function Toggle({
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
  // Tres textos para tres situaciones que se ven igual: un recorte que no dio
  // nada, un padrón vacío, y una vendedora sin nada habilitado.
  return (
    <div className="flex flex-col items-center gap-2 p-12 text-center">
      <ShieldOff size={26} className="text-muted-foreground/40" />
      <p className="max-w-sm text-sm text-muted-foreground">
        {hayFiltro
          ? 'Ningún contacto entra en este recorte. Probá sacando algún filtro.'
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
