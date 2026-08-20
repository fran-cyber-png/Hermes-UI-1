import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlarmClock,
  BadgeCheck,
  ExternalLink,
  Image as Imagen,
  Link2,
  Plus,
  RotateCw,
  Send,
  ServerCrash,
  ShoppingBag,
  Sparkles,
  StickyNote,
  UserPlus,
  Zap,
} from 'lucide-react';
import '../../index.css';

/**
 * LA GALERÍA DEL PANEL DERECHO — la propuesta de rediseño, mirable sin nada vivo detrás.
 *
 * Entry APARTE de Vite (`galeria-panel.html` en la raíz): **no entra al bundle de la app**
 * —`vite build` toma solo `index.html`— y no habla con ningún server. Se abre a mano:
 *
 *     npx vite --port 5199    →    http://localhost:5199/galeria-panel.html
 *
 * ⚠ **Esto NO es el panel que corre.** Es la maqueta de la propuesta: markup estático, sin
 * hooks, sin queries, sin `Conversacion`. Existe para decidir la ESTRUCTURA sobre pixeles
 * antes de tocar `PanelDerecho.tsx`, y para que la comparación «antes / después» sea una
 * captura y no una descripción. Cuando el rediseño se apruebe, esto sobrevive como la
 * evidencia de la regla dura #2 y se le escribe el ADR que archiva al 0017.
 *
 * ══ LAS TRES REGLAS QUE LA MAQUETA DEFIENDE ══════════════════════════════════════════════
 *
 * 1. **Un dato que no está se DIBUJA, no se explica** (Estephano, 27-jul-2026: «lo peor que
 *    podemos hacer es llenarlos de texto con datos vacíos que se pueden mostrar con una
 *    buena UX/UI»). Cerberus caído no es un párrafo: es la fila de datos en guiones
 *    atenuados y un `⟳` que se puede tocar. El matiz —«no sabemos» ≠ «no compró»— vive en
 *    el `title`, no en dieciocho palabras a la vista.
 * 2. **Un fallo se reporta UNA vez, donde se rompió, y con salida.** Hoy Cerberus caído se
 *    anuncia dos veces (banda + timeline) y el asistente caído otras dos (sugerencias +
 *    hechos), en cuatro cajas ámbar sin un solo botón. Acá: una tira por fallo, con `⟳`.
 * 3. **Tres bloques y un pie.** Ficha · Timeline · Enviar rápido, y abajo la acción que
 *    cierra. Los intereses viven SOLO en el timeline: hoy se pintan dos veces —`hitosDe()`
 *    los mete en la historia y `<Intereses>` los repite como chips— y esa duplicación es lo
 *    que obligaba a una cuarta sección.
 *
 * Sin oro en ninguna rama: el dorado de la marca significa tiempo que se acaba, y ni
 * «cliente» ni «lead nuevo» ni una compra de marzo son un reloj.
 */

/* ══════════════════════════════════════════════════════════════════════════════════════ */
/* Primitivas                                                                             */
/* ══════════════════════════════════════════════════════════════════════════════════════ */

type Acento = 'cliente' | 'frio' | 'alerta' | 'neutro';

const FILETE: Record<Acento, string> = {
  cliente: 'bg-success',
  frio: 'bg-temp-frio',
  alerta: 'bg-warning',
  neutro: 'bg-border',
};

const FONDO: Record<Acento, string> = {
  cliente: 'bg-success/[0.05]',
  frio: 'bg-temp-frio/[0.05]',
  alerta: 'bg-warning/[0.07]',
  neutro: '',
};

const PASTILLA: Record<Acento, string> = {
  cliente: 'bg-success/12 text-success',
  frio: 'bg-temp-frio/12 text-temp-frio',
  alerta: 'bg-warning/15 text-warning-foreground',
  neutro: 'bg-secondary text-secondary-foreground',
};

/** La cáscara: 360 px reales (`w-[22.5rem]` en `App.tsx`) y alto de app. */
function Panel({ acento, children }: { acento: Acento; children: ReactNode }) {
  return (
    <div className="flex h-[620px] w-[22.5rem] flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      <div className={'h-[3px] w-full shrink-0 ' + FILETE[acento]} />
      {children}
    </div>
  );
}

/**
 * EL MEDIO — un solo scroll entre la ficha clavada arriba y el pie clavado abajo.
 *
 * ⚠ **Esto es una cicatriz de ADR 0017, y la primera maqueta la reabrió.** Dar `flex-1` al
 * timeline reparte mal en las DOS direcciones: con dos secuencias cargadas lo aplastaba a
 * 50 px y cortaba un hito a la mitad; con un lead nuevo lo estiraba y dejaba 300 px de
 * blanco entre la historia y «Enviar rápido». Se vio en la primera captura de esta misma
 * galería —que es exactamente para lo que existe—.
 *
 * La regla que queda: **los tres bloques valen su contenido y el medio scrollea entero.**
 * El timeline además se acota por dentro (`ALTO_TIMELINE`), así «Enviar rápido» no cambia
 * de altura según cuánta historia tenga la persona: la vendedora manda cincuenta veces por
 * turno y el botón tiene que estar siempre en el mismo lugar.
 */
function Medio({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>;
}

/** El título de un bloque. Uno por bloque — nunca un sub-título adentro. */
function Rotulo({ icono, children, accion }: { icono?: ReactNode; children: ReactNode; accion?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        {icono}
        {children}
      </h3>
      {accion}
    </div>
  );
}

/**
 * LA TIRA DE FALLO — una sola por cosa rota, y siempre con salida.
 *
 * Delgada a propósito: un fallo del asistente no puede ocupar el espacio de la respuesta
 * que no vino. Hoy son dos cajas de 44 px apiladas; esto es una de 26.
 */
function Fallo({ children, titulo }: { children: ReactNode; titulo?: string }) {
  return (
    <div
      title={titulo}
      className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning-foreground"
    >
      <ServerCrash size={12} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold transition-colors hover:bg-warning/20"
      >
        <RotateCw size={10} /> Reintentar
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════ */
/* 1 — FICHA                                                                              */
/* ══════════════════════════════════════════════════════════════════════════════════════ */

interface DatosFicha {
  iniciales: string;
  nombre: string;
  procedencia: string;
  acento: Acento;
  estado: string;
  icono?: ReactNode;
  /** `null` = no se pudo saber. Se dibuja en guiones, no se explica en un párrafo. */
  plata: { monto: string; compras: number } | null;
  /** Cerberus no contestó: la fila lleva `⟳` y el matiz va en el `title`. */
  incierto?: boolean;
  conCerberus?: boolean;
  etiquetas?: readonly { texto: string; tono: 'auto' | 'manual' }[];
}

/**
 * QUIÉN ES — y cuánto vale, en UNA fila de datos.
 *
 * El cambio de fondo respecto de `BandaEstado` es que el `detalle` en prosa desaparece de
 * la superficie. «Cerberus no respondió. No es que sea nueva: es que la ficha no cargó.»
 * son catorce palabras que dicen lo mismo que una pastilla ámbar más un `⟳`: que hay que
 * volver a preguntar. La frase entera sigue existiendo, en el `title` del botón.
 */
function Ficha({ d }: { d: DatosFicha }) {
  return (
    <header className={'shrink-0 px-3 pb-2.5 pt-2.5 ' + FONDO[d.acento]}>
      <div className="flex items-start gap-2.5">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-[13px] bg-card font-heading text-xs font-bold text-navy-ink shadow-[0_0_0_1px_var(--border)]">
          {d.iniciales}
          <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-success" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 font-heading text-sm font-bold leading-tight text-navy-ink">
            {d.nombre}
          </h2>
          <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
            {d.procedencia}
          </p>
        </div>
      </div>

      {/* LA FILA DE DATOS. Una línea, tabular, comparable de un vistazo entre conversaciones. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={
            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ' +
            PASTILLA[d.acento]
          }
        >
          {d.icono}
          {d.estado}
        </span>

        {d.plata ? (
          <span className="font-heading text-[15px] font-bold leading-none tabular-nums text-navy-ink">
            {d.plata.monto}
            <span className="ml-1 font-sans text-[11px] font-medium text-muted-foreground">
              · {d.plata.compras} {d.plata.compras === 1 ? 'compra' : 'compras'}
            </span>
          </span>
        ) : d.incierto ? (
          /* EL DATO QUE NO ESTÁ, DIBUJADO. Los guiones ocupan el lugar exacto de la cifra:
             se lee «acá va plata y no la tengo», que es distinto de «no hay plata». */
          <button
            type="button"
            title="No se pudo consultar Cerberus. No sabemos si compró — que no es lo mismo que no haber comprado."
            className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-warning/15"
          >
            <span className="font-heading text-[15px] font-bold leading-none tabular-nums text-muted-foreground/40">
              — · —
            </span>
            <RotateCw size={11} className="text-warning-foreground" />
          </button>
        ) : null}

        {d.conCerberus && (
          <a
            href="#0"
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary transition-colors hover:text-primary-hover hover:underline"
          >
            Cerberus <ExternalLink size={10} />
          </a>
        )}
      </div>

      {d.etiquetas && d.etiquetas.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {d.etiquetas.map((e) => (
            <span
              key={e.texto}
              className={
                'rounded-md px-1.5 py-0.5 text-[10px] font-semibold ' +
                (e.tono === 'manual'
                  ? 'border border-cat-morado/50 text-cat-morado'
                  : 'bg-muted text-muted-foreground')
              }
            >
              {e.texto}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════ */
/* 2 — TIMELINE (absorbe «Le interesa»)                                                   */
/* ══════════════════════════════════════════════════════════════════════════════════════ */

type Hito =
  | { tipo: 'compra'; texto: string; sub: string; fecha: string }
  | { tipo: 'interes'; texto: string; sub: string; fecha: string; porConfirmar?: boolean };

/**
 * QUÉ PASÓ ANTES — compras e intereses en una sola columna, y el alta adentro.
 *
 * ══ POR QUÉ ESTO ABSORBE A «LE INTERESA» ═════════════════════════════════════════════════
 * En el panel de hoy los intereses registrados se pintan DOS veces: `hitosDe()` los mezcla
 * en la historia y `<Intereses compacto>` los repite como chips en su propia sección. Dos
 * lugares, un dato — la redundancia que el design system prohíbe de frente. Fusionarlos es
 * lo que hace que el pedido de tres bloques cierre sin perder nada: el interés propuesto
 * («Bicameral · del formulario · Confirmar») pasa a su lugar cronológico, arriba de todo,
 * que es donde se entiende sin necesidad de un título que lo presente.
 *
 * El alta («+ Anotar interés») va en la cabecera del bloque y no en una sección aparte: sin
 * una forma de escribir, el timeline es de solo lectura para siempre y nunca se llena.
 */
function Timeline({
  hitos,
  vacio,
  incierto,
}: {
  hitos: readonly Hito[];
  /** Sin historia. Se dibuja el riel punteado, no se escribe un párrafo. */
  vacio?: boolean;
  /** Cerberus caído: el riel se muestra fantasma. NO se repite el aviso de la ficha. */
  incierto?: boolean;
}) {
  return (
    <section className="shrink-0 border-t border-border px-3 py-2.5">
      <Rotulo
        accion={
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary transition-colors hover:text-primary-hover"
          >
            <Plus size={11} /> Anotar interés
          </button>
        }
      >
        Historia
      </Rotulo>

      {/* Acotado por dentro: cinco hitos entran, el resto scrollea acá adentro y NO
          empuja «Enviar rápido» hacia abajo. Una persona con doce compras es una buena
          noticia, no un motivo para que se mueva el botón que se usa cincuenta veces. */}
      <div className="mt-2 max-h-[10.5rem] overflow-y-auto">
        <div className="relative pl-1">
        <span
          className={
            'absolute left-[0.3125rem] top-1.5 bottom-1.5 w-px ' +
            (vacio || incierto ? 'border-l border-dashed border-border' : 'bg-border')
          }
          aria-hidden="true"
        />

        {/* CERBERUS CAÍDO — el hueco tiene la forma de lo que falta. Tres renglones
            fantasma dicen «acá iban compras» sin afirmar que no las haya, y sin gastar
            una sola palabra: el aviso ya lo dio la ficha, arriba, con su `⟳`. */}
        {incierto && (
          <ul className="space-y-2.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-2.5 opacity-45">
                <span className="size-1.5 shrink-0 rounded-full border border-dashed border-muted-foreground/50 bg-card" />
                <span className="h-2.5 rounded bg-muted" style={{ width: `${58 - i * 12}%` }} />
              </li>
            ))}
          </ul>
        )}

        {/* VACÍO DE VERDAD — una línea y una salida, no tres renglones de prosa. */}
        {vacio && (
          <div className="flex items-center gap-2.5">
            <span className="size-1.5 shrink-0 rounded-full border border-dashed border-muted-foreground/50 bg-card" />
            <button
              type="button"
              className="text-[11.5px] font-semibold text-primary transition-colors hover:text-primary-hover"
            >
              Anotar el primer interés
            </button>
          </div>
        )}

        {!vacio && !incierto && (
          <ol className="space-y-2.5">
            {hitos.map((h, i) => {
              const esCompra = h.tipo === 'compra';
              return (
                <li key={i} className="relative flex gap-2.5">
                  <span
                    className={
                      'relative z-10 mt-[0.3125rem] size-1.5 shrink-0 rounded-full ring-2 ring-card ' +
                      (esCompra ? 'bg-success' : 'border border-muted-foreground/60 bg-card')
                    }
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={
                          'flex min-w-0 items-center gap-1 text-[11.5px] ' +
                          (esCompra ? 'font-semibold text-foreground' : 'text-foreground/90')
                        }
                      >
                        {esCompra ? (
                          <ShoppingBag size={11} className="shrink-0 text-success" />
                        ) : (
                          <Sparkles size={11} className="shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{h.texto}</span>
                      </span>
                      <time className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                        {h.fecha}
                      </time>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[10px] text-muted-foreground">{h.sub}</p>
                      {/* El chip de confirmar vive en su renglón cronológico: es un hito
                          propuesto, no una sección. Un clic y deja de ser propuesta. */}
                      {h.tipo === 'interes' && h.porConfirmar && (
                        <button
                          type="button"
                          className="shrink-0 rounded-md bg-navy px-1.5 py-0.5 text-[10px] font-bold text-white transition-colors hover:bg-navy/90"
                        >
                          Confirmar
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════ */
/* 3 — ENVIAR RÁPIDO                                                                      */
/* ══════════════════════════════════════════════════════════════════════════════════════ */

interface Secuencia {
  rotulo: string;
  porque: string;
  pasos: string;
  conImagen?: boolean;
  vistaPrevia: string;
}

/**
 * QUÉ LE MANDO YA — los dos calibres de la misma pregunta, bajo UN título.
 *
 * Lo que se va respecto de hoy: los dos sub-títulos («Para responder ahora», «Datos que
 * ayudan acá»), el párrafo de `PORQUE_DEL_MOMENTO` y el renglón «tocá para ponerlo en la
 * caja». Eran tres niveles de título y dos explicaciones en 360 px de ancho.
 *
 * Lo que queda y NO se negocia: la distinción de gesto de #45. La secuencia se **manda**
 * (botón explícito, sale por `EnvioControlado`); el hecho **cae en la caja** (píldora, no
 * envía). Por eso son dos formas distintas —tarjeta y píldora— y no una lista uniforme:
 * la forma es la que enseña qué va a pasar al tocar, sin un renglón que lo aclare.
 */
function EnviarRapido({
  secuencias,
  hechos,
  falla,
}: {
  secuencias: readonly Secuencia[];
  hechos: readonly string[];
  falla?: boolean;
}) {
  return (
    <section className="shrink-0 border-t border-border px-3 py-2.5">
      <Rotulo icono={<Zap size={12} />}>Enviar rápido</Rotulo>

      <div className="mt-1.5 space-y-1.5">
        {falla ? (
          /* UNA tira, no dos cajas. Las sugerencias y los hechos fallan juntos casi
             siempre (mismo server), y para la vendedora son un solo hecho: el asistente
             no cargó. Reportarlo dos veces no informa el doble, gasta el doble. */
          <Fallo titulo="Ni las respuestas sugeridas ni los datos recomendados se pudieron traer del server.">
            El asistente no cargó
          </Fallo>
        ) : (
          <>
            {/* SIN SECUENCIA QUE ENCAJE — no se inventa una. Un renglón y la salida a
                elegir a mano; hoy son tres renglones de prosa explicando la abstención. */}
            {secuencias.length === 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  Ninguna secuencia encaja acá
                </span>
                <button
                  type="button"
                  className="shrink-0 text-[11px] font-bold text-primary transition-colors hover:text-primary-hover"
                >
                  Elegir
                </button>
              </div>
            )}
            {secuencias.map((s, i) => (
              <div
                key={s.rotulo}
                className={
                  'rounded-xl border p-2 transition-colors ' +
                  (i === 0 ? 'border-primary/35 bg-secondary/40' : 'border-border bg-card')
                }
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="font-heading text-xs font-bold text-navy-ink">{s.rotulo}</span>
                  {s.conImagen && <Imagen size={10} className="shrink-0 text-muted-foreground" />}
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    {s.pasos}
                  </span>
                </div>
                {/* El «por qué» pasa de dos renglones a uno: es contexto, no argumento. */}
                <p className="mt-0.5 truncate text-[10px] leading-snug text-muted-foreground">
                  {s.porque}
                </p>
                <button
                  type="button"
                  className="mt-1.5 block w-full rounded-lg bg-card/80 p-1.5 text-left transition-colors hover:bg-card"
                >
                  <span className="line-clamp-2 text-[11px] leading-relaxed text-foreground">
                    {s.vistaPrevia}
                  </span>
                </button>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    className={
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-[background-color,transform] duration-200 ease-house active:scale-[0.98] ' +
                      (i === 0
                        ? 'bg-navy text-white shadow-[0_4px_14px_-6px_rgba(14,42,82,0.6)] hover:bg-navy/90'
                        : 'border border-border text-foreground hover:bg-muted')
                    }
                  >
                    <Send size={11} /> Mandar
                  </button>
                  <button
                    type="button"
                    className="ml-auto text-[10px] font-semibold text-muted-foreground transition-colors hover:text-primary"
                  >
                    Ver secuencia
                  </button>
                </div>
              </div>
            ))}

            {/* LOS HECHOS COMO PÍLDORAS. De filas de dos renglones (rótulo + texto
                truncado, 38 px cada una) a una fila que envuelve: los tres entran en el
                alto de uno solo. La frase entera vive en el `title`. */}
            {hechos.length > 0 && (
              <ul className="flex flex-wrap gap-1 pt-0.5">
                {hechos.map((h) => (
                  <li key={h}>
                    <button
                      type="button"
                      title="Tocá para ponerlo en la caja (no lo manda)"
                      className="rounded-full border border-border bg-card px-2 py-[3px] text-[11px] font-medium text-navy-ink transition-colors hover:border-primary/40 hover:bg-secondary/40"
                    >
                      {h}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════ */
/* 4 — EL PIE                                                                             */
/* ══════════════════════════════════════════════════════════════════════════════════════ */

/**
 * QUÉ HAGO — clavado, y con UNA sola acción primaria.
 *
 * Vuelve «Registrar venta», que el rediseño del 27-jul había sacado del panel (hoy cerrar
 * una venta solo se puede desde la `BarraGestion` del chat). Pedido de Estephano: *«le
 * agregamos también para que registre la venta y herramientas útiles, pero que no se vea
 * muy cargado»*.
 *
 * Las herramientas son tres íconos SIN etiqueta, con `title`: nota, recordatorio y «es la
 * misma persona». Sin etiqueta porque el pie tiene que costar 48 px, no 96; y tres y no
 * seis porque llamar y agendar YA están en la cabecera del chat, a 40 px de distancia —
 * repetirlas acá sería la redundancia que este rediseño vino a sacar.
 *
 * Clavado y no al final del scroll por la lección de ADR 0017: a 1280×720 con dos
 * respuestas cargadas, el reparto flex empujaba «Registrar venta» fuera del panel.
 */
function Pie() {
  const herramientas = [
    { Icono: StickyNote, title: 'Nota sobre esta persona' },
    { Icono: AlarmClock, title: 'Recordarme volver a escribirle' },
    { Icono: Link2, title: 'Es la misma persona que…' },
  ];
  return (
    <footer className="shrink-0 border-t border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-bold text-white shadow-[0_4px_14px_-6px_rgba(14,42,82,0.6)] transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98]"
        >
          <BadgeCheck size={13} /> Registrar venta
        </button>
        {herramientas.map(({ Icono, title }) => (
          <button
            key={title}
            type="button"
            title={title}
            aria-label={title}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-navy-ink"
          >
            <Icono size={15} />
          </button>
        ))}
      </div>
    </footer>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════ */
/* Los estados                                                                            */
/* ══════════════════════════════════════════════════════════════════════════════════════ */

const SECUENCIAS: Secuencia[] = [
  {
    rotulo: 'Pasar el precio',
    porque: 'Ya vio el material y todavía no sabe cuánto cuesta',
    pasos: '3 mensajes',
    conImagen: true,
    vistaPrevia:
      'Cliver, el Diploma en Gestión Parlamentaria tiene una inversión de S/ 590 e incluye el certificado.',
  },
  {
    rotulo: 'Reenganchar',
    porque: 'Dejó de contestar hace 4 días',
    pasos: '1 mensaje',
    vistaPrevia: 'Cliver, ¿pudiste ver la información que te pasé? Cualquier duda te la resuelvo.',
  },
];

const HECHOS = ['Se puede en 2 cuotas', 'Acceso por 1 año', 'Público general'];

function Cliente() {
  return (
    <Panel acento="cliente">
      <Ficha
        d={{
          iniciales: 'CV',
          nombre: 'Cliver Villanueva Rojas',
          procedencia: 'de Cerberus · en WhatsApp: CVILLANUEVA',
          acento: 'cliente',
          estado: 'Cliente',
          icono: <BadgeCheck size={11} strokeWidth={2.4} />,
          plata: { monto: 'S/ 1.240', compras: 3 },
          conCerberus: true,
          etiquetas: [
            { texto: 'Cotizado', tono: 'auto' },
            { texto: 'Decide en julio', tono: 'manual' },
          ],
        }}
      />
      <Medio>
        <Timeline
          hitos={[
            { tipo: 'interes', texto: 'Bicameral', sub: 'Le interesó', fecha: 'hoy' },
            { tipo: 'compra', texto: 'S/ 590', sub: 'Gestión Parlamentaria · pagada', fecha: '14 mar' },
            { tipo: 'compra', texto: 'S/ 650', sub: 'Consultoría Política · pagada', fecha: '2 mar' },
            { tipo: 'interes', texto: 'Foro de Estado', sub: 'Le interesó', fecha: '18 feb 25' },
          ]}
        />
        <EnviarRapido secuencias={SECUENCIAS} hechos={HECHOS} />
      </Medio>
      <Pie />
    </Panel>
  );
}

function LeadNuevo() {
  return (
    <Panel acento="neutro">
      <Ficha
        d={{
          iniciales: 'CV',
          nombre: 'Cliver',
          procedencia: 'del formulario · en WhatsApp: CVILLANUEVA',
          acento: 'neutro',
          estado: 'Lead nuevo',
          icono: <UserPlus size={11} strokeWidth={2.4} />,
          plata: null,
        }}
      />
      <Medio>
        <Timeline
          hitos={[
            {
              tipo: 'interes',
              texto: 'Bicameral',
              sub: 'del formulario',
              fecha: 'hoy',
              porConfirmar: true,
            },
          ]}
        />
        <EnviarRapido secuencias={[SECUENCIAS[0]]} hechos={HECHOS} />
      </Medio>
      <Pie />
    </Panel>
  );
}

function CerberusCaido() {
  return (
    <Panel acento="alerta">
      <Ficha
        d={{
          iniciales: 'CV',
          nombre: 'Cliver',
          procedencia: 'del formulario · en WhatsApp: CVILLANUEVA',
          acento: 'alerta',
          estado: 'No se pudo saber',
          plata: null,
          incierto: true,
        }}
      />
      <Medio>
        <Timeline hitos={[]} incierto />
        <EnviarRapido secuencias={[SECUENCIAS[0]]} hechos={HECHOS} />
      </Medio>
      <Pie />
    </Panel>
  );
}

function AsistenteCaido() {
  return (
    <Panel acento="cliente">
      <Ficha
        d={{
          iniciales: 'CV',
          nombre: 'Cliver Villanueva Rojas',
          procedencia: 'de Cerberus · en WhatsApp: CVILLANUEVA',
          acento: 'cliente',
          estado: 'Cliente',
          icono: <BadgeCheck size={11} strokeWidth={2.4} />,
          plata: { monto: 'S/ 1.240', compras: 3 },
          conCerberus: true,
        }}
      />
      <Medio>
        <Timeline
          hitos={[
            { tipo: 'compra', texto: 'S/ 590', sub: 'Gestión Parlamentaria · pagada', fecha: '14 mar' },
          ]}
        />
        <EnviarRapido secuencias={[]} hechos={[]} falla />
      </Medio>
      <Pie />
    </Panel>
  );
}

function Vacio() {
  return (
    <Panel acento="neutro">
      <Ficha
        d={{
          iniciales: 'RO',
          nombre: 'ROYER',
          procedencia: 'en WhatsApp: ROYER',
          acento: 'neutro',
          estado: 'Lead nuevo',
          icono: <UserPlus size={11} strokeWidth={2.4} />,
          plata: null,
        }}
      />
      <Medio>
        <Timeline hitos={[]} vacio />
        <EnviarRapido secuencias={[]} hechos={HECHOS} />
      </Medio>
      <Pie />
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════ */
/* EL ANTES — el panel de hoy, reproducido fiel para que la comparación sea una captura   */
/* ══════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Copia literal de lo que hoy pinta `PanelDerecho.tsx` cuando Cerberus no contesta y el
 * server no sirve sugerencias ni hechos — o sea, la captura que Estephano mandó.
 *
 * Sirve para una sola cosa: contar. **67 palabras y cero datos de la persona**, con
 * «Cerberus no contestó» dicho dos veces y «el asistente no cargó» dicho otras dos, en
 * cuatro cajas sin un botón que las resuelva. No es un hombre de paja: es el markup de
 * `estadoContacto.ts:107`, `TimelineContacto.tsx:43`, `DosRespuestas.tsx:174` y
 * `BloqueHechos.tsx:112`, con sus textos exactos.
 */
function Antes() {
  return (
    <div className="flex h-[620px] w-[22.5rem] flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      <div className="h-[3px] w-full shrink-0 bg-warning" />
      <div className="bg-warning/[0.07] px-3 pb-2.5 pt-2.5">
        <div className="flex items-start gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-card font-heading text-xs font-bold text-navy-ink shadow-[0_0_0_1px_var(--border)]">
            CV
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-sm font-bold leading-tight text-navy-ink">Cliver</h2>
            <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
              del formulario · en WhatsApp: CVILLANUEVA
            </p>
          </div>
        </div>
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning-foreground">
            No se pudo saber
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Cerberus no respondió. No es que sea nueva: es que la ficha no cargó.
        </p>
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <h3 className="text-xs font-semibold text-muted-foreground">Su historia</h3>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          No se pudo consultar Cerberus, así que <strong className="font-semibold">no sabemos</strong>{' '}
          si compró. No es lo mismo que no haber comprado.
        </p>
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">Le interesa</h3>
          <span className="text-[11px] font-semibold text-primary">Buscar curso</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-navy-ink">
            Bicameral · del formulario
            <span className="rounded bg-navy px-1.5 py-0.5 text-[10px] font-bold text-white">
              Confirmar
            </span>
          </span>
        </div>
      </div>

      <div className="border-t border-border px-3 pt-2.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Zap size={12} /> Enviar rápido
        </h3>
      </div>
      <div className="px-3 py-2.5">
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px] leading-relaxed text-warning-foreground">
          <ServerCrash size={13} className="mt-0.5 shrink-0" />
          No se pudieron traer las respuestas sugeridas.
        </p>
      </div>
      <div className="border-t border-border px-3 py-2.5">
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-[11px] leading-snug text-warning-foreground">
          <ServerCrash size={12} className="mt-0.5 shrink-0" />
          No se pudieron traer los datos recomendados.
        </p>
      </div>
      <div className="flex-1" />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════ */
/* La vitrina                                                                             */
/* ══════════════════════════════════════════════════════════════════════════════════════ */

function Caso({ titulo, nota, children }: { titulo: string; nota: string; children: ReactNode }) {
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption>
        <h2 className="font-heading text-sm font-bold text-navy-ink">{titulo}</h2>
        <p className="mt-0.5 max-w-[22.5rem] text-xs leading-snug text-muted-foreground">{nota}</p>
      </figcaption>
      {children}
    </figure>
  );
}

function Galeria() {
  return (
    <main className="min-h-dvh bg-muted px-8 py-8">
      <header className="mb-8 max-w-3xl">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Propuesta · no es el panel que corre
        </p>
        <h1 className="mt-1 font-heading text-2xl font-extrabold text-navy-ink">
          El panel derecho: Ficha · Timeline · Enviar rápido
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Tres bloques y un pie. Los intereses viven <strong>solo</strong> en el timeline —hoy se
          pintan dos veces— y por eso la cuarta sección desaparece sin que se pierda nada. Un dato
          que no está se dibuja; un fallo se reporta una vez y con salida.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          El caso de la captura — antes y después
        </h2>
        <div className="flex flex-wrap gap-6">
          <Caso
            titulo="Antes"
            nota="Cerberus caído y el server sin sugerencias. 67 palabras, cero datos de la persona, cuatro cajas y ningún botón que resuelva nada."
          >
            <Antes />
          </Caso>
          <Caso
            titulo="Después"
            nota="El mismo estado: 9 palabras. La cifra que falta se dibuja en guiones con su ⟳; el timeline muestra el hueco con la forma de lo que falta; un solo fallo del asistente; y el pie sigue ofreciendo la acción que cierra."
          >
            <CerberusCaido />
          </Caso>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Los otros cuatro estados
        </h2>
        <div className="flex flex-wrap gap-6">
          <Caso
            titulo="Cliente con compras"
            nota="El caso rico: la plata en la fila de datos, compras e intereses en una sola secuencia cronológica."
          >
            <Cliente />
          </Caso>
          <Caso
            titulo="Lead nuevo"
            nota="El interés que viene del formulario ocupa su renglón cronológico, con Confirmar al lado. Sin sección aparte."
          >
            <LeadNuevo />
          </Caso>
          <Caso
            titulo="Asistente caído"
            nota="La ficha y el timeline funcionan. Una sola tira delgada por el bloque que no cargó, con Reintentar."
          >
            <AsistenteCaido />
          </Caso>
          <Caso
            titulo="Sin historia"
            nota="El riel punteado con un solo renglón: la salida es la acción, no un párrafo que explique el vacío."
          >
            <Vacio />
          </Caso>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <Galeria />
  </StrictMode>,
);
