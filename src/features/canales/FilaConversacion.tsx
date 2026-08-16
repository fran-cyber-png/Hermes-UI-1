import { useEffect, useRef, useState, type Ref } from 'react';
import { Bot, Check, Clock, Pin, Star, UserRound } from 'lucide-react';
import { temperatureOf, TEMPERATURE_META } from '../leads/temperature';
import { hace } from '../../lib/datos/frescura';
import { formatoTelefono } from '../../lib/formato';
import { textoDePreview } from '../../lib/preview';
import { ETAPA_CHIP, rotuloEtapa } from '../../lib/etapas';
import {
  CLASE_BORDE,
  CLASE_FONDO_SUAVE,
  CLASE_FONDO_TENUE,
  CLASE_TEXTO,
  resolverColor,
} from '../../dominio/paletaCategorias';
import { cursoDeFila, detalleDeCurso } from '../../dominio/curso';
import { marcaDeCliente, type NivelCliente } from '../../dominio/cliente';
import { marcaDelBot, type TonoBot } from './bot';
import { marcaDeDueno, type TonoDueno } from '../../dominio/dueno';
import { BadgeCanal } from '../../components/BadgeCanal';
import { Avatar } from '../../components/Avatar';
import { VENTANA_DIAS } from './types';
import { lecturaDeVentana } from '../../dominio/ventana';
import type { Conversacion } from '../../dominio/conversaciones';
import { esPrioritaria, quiereFoto, siguienteConFoto } from '../../dominio/fotoVisible';

/**
 * Prende `conFoto` con el propio IntersectionObserver de la fila (guardarraíl
 * anti-ban de #71/#59, lógica pura en `fotoVisible.ts`). Las primeras N filas
 * ni observan: ya arrancan con `conFoto` en `true`, así el primer pintado no
 * tiene el parpadeo iniciales→foto. El resto observa hasta que entra al
 * viewport UNA vez — ahí se desconecta (sticky, no repite el fetch al
 * scrollear de un lado a otro). Las filas de canales sin foto (FB/IG,
 * `quiereFoto`) ni instancian el observer.
 *
 * `root`: el que clipea la fila no es el viewport del documento, es el `<div
 * data-scroll-cola>` de `ColaUnificada` — sin decirle eso al observer,
 * `rootMargin` mide contra la ventana entera y no anticipa nada real.
 */
function useConFotoVisible(indice: number | undefined, canal: string) {
  const prioritaria = esPrioritaria(indice) && quiereFoto(canal);
  const [conFoto, setConFoto] = useState(prioritaria);
  const elRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (conFoto || !quiereFoto(canal) || typeof IntersectionObserver === 'undefined') return;
    const el = elRef.current;
    if (!el) return;
    const root = el.closest<HTMLElement>('[data-scroll-cola]');
    const observer = new IntersectionObserver(
      (entradas) => setConFoto((actual) => siguienteConFoto(actual, entradas)),
      { root, rootMargin: '200px' }, // llega un poco antes de que la fila esté del todo a la vista
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [conFoto, canal]);

  return { conFoto, elRef };
}

/**
 * LA MARCA DE EX-CLIENTE (#133): tres pesos del MISMO verde, que en Hermes ya
 * significa «cliente» (la banda del panel derecho, ADR 0017 §1 — si acá fuera de
 * otro color, el mismo hecho tendría dos idiomas). Rampa: contorno → relleno
 * suave → sólido, del que compró una vez al VIP. **Sin oro**: el oro es tiempo
 * que se acaba y un cliente no es un reloj.
 *
 * Píldora `rounded-full` con borde, distinta de forma del chip de etapa (recto,
 * sin borde) y del de curso (recto, fondo suave): en una fila de 360 px la forma
 * desambigua más rápido que el color.
 */
const CLASE_MARCA: Record<NivelCliente, string> = {
  compro: 'border-success/40 text-success',
  recompro: 'border-success/50 bg-success/10 text-success',
  vip: 'border-success bg-success text-success-foreground',
};

/**
 * LO QUE EL BOT DIJO — píldora de FONDO tenue, como toda señal automática de la
 * casa («Cotizado», «Se enfrió»; ADR 0016). Fondo y no borde es lo que la separa
 * de una categoría manual sin leer un tooltip: esta no la puso nadie y no se
 * puede borrar. **Sin oro** — el oro es tiempo que se acaba y esto no es un reloj.
 *
 * `rojo` para la escalada (el bot se frenó: mientras nadie entre, el lead no
 * recibe nada) y `naranja` para la caliente (una oportunidad que el bot sigue
 * trabajando). Los dos de la paleta cerrada `--cat-*`, la misma de las otras
 * señales — una señal, un vocabulario.
 *
 * El ícono no es decoración: «Caliente» a secas chocaría con la temperatura que
 * la fila ya codifica en la banda de 3 px (`temperatureOf`, que mide días de
 * espera). El ícono dice de quién es la opinión antes de leerla.
 */
const CLASE_BOT: Record<TonoBot, string> = {
  escalada: CLASE_FONDO_TENUE.rojo + ' ' + CLASE_TEXTO.rojo,
  caliente: CLASE_FONDO_TENUE.naranja + ' ' + CLASE_TEXTO.naranja,
};

/**
 * DE QUIÉN ES ESTA CONVERSACIÓN (reparto, 4-ago-2026) — píldora de BORDE, no de
 * fondo, y ahí está la mitad del significado: el fondo tenue es el idioma de lo
 * automático («Cotizado», «Se enfrió», el bot) y el borde el de lo que decidió
 * alguien. El reparto es una decisión del equipo sobre quién atiende a quién, no
 * una lectura de la máquina sobre el hilo.
 *
 * Neutro: informa sin gritar — una fila ajena no es una alarma, es un «ya tiene
 * dueño». **Sin oro**, que es tiempo que se acaba.
 *
 * ⚠️ Hubo un tono `vos` en navy y **se retiró**: quien está en el reparto ve solo
 * lo suyo, así que habría sido la misma píldora en todas las filas.
 *
 * El ícono no es decoración: sin él, la píldora de borde neutro se confunde con
 * la de categoría manual, que es exactamente igual de forma. Acá la forma sola no
 * alcanza y el ícono dice «esto es una persona» antes de leer el nombre.
 */
const CLASE_DUENO: Record<TonoDueno, string> = {
  otra: 'border-border text-muted-foreground',
};

/**
 * Una conversación en la cola, en dos renglones: quién (con su urgencia a la
 * derecha) y qué dijo. Lo pendiente habla en tinta plena; lo respondido baja a
 * gris — la página decide qué se lee primero.
 *
 * Sucedió a `FilaInteraccion` (archivada, ver ADR 0004). La banda de 3 px de la
 * izquierda es SIEMPRE temperatura, en esta lista y en todas; el oro aparece
 * solo en la ventana de Meta corriendo: tiempo que se acaba.
 */
export function FilaConversacion({
  c,
  seleccionada,
  onAbrir,
  etapa,
  mostrarPregunto = true,
  catalogoCategorias,
  miVendedora,
  esNueva = false,
  indice,
  tabIndex,
  onFocus,
  ref,
}: {
  c: Conversacion;
  seleccionada: boolean;
  onAbrir: (c: Conversacion) => void;
  /** Etapa del embudo si el shell la conoce — chip vía `ETAPA_CHIP` compartido. */
  etapa?: string | null;
  /** Dentro del filtro de pedidos el chip es redundante: se apaga desde afuera. */
  mostrarPregunto?: boolean;
  /** El catálogo de la vendedora, para resolver el color de la píldora de categoría (#49). */
  catalogoCategorias?: readonly { nombre: string; color: string }[];
  /** Quién está mirando: sin esto no se puede saber qué fila es ajena (`dueno.ts`). */
  miVendedora?: string | null;
  /** Solo la fila recién llegada por SSE entra animada, nunca la lista entera. */
  esNueva?: boolean;
  /** Posición en la lista — decide si es de las primeras N con foto prioritaria (`fotoVisible.ts`). */
  indice?: number;
  /** Roving tabindex: la cola se recorre con ↑↓ + Enter. */
  tabIndex?: number;
  onFocus?: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { conFoto, elRef } = useConFotoVisible(indice, c.canal);
  const temp = TEMPERATURE_META[temperatureOf(c.referencia)];
  const restan = VENTANA_DIAS - c.dias;
  /**
   * Cuánto le queda de ventana a esta conversación. Se recalcula en cada render
   * y no se memoiza: el dato ES el paso del tiempo, y un `useMemo` con `[c]` lo
   * congelaría hasta que la fila cambie por otro motivo.
   */
  const ventana = lecturaDeVentana(c.ventana_cierra, new Date());
  const esTelefono = !c.persona_nombre && c.canal === 'whatsapp' && c.persona_id != null;
  const nombre = c.persona_nombre ?? (esTelefono ? formatoTelefono(c.persona_id!) : 'Usuario');
  // Horas reales desde la referencia — `c.dias` son días enteros, así que abajo
  // de un día daba siempre 0 → "hace 1 min". Con las horas, "hace 3 horas" es cierto.
  const horas = (Date.now() - new Date(c.referencia).getTime()) / 3_600_000;

  // Peso invertido: lo pendiente en tinta plena, lo resuelto en gris.
  const pesoNombre = esTelefono
    ? 'font-mono font-medium tabular-nums'
    : c.respondida
      ? 'font-medium'
      : 'font-semibold';
  const tintaNombre = c.respondida ? 'text-muted-foreground' : 'text-foreground';
  const clasePreview = c.respondida
    ? 'text-muted-foreground'
    : c.pregunto
      ? 'font-medium text-foreground'
      : 'text-foreground';
  const chipEtapa = etapa ? (ETAPA_CHIP[etapa] ?? 'bg-secondary text-secondary-foreground') : '';
  // Las categorías de la fila, resueltas al color de quien mira (#49). La píldora
  // usa BORDE de color (nunca sombra, nunca oro) — la banda de 3px es temperatura.
  const categorias = c.categorias ?? [];
  const catalogo = catalogoCategorias ?? [];
  /**
   * EL CURSO MANDA SOBRE «PIDE INFO» (#72). En el censo de producción del
   * 25-jul-2026, 311 de 1.867 conversaciones llevan «Pide info» — pero entre las
   * 478 que están sin responder (donde la vendedora realmente trabaja) son 311:
   * dos de cada tres. Un chip que aparece en dos de cada tres filas del trabajo
   * pendiente no ayuda a elegir a quién atender primero; QUÉ CURSO quiere, sí.
   *
   * Conviven como pidió el dueño, pero en una fila de 360 px no entran los dos:
   * cuando se sabe el curso, gana el curso (es el dato más accionable), y
   * «Pide info» queda de respaldo para las filas sin curso conocido.
   */
  const curso = cursoDeFila(c);
  /**
   * ¿YA NOS COMPRÓ? (#133) — 140 de las 1.997 conversaciones vivas, hoy
   * indistinguibles de un desconocido. Va en el renglón 1 porque es identidad
   * («quién es»), no estado del hilo, y pegada al nombre porque lo califica.
   *
   * Lo que cede espacio es el NOMBRE, que ya truncaba: un nombre cortado sigue
   * reconociéndose, una marca ausente es invisible. Y solo cede en el 7% de las
   * filas.
   */
  const marca = marcaDeCliente(c);
  /**
   * EL VEREDICTO DEL BOT (`bot.ts`), y ocupa el MISMO lugar que el curso.
   *
   * No es que sobre espacio: en 360 px el renglón 2 ya lleva curso + categoría +
   * preview. La razón es que los dos responden la misma pregunta —«¿qué pasa con
   * esta?»— y el bot da la respuesta más fuerte: «el bot se frenó y te espera»
   * manda sobre «quiere el diploma de Inteligencia».
   *
   * ⚠️ Y hay un precio, escrito para que sea una decisión y no un accidente: en
   * las filas donde el bot habló, el chip de curso no se ve. Hoy no cuesta nada
   * —el bot corre en UNA línea que vende UN diploma, así que ahí el curso dice lo
   * mismo en todas las filas—, pero el día que el bot atienda una línea con
   * varios cursos hay que volver acá.
   */
  const bot = marcaDelBot(c);
  /**
   * DE QUIÉN ES (`dueno.ts`), y va en el RENGLÓN 1 — al lado de la marca de
   * cliente, no abajo con el bot y el curso.
   *
   * ⚠️ Primero se probó en el renglón 2 y **no entra**. Ese renglón ya lleva
   * bot/curso + categoría + preview + conteo, y el peor caso no es raro: es el
   * MÁS FRECUENTE de la línea que importa, porque el bot corre justo en la línea
   * que se reparte. Con dueño + bot ahí, el preview quedaba en «Bue…» —o sea, la
   * fila perdía lo único que dice de qué se está hablando— (captura:
   * `docs/evidencia/reparto-cola.png`).
   *
   * Arriba el costo ya está pagado y decidido: lo que cede ancho es el NOMBRE,
   * que ya truncaba, y «un nombre cortado sigue reconociéndose» (la misma razón
   * escrita para la marca de ex-cliente, #133). Además son preguntas del mismo
   * plano —«¿de quién es esto?» junto a «¿quién es esta persona?»—, mientras que
   * el renglón 2 responde «¿qué pasa con la conversación?».
   */
  const dueno = marcaDeDueno(c, { yo: miVendedora });

  return (
    <button
      type="button"
      ref={(el) => {
        // Dos dueños del mismo nodo: el roving-tabindex del shell (`ref`,
        // viene de afuera) y el IntersectionObserver de la foto (`elRef`,
        // interno). React 19 no mergea refs solo — se hace a mano acá.
        elRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onClick={() => onAbrir(c)}
      className={
        // `pr-9`: el canal reservado para la flechita ▼ del menú de la fila
        // (`MenuFila`, se monta afuera del botón). Se reserva SIEMPRE, esté la
        // flechita visible o no — así el contenido no se corre al pasar el
        // mouse, y sobre todo la hora nunca queda debajo de un botón.
        'group relative flex w-full items-start gap-3 border-b border-border py-3 pl-4 pr-9 text-left transition-colors last:border-b-0 ' +
        (seleccionada
          ? 'bg-secondary shadow-[inset_-3px_0_0_var(--color-primary)] active:bg-muted'
          : c.respondida
            ? 'bg-success/5'
            : 'hover:bg-muted/50') +
        (esNueva ? ' animate-in fade-in slide-in-from-top-1 duration-300 ease-house' : '')
      }
    >
      {/* Banda de temperatura: 3px a la izquierda, codifica urgencia sin palabras. */}
      <span className={'absolute inset-y-0 left-0 w-[3px] ' + temp.bar} aria-hidden="true" />

      {/* Avatar con la insignia del canal superpuesta abajo-derecha. */}
      <span className="relative mt-0.5 shrink-0">
        <Avatar
          nombre={c.persona_nombre}
          telefono={c.canal === 'whatsapp' ? c.persona_id : null}
          numeroPropio={c.numero_propio}
          conFoto={conFoto}
          className="size-9 rounded-full bg-secondary text-xs font-bold text-navy"
        />
        <span className="absolute -bottom-0.5 -right-0.5">
          <BadgeCanal canal={c.canal} />
        </span>
      </span>

      <div className="min-w-0 flex-1">
        {/* Renglón 1: quién, y a la derecha la urgencia en dos líneas. */}
        <div className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {/* Pin: por qué esta fila está en la banda de arriba. Navy, no oro. */}
            {c.fijada && <Pin size={12} fill="currentColor" className="shrink-0 text-navy" aria-label="Fijada" />}
            {/* Sin leer: punto azul. Distinto del check de respondida y del conteo. */}
            {c.no_leido && (
              <span className="size-2 shrink-0 rounded-full bg-primary" role="img" aria-label="Sin leer" title="Sin leer" />
            )}
            {/* `title`: el renglón 1 acumula marcas (cliente, dueño, etapa) y en el
                peor caso —los tres a la vez, ~4 % de las filas— el nombre trunca
                fuerte. «Un nombre cortado sigue reconociéndose» vale hasta cierto
                punto: con el hover, siempre. */}
            <span title={nombre} className={`truncate text-sm ${pesoNombre} ${tintaNombre}`}>
              {nombre}
            </span>
            {marca && (
              <span
                title={marca.titulo}
                className={
                  'shrink-0 rounded-full border px-1.5 py-px text-[11px] font-semibold ' +
                  (marca.nivel === 'compro' ? '' : 'tabular-nums ') +
                  CLASE_MARCA[marca.nivel]
                }
              >
                {marca.texto}
              </span>
            )}
            {/* DE QUIÉN ES: pegado a la identidad, porque «¿es mía?» se responde
                junto con «¿quién es?» y antes que «¿qué pasa con esta?». Lo que
                cede ancho es el nombre, que ya truncaba — el mismo precio que
                acordó pagar la marca de ex-cliente, y por el mismo motivo. */}
            {dueno && (
              <span
                title={dueno.titulo}
                className={
                  // `max-w` + `truncate`: `nombreCorto` corta en el separador del
                  // username, pero un nombre de pila largo («Maximiliano») entra
                  // entero igual y le comería el renglón al nombre del lead.
                  'flex max-w-[5.5rem] shrink-0 items-center gap-0.5 truncate rounded-full border ' +
                  'bg-card px-1.5 py-px text-[11px] font-semibold ' +
                  CLASE_DUENO[dueno.tono]
                }
              >
                <UserRound size={10} className="shrink-0" aria-hidden="true" />
                {dueno.texto}
              </span>
            )}
            {/* Favorita: estrella navy (el oro es SOLO tiempo que se acaba). */}
            {c.favorita && <Star size={12} fill="currentColor" className="shrink-0 text-navy" aria-label="Favorita" />}
            {/* UNA conversación, así que singular — y por el rótulo canónico:
                esta píldora pintaba el IDENTIFICADOR crudo con un `capitalize`
                de CSS, que con ids de una palabra se veía bien de casualidad. */}
            {etapa && (
              <span className={'shrink-0 rounded px-1 py-px text-[11px] font-semibold ' + chipEtapa}>
                {rotuloEtapa(etapa)}
              </span>
            )}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            {/*
              SE LE PUEDE ESCRIBIR — la ventana de conversación (`ventana.ts`).
              Cubre los dos plazos con una sola marca: 24 h desde que la persona
              escribió en un chat, 7 días desde que comentó en FB/IG. Antes acá
              solo entraban los comentarios, así que en WhatsApp —que es donde
              Goberna vende— la puerta se cerraba sin que nada lo dijera.

              EL ORO SOLO CUANDO QUEDA POCO. Antes toda ventana abierta salía
              dorada, y una de 6 días no es tiempo que se acabe: el oro terminaba
              significando «comentario» en vez de «ahora». Arriba del umbral va
              en tinta neutra sobre fondo tenue, como las demás señales
              automáticas de la casa (ADR 0016).
            */}
            {ventana ? (
              <span
                title={ventana.ayuda}
                className={
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold ' +
                  (ventana.urgente ? 'bg-gold/20 text-gold-ink' : 'bg-muted text-muted-foreground')
                }
              >
                <Clock size={10} />
                {ventana.texto}
              </span>
            ) : (
              /* RESPALDO para un server que todavía no manda `ventana_cierra`:
                 N4 (front) va solo y N5 (server) es un botón, así que existe una
                 ventana de deploy con el front nuevo y el server viejo. Sin esto,
                 en esa franja los comentarios perderían su cuenta regresiva —
                 una regresión silenciosa que nadie ata al deploy. */
              c.ventana_abierta && (
                <span className="inline-flex items-center gap-1 rounded-md bg-gold/20 px-1.5 py-0.5 text-xs font-bold text-gold-ink">
                  <Clock size={10} />
                  {restan <= 1 ? 'último día' : `quedan ${restan} días`}
                </span>
              )
            )}
            <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
              {c.respondida && <Check size={11} className="shrink-0 text-success" aria-label="respondida" />}
              {hace(horas)}
            </span>
          </span>
        </div>

        {/* Renglón 2: qué dijo, con la marca de lead y las categorías. */}
        <div className="mt-0.5 flex items-center gap-1.5">
          {bot ? (
            <span
              title={bot.titulo}
              className={
                'flex max-w-[55%] shrink-0 items-center gap-1 truncate rounded px-1.5 py-px text-[11px] font-semibold ' +
                CLASE_BOT[bot.tono]
              }
            >
              <Bot size={11} className="shrink-0" aria-hidden="true" />
              {bot.texto}
            </span>
          ) : curso ? (
            /* El QUÉ: fondo suave del color de su familia (nunca borde + sombra,
               nunca oro — el oro es tiempo que se acaba, y un curso no es un
               reloj). El `title` dice de dónde salió el dato: el chip no miente. */
            <span
              title={detalleDeCurso(curso)}
              className={
                'max-w-[45%] shrink-0 truncate rounded px-1.5 py-px text-[11px] font-semibold ' +
                CLASE_FONDO_SUAVE[curso.color] +
                ' ' +
                CLASE_TEXTO[curso.color]
              }
            >
              {curso.nombre}
            </span>
          ) : (
            mostrarPregunto &&
            c.pregunto && (
              <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[11px] font-semibold text-primary">
                {c.pregunto_precio ? 'Preguntó precio' : 'Preguntó'}
              </span>
            )
          )}
          {/* Categorías: píldora con BORDE de color (sin sombra, sin oro). */}
          {categorias.slice(0, 1).map((nombre) => {
            const color = resolverColor(nombre, catalogo);
            return (
              <span
                key={nombre}
                title={nombre}
                className={
                  'shrink-0 rounded-full border bg-card px-1.5 py-px text-[11px] font-semibold capitalize ' +
                  (color ? CLASE_BORDE[color] + ' ' + CLASE_TEXTO[color] : 'border-border text-muted-foreground')
                }
              >
                {nombre}
              </span>
            );
          })}
          {categorias.length > 1 && (
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">+{categorias.length - 1}</span>
          )}
          <p className={'min-w-0 flex-1 truncate text-sm ' + clasePreview}>
            {textoDePreview({
              texto: c.texto,
              clase: c.ultima_clase,
              origen: c.ultima_origen,
              soloClic: c.solo_clic,
            })}
          </p>
          {/* Conteo de mensajes: neutro y rotulado. El AZUL queda para «sin leer». */}
          {c.n > 1 && !c.respondida && (
            <span
              title={`${c.n} mensajes en la conversación`}
              className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] font-bold tabular-nums text-muted-foreground"
            >
              {c.n}
            </span>
          )}
        </div>

        {c.contexto_texto && c.tipo === 'comentario' && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">en “{c.contexto_texto}”</p>
        )}
      </div>
    </button>
  );
}
