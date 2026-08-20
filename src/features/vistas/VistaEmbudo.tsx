import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Check,
  Clock,
  History,
  MessageSquareOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import {
  useTablero,
  type ColumnaDelTablero,
  type Conversacion,
} from '../../dominio/conversaciones';
import { ETAPA_ROTULO, type Etapa } from '../../lib/etapas';
import { decidirDrop, decidirRebote, reintentoTrasInteres } from './compuertas';
import { ModalInteresCotizado, ModalVentaCierre } from './ModalesCompuerta';
import { HojaContacto } from '../panel/HojaContacto';
import type { DestinoCorreo } from '../../lib/puente';
import { TarjetaEmbudo } from './TarjetaEmbudo';
import { cotizarEnUnClic } from './tarjeta';
import {
  cifrasDeColumna,
  columnasDe,
  etapaDeTarjeta,
  quedanPorTraer,
  recortesDeColumna,
  repartirColumnas,
  resumirBandeja,
  resumirColumna,
  vacioDeColumna,
  type EtapaTrabajo,
  type Recorte,
} from './tablero';

/**
 * EL PIPELINE — el tablero de venta de la vendedora.
 *
 * QUÉ PASABA (medido en producción el 2026-07-25, 1.865 conversaciones): de 300
 * Contactadas muestreadas, las 300 estaban respondidas —es decir, TODA la única
 * columna con tarjetas era gente cuya pelota no es nuestra— mientras las 476 que
 * sí esperan respuesta vivían apretadas en un contador gris de una línea que
 * además decía algo falso («nadie les respondió aún») para 218 de ellas. Las
 * otras tres columnas estaban en cero sobre 1.366 px de ancho, y 611
 * conversaciones con el precio ya mandado no figuraban en Cotizados porque la
 * compuerta pide un interés tipeado a mano que nadie tipea (uno en toda la base).
 *
 * QUÉ HACE AHORA, en el mismo orden en que se lee:
 *
 *   1. LA BANDEJA (`BandejaDeuda`) encabeza el tablero y dice la verdad: cuántas
 *      esperan, cuántas están escribiendo AHORA, cuántas nunca abrimos y cuántas
 *      volvieron a escribir. Sigue sin ser columna (decisión del dueño, #87).
 *   2. LAS COLUMNAS pesan lo que trabajan: Contactados se lleva el ancho, y las
 *      vacías explican cómo se llenan en vez de ser un hueco blanco.
 *   3. EL RECORTE «Con precio» convierte las 1.389 en la lista que importa: las
 *      que ya están cotizadas de hecho y no figuran como tales.
 *   4. EL BOTÓN «Cotizado» de la tarjeta cierra el hueco: cuando ya sabemos el
 *      curso (registrado o del formulario), un clic asienta el interés y mueve.
 *      La compuerta del server NO se relaja — se satisface (`registrarGestion`).
 *
 * Lo que NO cambió: se arrastra igual, las compuertas guían con sus modales
 * (#60), el cierre se sigue ganando solo con una venta registrada, y la etapa la
 * dice el server (ADR 0013) — el front no inventa ninguna.
 */

/**
 * La grilla: el ancho es una declaración de dónde está el trabajo. Aguanta 1280
 * sin reflow (es una app de escritorio, no una página) y sin scroll horizontal,
 * que en esta app no existe.
 *
 * ⚠️ **LA CUENTA SE REHIZO DOS VECES EN DOS DÍAS.** El 10-ago entró «Te esperan»
 * y salió «Nunca contestaron» (cinco); el 11-ago volvió «Nunca contestaron»
 * porque sacarla escondía el trabajo del día (ADR 0052), así que son **seis**.
 *
 * A 1280 el contenido son ~1.256 px (menos el padding de 12 de cada lado) y los
 * cuatro gaps de 8 px se comen 32. Los mínimos suman **1.035**, con ~189 de aire.
 *
 * 🔴 **SE INTENTARON SEIS Y NO ENTRAN.** Dos cuentas distintas (1.120 y 1.020 de
 * mínimos) dieron la última columna **cortada contra el borde**, con las tarjetas
 * desbordadas: el aire que sobra en el `minmax` se lo comen los paddings de la
 * tarjeta y del contenedor, que no están en esa cuenta. Por eso volvió a cinco,
 * sacando `perdido` —cero filas en toda la historia— para que entrara
 * `sin_respuesta`. **La cuenta se verifica con una captura a 1280, no en la
 * cabeza**: las dos veces que la hice de memoria, me equivoqué.
 *
 * El reparto sigue diciendo dónde está el trabajo: las dos columnas donde se
 * vende («Contestaron», «Saben el precio») se llevan el ancho, y «Te esperan» va
 * cerca porque sus tarjetas son las más ricas de la mesa —traen el mensaje que la
 * persona acaba de mandar—. «Dijeron que no» sigue siendo un cajón.
 */
const GRID =
  'grid min-h-0 flex-1 grid-cols-[minmax(215px,1fr)_minmax(180px,0.75fr)_minmax(240px,1.2fr)_minmax(240px,1.2fr)_minmax(160px,0.6fr)] gap-2 overflow-x-auto';

/**
 * El ícono de cada recorte. Vive acá y no en `tablero.ts` porque un componente de
 * lucide no es política: `recortesDeColumna` decide QUÉ se ofrece y con qué
 * número, esto solo lo dibuja. Así el módulo puro se puede testear en `node` sin
 * arrastrar React.
 */
const ICONO_RECORTE: Record<Recorte, LucideIcon | null> = {
  todas: null,
  precio: BadgeDollarSign,
  ventana: Clock,
  seguir: History,
  seCallo: MessageSquareOff,
};

export function VistaEmbudo({
  onAbrir,
  onAgendarBienvenida,
  onIrAMensajes,
  onEscribir,
  miVendedora,
  esDeCampana,
  onMandarCorreo,
}: {
  onAbrir: (c: Conversacion) => void;
  /** La siguiente jugada del recibo de venta (cae en la Agenda vía puente). */
  onAgendarBienvenida?: (telefono: string | null) => void;
  /** La bandeja no se trabaja acá: este botón lleva a Mensajes. */
  onIrAMensajes?: () => void;
  /** Puente a Mensajes para iniciar un chat nuevo desde la ficha. */
  onEscribir?: (telefono: string) => void;
  /** Quién mira — la `HojaContacto` la necesita para el timeline (ADR 0037). */
  miVendedora?: string | null;
  /**
   * ¿Quien mira trabaja en el módulo de CAMPAÑAS? Baja hasta `PanelDerecho`,
   * que apaga con esto las tres consultas que van contra Cerberus (`modulos/
   * modulo.ts`). Opcional: sin él se comporta como el panel de siempre.
   */
  esDeCampana?: boolean;
  /** Puente a Correos: baja hasta la ficha de la hoja. Sin esto, ahí no hay «Escribirle». */
  onMandarCorreo?: (destino: DestinoCorreo) => void;
}) {
  const qc = useQueryClient();
  /**
   * EL RECORTE ES POR COLUMNA — y ése es el cambio (§3.1 del plan).
   *
   * Hasta acá había **un solo recorte, global a la vista**, y solo se dibujaba
   * arriba de Contactados. Alcanzaba mientras Contactados era la única columna
   * con tarjetas; desde que el embudo se DERIVA (8-ago-2026) la pila se mudó a
   * Cotizados —3.064 tarjetas— y la única columna con recorte quedó con 534. Una
   * columna de 3.064 no es una lista de trabajo: es la misma pila con otro
   * rótulo.
   *
   * Cada eje sigue siendo UNO con varias posiciones y no varios toggles: cruzar
   * «con precio» × «en ventana» × «para seguir» daría ocho estados, y la mitad
   * no son listas que nadie pida. Qué chips se ofrecen lo decide
   * `recortesDeColumna` (puro, con tests), no este componente.
   */
  const [recortes, setRecortes] = useState<Partial<Record<EtapaTrabajo, Recorte>>>({});
  const recorteDe = (etapa: EtapaTrabajo): Recorte => recortes[etapa] ?? 'todas';
  const ponerRecorte = (etapa: EtapaTrabajo, r: Recorte) =>
    setRecortes((v) => ({ ...v, [etapa]: r }));

  /** El recorte de una columna, como lo pide el tablero. `todas` = sin recorte. */
  const pedidoDe = (etapa: EtapaTrabajo): ColumnaDelTablero => {
    const r = recorteDe(etapa);
    return { etapa, recorte: r === 'todas' ? undefined : r };
  };

  // Cada columna carga LO SUYO (#89) y ahora también SU recorte. El nombre real y
  // el curso del formulario no se piden: la cola los sirve siempre (#72).
  // «Te esperan» es una columna más desde el 10-ago: el server ya la sabía servir
  // (`interesado` está en ETAPAS_CONSULTABLES), así que no hizo falta tocar nada
  // del lado de allá — lo que había era una pantalla que no la pedía.
  /**
   * ══ QUÉ TABLERO SE DIBUJA (ADR 0063) ══════════════════════════════════════
   *
   * El juego de columnas lo decide el módulo; **la cantidad ya no ata a los
   * hooks**. Antes acá había cinco `useConversaciones` desenrollados a mano
   * porque React prohíbe que la cantidad de hooks varíe entre renders — y esas
   * cinco consultas eran cinco veces la más cara del repo, con el `todo` del
   * server rearmado cinco veces por refresco (2.226 ms cada uno, medido).
   *
   * Ahora es **un** hook que recibe la lista, así que una sexta columna se
   * agrega en `tablero.ts` y nada más. Lo que sigue siendo invariante es que los
   * dos juegos tengan el mismo largo (`tablero.test.ts`), pero por lo que ese
   * test dice —el ancho de la mesa a 1280— y ya no por una restricción de React.
   */
  const columnas = columnasDe(esDeCampana ? 'campana' : 'ventas');
  const tablero = useTablero(columnas.map((c) => pedidoDe(c.id)));
  const porColumna = tablero.porColumna as Record<
    EtapaTrabajo,
    (typeof tablero.porColumna)[string]
  >;

  // El desglose (conteos reales por etapa × turno × precio) viene UNA vez para
  // todo el tablero: es la misma foto, y contarla por columna era contarla cinco.
  const desglose = tablero.desglose;
  const conteos = tablero.conteos;

  /**
   * El desglose de «Te esperan» — los dos trabajos que la tira mostraba y que
   * ahora viven en la cabecera de su columna. `resumirBandeja` no se tocó: sigue
   * siendo la misma función pura, con los mismos tests.
   */
  const bandeja = resumirBandeja(desglose, conteos);

  const [arrastrada, setArrastrada] = useState<Conversacion | null>(null);
  const [sobre, setSobre] = useState<EtapaTrabajo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [rebotada, setRebotada] = useState<string | null>(null);
  const timerRebote = useRef<number | null>(null);
  /**
   * Los movimientos optimistas en vuelo: clave → etapa destino. La tarjeta se
   * pinta ya en la columna nueva (repartirColumnas) y el override se levanta
   * cuando la verdad del server refresca las columnas — nunca se restaura una
   * foto local que podría deshacer movimientos de OTRAS tarjetas.
   */
  const [overrides, setOverrides] = useState<Record<string, Etapa>>({});
  /**
   * DE QUIÉN SE ESTÁ LEYENDO LA FICHA, al costado del tablero. Un clic en la
   * tarjeta la abre; antes la única forma de saber quién era esa persona era
   * irse a Mensajes y volver — o sea, perder el tablero para consultarlo.
   *
   * Guarda la conversación entera y no la clave: `PanelDerecho` la pide así, y
   * releerla de `repartidas` obligaría a decidir qué hacer cuando la tarjeta se
   * mueve de columna mientras la ficha está abierta (nada: es la misma persona).
   */
  const [ficha, setFicha] = useState<Conversacion | null>(null);
  /** La tarjeta que la compuerta de Cotizados dejó ESPERANDO el curso de interés. */
  const [pendienteInteres, setPendienteInteres] = useState<Conversacion | null>(null);
  /** La conversación soltada en Cierre: abre el formulario de Registrar venta. */
  const [ventaPara, setVentaPara] = useState<Conversacion | null>(null);

  const cargando = columnas.every((c) => porColumna[c.id]!.cargando);

  // El server desplegado todavía no habla de etapas (#88/#89 sin deploy): sin
  // `etapa_efectiva` cada columna traería el feed entero y el tablero MENTIRÍA
  // con cara de honesto. Mejor decirlo que pintarlo.
  const servidorSinEtapas = columnas.some((col) => {
    const primera = porColumna[col.id]!.items[0];
    return primera != null && primera.etapa_efectiva === undefined;
  });

  const repartidas = repartirColumnas(
    columnas.map((col) => [col.id, porColumna[col.id]!.items] as const),
    overrides,
  );

  function quitarOverride(clave: string) {
    setOverrides((o) => {
      const { [clave]: _, ...resto } = o;
      return resto;
    });
  }

  function marcarRebote(clave: string) {
    setRebotada(clave);
    if (timerRebote.current != null) window.clearTimeout(timerRebote.current);
    timerRebote.current = window.setTimeout(() => setRebotada(null), 1500);
  }

  /**
   * Mover una tarjeta de etapa. `curso` (opcional) es el camino corto a
   * Cotizados: asienta el interés ANTES de mover, así la compuerta del server
   * —que no se toca— encuentra lo que exige. Las dos llamadas son consecuencia
   * de UN clic humano; nada se mueve solo.
   */
  const mover = useMutation({
    mutationFn: async (v: { c: Conversacion; etapa: Etapa; curso?: string }) => {
      if (v.curso) {
        await api('/api/gestiones/intereses', {
          method: 'POST',
          body: JSON.stringify({ clave: v.c.clave, curso: v.curso }),
        });
      }
      return api('/api/gestiones', {
        method: 'POST',
        body: JSON.stringify({
          clave: v.c.clave,
          canal: v.c.canal,
          personaId: v.c.persona_id,
          personaNombre: v.c.persona_nombre,
          numeroPropio: v.c.numero_propio,
          etapa: v.etapa,
        }),
      });
    },
    // Optimista: la tarjeta se muda al soltar (override). Si algo falla, NO se
    // restaura ninguna foto local: se levanta el override y la verdad del
    // server pinta el mapa.
    onMutate: (v) => {
      setOverrides((o) => ({ ...o, [v.c.clave]: v.etapa }));
    },
    onSuccess: async (_r, v) => {
      setAviso(null);
      // El override se levanta DESPUÉS del refetch: si no, la tarjeta volvería
      // a la columna vieja un instante, hasta que llegue lo fresco.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['conversaciones'] }),
        qc.invalidateQueries({ queryKey: ['embudo'] }),
        qc.invalidateQueries({ queryKey: ['gestiones'] }),
        qc.invalidateQueries({ queryKey: ['intereses', v.c.clave] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      quitarOverride(v.c.clave);
    },
    onError: (err, v) => {
      const r = decidirRebote({
        destino: v.etapa,
        status: err instanceof ErrorApi ? err.status : null,
        mensaje: err instanceof ErrorApi ? err.message : null,
        // Carrera real: este POST pudo quedar en vuelo mientras otro drop abría
        // el modal de venta. En ese caso: aviso, jamás dos modales apilados.
        ventaAbierta: ventaPara != null,
      });
      if (r.accion === 'modal-interes') {
        // La compuerta pide el interés: la tarjeta se queda esperando en
        // Cotizados (el override sigue puesto) mientras el modal lo registra.
        setPendienteInteres(v.c);
        return;
      }
      // El fallback de siempre (red, validación): se levanta el override y el
      // motivo queda a la vista hasta el próximo arrastre o hasta cerrarlo.
      quitarOverride(v.c.clave);
      setAviso(r.mensaje);
      marcarRebote(v.c.clave);
    },
  });

  /** La vendedora desistió del interés: se levanta el override y la tarjeta vuelve. */
  function cancelarInteres() {
    if (!pendienteInteres) return;
    const c = pendienteInteres;
    setPendienteInteres(null);
    quitarOverride(c.clave);
    marcarRebote(c.clave);
  }

  /**
   * El interés quedó guardado: el drag original se completa solo (reintento del
   * POST). Todo camino termina en el server: onSuccess o onError deciden.
   */
  function guardadoInteres() {
    if (!pendienteInteres) return;
    const vars = reintentoTrasInteres(pendienteInteres);
    setPendienteInteres(null);
    if (vars) mover.mutate(vars);
  }

  /**
   * EL CAMINO CORTO A COTIZADO — el botón de la tarjeta. Si ya sabemos el curso
   * (registrado, o el que la persona eligió en el formulario), un clic asienta el
   * interés y mueve. Si no lo sabemos, no se inventa: se abre el modal que lo
   * pregunta, que es exactamente el mismo camino del arrastre.
   */
  function cotizarDesdeTarjeta(c: Conversacion) {
    setAviso(null);
    const unClic = cotizarEnUnClic(c);
    if (!unClic) {
      setOverrides((o) => ({ ...o, [c.clave]: 'cotizado' }));
      setPendienteInteres(c);
      return;
    }
    // El interés se asienta con el texto CRUDO del catálogo (`unClic.crudo`), no
    // con el nombre corto del chip: registrar «Inteligencia y Contrainteligencia»
    // guardaría un curso que no existe en Cerberus (ver `tarjeta.ts`).
    mover.mutate({ c, etapa: 'cotizado', curso: unClic.hayQueRegistrar ? unClic.crudo : undefined });
  }

  function empezarArrastre(c: Conversacion) {
    setArrastrada(c);
    setAviso(null); // el próximo arrastre limpia el aviso de compuerta
    setRebotada(null);
  }

  function terminarArrastre() {
    setArrastrada(null);
    setSobre(null);
  }

  function soltar(etapa: EtapaTrabajo) {
    if (!arrastrada) return;
    const c = arrastrada;
    setArrastrada(null);
    setSobre(null);
    const actual = etapaDeTarjeta(c, overrides);
    if (actual == null) return; // sin etapa del server no se mueve nada a ciegas
    const d = decidirDrop({
      actual,
      destino: etapa,
      canal: c.canal,
      // La cola trae el interés asentado en la fila (`interes_curso`, #72): se
      // sabe ANTES de viajar si la compuerta de Cotizado va a rebotar. Ausente
      // (undefined) = server viejo que no lo sirve: se intenta, como siempre.
      tieneInteres: c.interes_curso === undefined ? undefined : Boolean(c.interes_curso),
      // Con un modal de compuerta abierto no se suelta nada: no se apilan.
      modalAbierto: pendienteInteres != null || ventaPara != null,
    });
    if (d.accion === 'nada') return;
    if (d.accion === 'modal-interes') {
      // La tarjeta espera en Cotizados (override puesto) mientras el modal pide
      // el curso — y ofrece el del formulario como un botón.
      setOverrides((o) => ({ ...o, [c.clave]: 'cotizado' }));
      setPendienteInteres(c);
      return;
    }
    if (d.accion === 'modal-venta') {
      // El cierre no se declara: se gana registrando la venta (la compuerta del
      // server queda intacta). El modal abre el formulario con la conversación
      // precargada; al crear la venta, el server asienta `cierre` solo.
      setVentaPara(c);
      return;
    }
    if (d.accion === 'abrir') {
      // Comentario FB/IG: sin teléfono no hay ficha ni venta — a la Bandeja.
      onAbrir(c);
      return;
    }
    mover.mutate({ c, etapa: d.etapa });
  }

  const etapaArrastrada = arrastrada ? etapaDeTarjeta(arrastrada, overrides) : null;
  const tableroVacio =
    !cargando &&
    (desglose != null || conteos != null) &&
    (desglose?.length ?? Object.keys(conteos ?? {}).length) === 0;

  return (
    // `relative`: la hoja de la ficha se ancla acá adentro (`absolute inset-y-3
    // right-3`), no al viewport — así respeta el padding del tablero y no se
    // mete abajo de la barra de la cabecera.
    <div className="relative flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex min-h-4 shrink-0 items-center gap-3 px-1">
        {arrastrada != null && (
          <p className="text-xs text-muted-foreground">
            A <span className="font-semibold">{ETAPA_ROTULO.cotizado.varios}</span> con curso de
            interés; a <span className="font-semibold">{ETAPA_ROTULO.cierre.varios}</span>,
            registrando la venta. Si falta algo, se pide al soltar.
          </p>
        )}
      </div>

      {servidorSinEtapas && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-secondary/70 px-3 py-2 text-xs text-foreground">
          <AlertTriangle size={14} className="shrink-0 text-temp-frio" />
          <span className="flex-1">
            El server todavía no sirve la etapa efectiva (falta desplegar #88/#89): sin eso el
            tablero mentiría, así que no se pinta.
          </span>
        </div>
      )}

      {aviso && (
        <div
          aria-live="polite"
          className="mb-2 flex items-start gap-2 rounded-lg border border-border bg-secondary/70 px-3 py-2 text-xs text-foreground"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-temp-frio" />
          <span className="flex-1">{aviso}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setAviso(null)}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {cargando ? (
        <div className={GRID}>
          {[4, 2, 2, 2].map((bloques, i) => (
            <div key={i} className="flex min-h-0 flex-col gap-2 rounded-2xl bg-secondary/30 p-2">
              <div className="h-6 w-3/5 animate-pulse rounded-md bg-secondary/70" />
              {Array.from({ length: bloques }, (_, j) => (
                <div key={j} className="h-12 animate-pulse rounded-xl bg-secondary/60" />
              ))}
            </div>
          ))}
        </div>
      ) : servidorSinEtapas ? null : tableroVacio ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-sm font-semibold text-foreground">El embudo está vacío.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Cuando alguien escriba por WhatsApp, Facebook o Instagram, cae solo en la bandeja — y al
            responderle, pasa solo a «{ETAPA_ROTULO.contactado.varios}».
          </p>
        </div>
      ) : (
        <div className={GRID}>
          {columnas.map((col) => {
            const enEtapa = repartidas.get(col.id) ?? [];
            const columna = porColumna[col.id];
            const resumen = resumirColumna(desglose, col.id, conteos);
            const recorte = recorteDe(col.id);
            const opciones = recortesDeColumna(col.id, resumen, recorte);
            // Las DOS cifras: la del recorte manda, el total acompaña («47 · de
            // 3.064»). La regla vive en `tablero.ts`, no acá.
            const cifras = cifrasDeColumna(resumen, recorte, columna.total, enEtapa.length);
            // El «Ver más» cuenta siempre sobre lo que la columna está pidiendo.
            const faltan = quedanPorTraer(cifras.principal, columna.items.length);
            const esDestino = sobre === col.id && arrastrada != null;
            const esPerdidos = false;
            const esCierre = col.id === 'cierre';
            const esTeEsperan = col.id === 'interesado';
            const esContactados = col.id === 'contactado';
            const fondo = esDestino ? 'bg-secondary' : esPerdidos ? 'bg-transparent' : 'bg-secondary/50';
            return (
              <section
                key={col.id}
                aria-label={col.titulo}
                onDragOver={(e) => {
                  e.preventDefault();
                  setSobre(col.id);
                }}
                onDragLeave={() => setSobre((s) => (s === col.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  soltar(col.id);
                }}
                className={
                  'flex min-h-0 flex-col rounded-2xl p-2 transition-colors ' +
                  fondo +
                  (esPerdidos ? ' border border-dashed border-border' : '') +
                  (esDestino && !esCierre ? ' ring-1 ring-primary/40' : '')
                }
              >
                <header className="px-1.5 pb-2 pt-1">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={
                        'font-heading text-xl font-bold tabular-nums ' +
                        (esPerdidos ? 'text-muted-foreground' : 'text-foreground')
                      }
                    >
                      {cifras.principal.toLocaleString('es-PE')}
                    </span>
                    {/* El tamaño real del montón, cuando el recorte lo achica. Sin
                        esto, «47» se leería como si la columna entera fueran 47. */}
                    {cifras.de != null && (
                      <span
                        className="font-mono text-[11px] tabular-nums text-muted-foreground"
                        title={`${cifras.principal.toLocaleString('es-PE')} de ${cifras.de.toLocaleString('es-PE')} en total`}
                      >
                        de {cifras.de.toLocaleString('es-PE')}
                      </span>
                    )}
                    <h3
                      className={
                        'font-heading text-[13px] font-bold ' +
                        (esCierre ? 'text-navy-ink' : esPerdidos ? 'text-muted-foreground' : 'text-foreground')
                      }
                    >
                      {col.titulo}
                    </h3>
                    {esCierre && enEtapa.length > 0 && (
                      <Check size={13} strokeWidth={3} className="self-center text-success" />
                    )}
                  </div>
                  {esCierre && arrastrada != null && etapaArrastrada !== 'cierre' ? (
                    <p className="mt-0.5 text-xs font-semibold leading-tight text-navy-ink">
                      Soltá para registrar la venta
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{col.pista}</p>
                  )}

                  {/*
                    LO QUE SE BAJÓ DE LA TIRA. «Te esperan» son DOS trabajos, no
                    uno: `sin abrir` se abre y `volvieron a escribir` se sigue —
                    es el porqué con el que nació `BandejaDeuda`, y perderlo al
                    volverla columna habría sido cambiar un rótulo por un dato.
                    Va como texto y no como chips a propósito: recortar por esto
                    pide parámetros nuevos en la cola, y esto es front puro.
                    ⚠️ `hayDetalle` es false mientras el server no manda desglose
                    (entre N4 y N5): ahí calla en vez de decir dos ceros.
                  */}
                  {esTeEsperan && bandeja.hayDetalle && bandeja.total > 0 && (
                    <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 font-mono text-[11px] tabular-nums leading-tight text-muted-foreground">
                      {bandeja.vivas > 0 && (
                        <span className="font-semibold text-temp-fresco" title="Escribieron hace menos de 24 h">
                          {bandeja.vivas.toLocaleString('es-PE')} ahora
                        </span>
                      )}
                      <span title="Nadie les contestó nunca">
                        {bandeja.nuevas.toLocaleString('es-PE')} sin abrir
                      </span>
                      <span aria-hidden className="text-muted-foreground/40">·</span>
                      <span title="Ya les hablaste y volvieron a escribir">
                        {bandeja.retomadas.toLocaleString('es-PE')} volvieron
                      </span>
                    </p>
                  )}

                  {/* El botón que vivía en la tira. El trabajo de esta columna NO
                      se hace arrastrando —se hace respondiendo—, así que la
                      acción primaria lleva a Mensajes, no al tablero. */}
                  {esTeEsperan && onIrAMensajes && enEtapa.length > 0 && (
                    <button
                      type="button"
                      onClick={onIrAMensajes}
                      className="group mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 active:scale-[0.98]"
                    >
                      Responder en Mensajes
                      <ArrowRight
                        size={11}
                        className="transition-transform duration-200 ease-house group-hover:translate-x-0.5"
                      />
                    </button>
                  )}

                  {/*
                    EL RECORTE — ahora en CADA columna de trabajo, con su propio
                    estado. Qué chips aparecen lo decide `recortesDeColumna`
                    (puro): la regla del cero, y que Cierre y Perdidos no lleven
                    ninguno, viven ahí con su porqué.

                    Se dibuja solo si hay algo más que «Todas»: un eje solitario
                    que no recorta nada es un botón que no hace nada.
                  */}
                  {opciones.length > 1 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {opciones.map((r) => {
                        const activo = recorte === r.id;
                        const Icono = ICONO_RECORTE[r.id];
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => ponerRecorte(col.id, r.id)}
                            aria-pressed={activo}
                            title={r.ayuda}
                            className={
                              'inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-semibold transition-colors ' +
                              (activo
                                ? 'border-navy bg-navy text-white'
                                : 'border-border text-muted-foreground hover:text-foreground')
                            }
                          >
                            {Icono && <Icono size={10} />}
                            {r.label}
                            {r.n != null && ` ${r.n.toLocaleString('es-PE')}`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </header>

                <div data-scroll-columna className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-0.5">
                  {enEtapa.map((c, i) => (
                    <TarjetaEmbudo
                      key={c.clave}
                      c={c}
                      indice={i}
                      onAbrir={onAbrir}
                      onFicha={setFicha}
                      abierta={ficha?.clave === c.clave}
                      alArrastrar={empezarArrastre}
                      alTerminar={terminarArrastre}
                      arrastrando={arrastrada?.clave === c.clave}
                      rebotada={rebotada === c.clave}
                      // El camino corto solo desde Contactados, y solo donde hay
                      // algo que asentar: un botón en toda tarjeta es ruido.
                      onCotizar={
                        esContactados && (c.precio_enviado || Boolean(c.interes_curso))
                          ? cotizarDesdeTarjeta
                          : undefined
                      }
                      cotizando={mover.isPending && mover.variables?.c.clave === c.clave}
                      columna={col.titulo}
                    />
                  ))}

                  {enEtapa.length === 0 && !esDestino && (
                    <div className="flex flex-1 items-center justify-center px-3 pb-10">
                      <p className="max-w-[24ch] text-center text-[11px] leading-relaxed text-muted-foreground">
                        {vacioDeColumna(recorte, col.vacio)}
                      </p>
                    </div>
                  )}

                  {esDestino && (
                    <div className="rounded-xl border border-dashed border-primary/60 p-3 text-center text-[11px] text-primary">
                      Soltá acá
                    </div>
                  )}

                  {columna.hayMas && (
                    <button
                      type="button"
                      onClick={columna.cargarMas}
                      disabled={columna.cargandoMas}
                      className="rounded-xl border border-dashed border-border py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                    >
                      {columna.cargandoMas
                        ? 'Trayendo…'
                        : faltan > 0
                          ? `Ver más · faltan ${faltan.toLocaleString('es-PE')}`
                          : 'Ver más'}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* LA FICHA AL COSTADO — se superpone al tablero a propósito (el porqué,
          con la cuenta de píxeles, está en `HojaContacto`). Sin scrim: se puede
          tocar otra tarjeta y la hoja cambia de persona sin cerrarse, que es
          justo lo que se hace cuando se está eligiendo a quién atender.

          El Escape se le apaga mientras hay un modal de compuerta encima: los
          dos escuchan en captura, y sin esto una sola tecla cerraría el modal de
          la venta Y la ficha de la persona a la que se le estaba por registrar. */}
      {ficha && (
        <HojaContacto
          conversacion={ficha}
          onCerrar={() => setFicha(null)}
          escapeActivo={pendienteInteres == null && ventaPara == null}
          miVendedora={miVendedora}
          esDeCampana={esDeCampana}
          onMandarCorreo={onMandarCorreo}
          onEscribir={onEscribir}
        />
      )}

      {/* Las compuertas guían: el modal pide lo que falta, ahí mismo. */}
      {pendienteInteres && (
        <ModalInteresCotizado c={pendienteInteres} onGuardado={guardadoInteres} onCancelar={cancelarInteres} />
      )}
      {ventaPara && (
        <ModalVentaCierre
          c={ventaPara}
          onCerrar={() => setVentaPara(null)}
          onAbrir={onAbrir}
          onAgendarBienvenida={onAgendarBienvenida}
        />
      )}
    </div>
  );
}
