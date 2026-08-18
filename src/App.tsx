import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlarmClock,
  BrainCircuit,
  Columns3,
  Compass,
  LayoutDashboard,
  Mail,
  MessagesSquare,
  Notebook,
  Route,
  Users,
  Bot,
} from 'lucide-react';
import { Escudo } from './components/Marca';
import { ColaUnificada } from './features/canales/ColaUnificada';
import { ConversacionActiva } from './features/canales/ConversacionActiva';
import type { Conversacion } from './dominio/conversaciones';
import { conversacionDeTelefono } from './dominio/conversacionNueva';
import BarraFrescura from './features/canales/BarraFrescura';
import { EstadoWhatsapp } from './features/whatsapp/EstadoWhatsapp';
import { InterruptorAutoRespuesta } from './features/autorespuesta/InterruptorAutoRespuesta';
import { ColaRevision } from './features/autorespuesta/ColaRevision';
import { PorQueEstaSugerencia } from './features/autorespuesta/PorQueEstaSugerencia';
import { useModoRevision } from './features/autorespuesta/useModoRevision';
import { useAutoRespuesta } from './features/autorespuesta/datos';
import { conversacionDeSugerencia, paso as pasoDeRevision } from './features/autorespuesta/revision';
import { PanelDerecho } from './features/panel/PanelDerecho';
import { VistaDashboard } from './features/dashboard/VistaDashboard';
import { VistaEmbudo } from './features/vistas/VistaEmbudo';
import { VistaPersonas } from './features/vistas/VistaPersonas';
import { VistaAgenda } from './features/agenda/VistaAgenda';
import { VistaCorreos } from './features/correos/VistaCorreos';
import { VistaEntrenamiento } from './features/entrenamiento/VistaEntrenamiento';
import { VistaNavegador } from './features/navegador/VistaNavegador';
import { VistaRouting } from './features/routing/VistaRouting';
import { veRouting } from './features/vistas/acceso';
import { pendientesQueApuran, useAgenda } from './features/agenda/agenda';
import { Login } from './features/auth/Login';
import { useSesion } from './features/auth/sesion';
import { AvisoCerberus } from './features/auth/AvisoCerberus';
import { PanelUsuario } from './features/auth/PanelUsuario';
import { useSesionWa } from './features/whatsapp/conversacionWa';
import { useDashboard } from './features/dashboard/dashboard';
import { useTiempoReal } from './lib/datos/tiempoReal';
import { SELECTOR_CAMPOS } from './lib/teclado/escapeDePopover';
import type { DestinoCorreo, Puente } from './lib/puente';
import { esAtajoLibreta } from './features/notas/notas';
import { ConsultaIvi } from './features/ivi/ConsultaIvi';

/**
 * La Libreta se carga PEREZOSA y solo se monta cuando su vista está a la vista.
 * BlockNote pesa **269 KB gzip medidos** (el bundle principal pasa de 222 a 491
 * KB si entra estático). Que ahora sea una vista del riel no cambia el cálculo:
 * seguiría siendo un cuarto del bundle cobrado en el arranque a todas, incluso
 * las que ese día no entran a escribir nada.
 *
 * Y como toda vista que no es la Bandeja, se DESMONTA al salir: por eso la
 * Libreta adelanta su autoguardado pendiente en el desmontaje (ver su archivo).
 */
const Libreta = lazy(() => import('./features/notas/Libreta').then((m) => ({ default: m.Libreta })));

/**
 * HERMES — la mesa de la vendedora.
 *
 * UN espacio con vistas (ADR 0002), conmutadas por estado — sin router. La
 * navegación es un RIEL vertical a la izquierda: el escudo arriba, las vistas
 * al medio (ícono + nombre: nadie navega adivinando), la vendedora abajo.
 * El Dashboard es la página principal. Se trabaja en la Bandeja — que queda
 * SIEMPRE montada (oculta, no desmontada): el borrador del composer y el hilo
 * abierto sobreviven a cualquier paseo por las demás vistas.
 *
 * Teclado global (§2.8 del spec): ⌘1..⌘N cambia de vista (el rango sale de
 * `VISTAS`, no de un número escrito a mano) · «/» va a la búsqueda de la cola ·
 * Escape cierra la conversación (solo en Mensajes, nunca desde un input) · «?»
 * abre la cabina con el mapa completo · «n» va a la libreta personal (#47).
 */

/** `WebkitAppRegion` no está en los tipos de CSSProperties; el webview sí lo lee. */
const ARRASTRABLE = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_ARRASTRABLE = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const VISTAS = [
  { id: 'dashboard', label: 'Dashboard', icono: LayoutDashboard },
  { id: 'embudo', label: 'Pipeline', icono: Columns3 },
  { id: 'personas', label: 'Contactos', icono: Users },
  { id: 'bandeja', label: 'Mensajes', icono: MessagesSquare },
  { id: 'correos', label: 'Correos', icono: Mail },
  { id: 'agenda', label: 'Agenda', icono: AlarmClock },
  // La séptima: donde se mira trabajar al bot sin gastar un lead de la pauta.
  // No es trabajo diario de la vendedora, pero vive en el riel igual — fuera de
  // la app quedaría huérfana, y lo que no está a la vista no se usa.
  { id: 'entrenamiento', label: 'Entrenar bot', icono: Bot },
  // La octava (ADR 0034). Entra por el MISMO criterio que dejó afuera a la
  // Cabina y a Ivi —«el riel es para LUGARES»—, no por una excepción: a Ivi se
  // lo consulta, a la libreta se entra. Vivió 12 días detrás de la tecla «n»
  // sin ícono en ningún lado, y `notas` terminó con cero filas.
  { id: 'libreta', label: 'Libreta', icono: Notebook },
  // La novena (ADR 0040). Entra por el mismo criterio de ADR 0034 —el riel es
  // para LUGARES— y no por ser útil: se sale a la web con la sesión de trabajo
  // y se vuelve, como a la Libreta se entra a escribir. La acción primaria se
  // puede nombrar en dos palabras: «abrir un sitio».
  { id: 'navegador', label: 'Navegador', icono: Compass },
  // La décima, y la PRIMERA que no la ve todo el mundo: `soloPara` decide quién
  // la tiene en el riel (`features/vistas/acceso.ts`). Está vacía a propósito —
  // el lugar se reservó antes que el contenido.
  //
  // ⚠️ Lo que `soloPara` hace es ESCONDER, no proteger. Mientras la vista no
  // pida nada al server no hay diferencia; el día que pida, el recorte va en el
  // `WHERE` de su ruta (ADR 0035/0036) y esto sigue siendo solo el riel.
  { id: 'routing', label: 'Routing', icono: Route, soloPara: veRouting },
] as const;

type Vista = (typeof VISTAS)[number]['id'];

/**
 * CUÁNTAS VISTAS ALCANZA EL TECLADO. No es un tope de diseño: es cuántas teclas
 * de dígito hay para un acorde (⌘0 es del navegador, no nuestro). De la décima
 * en adelante se entra por el riel, y el `title` del botón **no promete** una
 * tecla que no existe.
 *
 * 🔴 Y hay una trampa que ya casi muerde: el rango se comparaba como CADENA
 * (`e.key >= '1' && e.key <= String(VISTAS.length)`). Con nueve vistas eso
 * andaba de casualidad; con diez, `String(10)` es `'10'` y `'2' <= '10'` da
 * **false** — se rompían ⌘2..⌘9 y quedaba andando solo ⌘1. Ahora se compara el
 * NÚMERO, y el tope sigue derivándose (del mínimo entre lo que esta persona ve
 * y las teclas que existen), nunca de un número escrito a mano.
 */
const TECLAS_DE_VISTA = 9;

/** Las vistas que ESTA persona tiene en el riel. Sin `soloPara`, la ve todo el mundo. */
function vistasDe(vendedoraId: string | null | undefined) {
  return VISTAS.filter((v) => ('soloPara' in v ? v.soloPara(vendedoraId) : true));
}

/**
 * ¿El teclado está "ocupado" escribiendo? Ningún atajo global pisa un input.
 * El selector es el mismo que usan los popovers (`src/lib/teclado/`): dos listas
 * distintas significaban que la misma tecla se juzgaba distinto según quién la oyera.
 */
function tecleandoEn(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLElement && Boolean(t.closest(SELECTOR_CAMPOS));
}

/**
 * LA CABINA LEE LAS VISTAS DE ESTA PERSONA, no `VISTAS`. Con la lista completa
 * prometería una tecla que no lleva a ningún lado —y peor: la numeración se
 * correría, así que ⌘4 diría una vista y abriría otra— apenas alguna vista deje
 * de ser para todas. Una sola lista, un solo número (#37).
 */
function atajosDe(vistas: readonly { label: string }[]): { tecla: string; que: string }[] {
  return [
    ...vistas.slice(0, TECLAS_DE_VISTA).map((v, i) => ({ tecla: `⌘${i + 1}`, que: v.label })),
    { tecla: '/', que: 'Buscar en la cola' },
    { tecla: '↑↓ ⏎', que: 'Recorrer la cola' },
    { tecla: 'Esc', que: 'Cerrar la conversación' },
    { tecla: 'n', que: 'Tu libreta personal' },
    { tecla: 'i', que: 'Preguntarle a Ivi' },
    { tecla: 'a', que: 'Revisar las auto-respuestas' },
    { tecla: '?', que: 'Esta ayuda' },
  ];
}

/**
 * LAS TECLAS DE LA REVISIÓN, aparte porque solo existen adentro del modo — y
 * porque son todas ACORDES, que es lo que las hace seguras.
 *
 * En revisión el foco está en el composer (ahí se edita el borrador), así que
 * las teclas sueltas tipo `j`/`k` de Superhuman o Intercom no se pueden usar:
 * escribirían. Los acordes con ⌘/Ctrl no escriben texto y pasan igual. De yapa,
 * ninguna de las dos decisiones —aprobar, descartar— se dispara con un dedo que
 * resbala.
 *
 * `⌘↵` es el «enviar» de toda la industria (Intercom, Missive, Gmail) y `⌘D` el
 * «descartar borrador» de Missive: se eligieron por convención, no por gusto.
 */
const ATAJOS_REVISION: { tecla: string; que: string }[] = [
  { tecla: '⌘↵', que: 'Aprobar y seguir' },
  { tecla: '⌘D', que: 'Descartar y seguir' },
  { tecla: '⌘↓ ⌘↑', que: 'Saltar sin decidir' },
  { tecla: 'Esc', que: 'Salir de la revisión' },
];

/** La cabina: el mapa de teclas, en voz de imprenta. Se abre con «?». */
function Cabina({
  onCerrar,
  enRevision,
  atajos,
}: {
  onCerrar: () => void;
  enRevision: boolean;
  /** Los de ESTA persona: el riel y la cabina cuentan las vistas igual. */
  atajos: { tecla: string; que: string }[];
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20" onClick={onCerrar} role="dialog" aria-modal="true" aria-label="Atajos de teclado">
      <div className="w-72 rounded-2xl bg-card p-5 shadow-panel animate-entrar" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-heading text-sm font-bold text-navy">La cabina</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Todo Hermes sin soltar el teclado.</p>
        {/* Las de la revisión van PRIMERO y solo cuando se está adentro: es el
            único momento en que alguien abre esto para buscar una tecla. */}
        {enRevision && (
          <>
            <p className="mt-3 font-mono text-[10px] font-bold uppercase tracking-wide text-navy">En la revisión</p>
            <dl className="mt-1.5 space-y-1.5">
              {ATAJOS_REVISION.map((a) => (
                <div key={a.tecla + a.que} className="flex items-center justify-between gap-3">
                  <dt className="rounded-md bg-navy px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{a.tecla}</dt>
                  <dd className="text-xs text-foreground">{a.que}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Siempre</p>
          </>
        )}
        <dl className="mt-3 space-y-1.5">
          {atajos.map((a) => (
            <div key={a.tecla + a.que} className="flex items-center justify-between gap-3">
              <dt className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">{a.tecla}</dt>
              <dd className="text-xs text-muted-foreground">{a.que}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export default function App() {
  const { vendedora, cargando, sinServer, reintentar, entrar, salir, cerberusVivo, errorCenturion } = useSesion();
  const [abierta, setAbierta] = useState<Conversacion | null>(null);
  const [vista, setVista] = useState<Vista>('dashboard');
  const [direccion, setDireccion] = useState<'abajo' | 'arriba'>('abajo');
  const [telefonoPersonas, setTelefonoPersonas] = useState<string | null>(null);
  const [cabina, setCabina] = useState(false);
  // La consulta a Ivi (H3). Capa aparte, global: se pregunta desde donde sea que estés y
  // el panel derecho —que es de la persona abierta, no del negocio— no se toca.
  const [ivi, setIvi] = useState(false);
  // EL MODO REVISIÓN (ADR 0018). No es una hoja encima de la app: es la vista
  // Mensajes con la cola filtrada a lo que hay que decidir, la conversación
  // real en el medio y el porqué a la derecha. Todo su estado vive en el hook,
  // que también sabe «a cuál voy» cuando la abierta se resuelve.
  const revision = useModoRevision();
  const { limites: limitesAuto } = useAutoRespuesta();
  // El puente (§2.9): una vista le pasa el mando a otra; la destinataria lo consume y lo limpia.
  const [puente, setPuente] = useState<Puente | null>(null);
  const busquedaRef = useRef<HTMLInputElement>(null);
  const { data: sesionWa } = useSesionWa();
  const { data: dash } = useDashboard();

  // Objeto estable: la Agenda re-dispararía su efecto si la identidad cambiara por render.
  const crearInicialAgenda = useMemo(
    () => (puente?.tipo === 'agenda' ? { telefono: puente.telefono ?? undefined, nota: puente.nota } : null),
    [puente],
  );

  // Entrar a una sugerencia ABRE su conversación: revisar es mirar un chat, no
  // leer un texto suelto. Es la costura entre el modo y la mesa de siempre.
  const claveDeRevision = revision.actual?.clave ?? null;
  useEffect(() => {
    if (!revision.activo || !revision.actual) return;
    setAbierta(conversacionDeSugerencia(revision.actual));
    setVista('bandeja');
    // Solo al cambiar de sugerencia: reabrir en cada render pisaría la
    // conversación que la vendedora haya elegido a mano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveDeRevision, revision.activo]);

  // El nervio en vivo: escucha el stream del server e invalida lo que cambió.
  // Solo con sesión (el stream está detrás del perímetro, #36); si el stream
  // recibe un 401, corta y dispara la re-validación — que echa si el token
  // murió de verdad, en vez de martillar cada 3 segundos.
  useTiempoReal(Boolean(vendedora), reintentar);

  // El badge de la Agenda: cuántas promesas apuran (vencidas + de hoy).
  // Dorado, porque es TIEMPO — la única acepción del oro en Hermes.
  const { agenda } = useAgenda();
  const apuran = pendientesQueApuran(agenda.data?.recordatorios);

  // El riel de ESTA persona. El riel, los ⌘N y la cabina leen esta lista y no
  // `VISTAS`: con dos listas, la tecla que anda y el rótulo que la anuncia se
  // separan sin que nada lo diga (#37).
  const vistas = vistasDe(vendedora?.id);

  // La transición direccional: bajar en el riel entra desde abajo, subir desde arriba.
  function cambiarVista(destino: Vista) {
    const desde = vistas.findIndex((v) => v.id === vista);
    const hasta = vistas.findIndex((v) => v.id === destino);
    if (hasta !== desde) setDireccion(hasta > desde ? 'abajo' : 'arriba');
    setVista(destino);
  }

  // ── El teclado global (§2.8): la guarda va antes que todo. ──
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Escape cierra en orden: cabina → revisión → conversación abierta
        // (solo en Mensajes). La revisión sale ANTES que la conversación:
        // adentro del modo, Escape significa «salime de acá».
        //
        // LA LIBRETA YA NO ESTÁ EN ESTA LISTA (ADR 0034) y no es un olvido: es
        // una VISTA, y de una vista no se sale con Escape —de Dashboard tampoco—
        // se va a otra. Lo único que hay que cuidar al leer esto es que lo de
        // abajo siga andando: la cascada se acortó por arriba, no por el medio.
        //
        // Y sale AUN CON EL FOCO EN EL COMPOSER, que es la única excepción a la
        // guarda de «no pises un input». Sin esto Escape no funcionaba nunca en
        // revisión: ahí el foco vive siempre en el borrador, así que la guarda
        // se comía la tecla y la única salida era el botón. Se acota al
        // `textarea` a propósito —los popovers de la barra usan `input` y
        // siguen manejando su propio Escape— y la cabina se atiende antes, así
        // que nunca se le roba el Escape a algo abierto encima.
        const enElBorrador =
          revision.activo && e.target instanceof HTMLElement && e.target.tagName === 'TEXTAREA';
        if (tecleandoEn(e) && !enElBorrador) return;
        if (cabina) {
          setCabina(false);
          return;
        }
        if (revision.activo) {
          revision.salir();
          return;
        }
        if (vista === 'bandeja') setAbierta(null);
        return;
      }
      // Los acordes con ⌘/Ctrl no escriben texto: pasan aun con el foco en un input.
      // El rango se DERIVA —de las vistas de esta persona, no de un '6' escrito
      // a mano: al agregar la séptima el atajo se quedó corto sin que nada lo
      // dijera, y el próximo que agregue una vista no tiene por qué acordarse
      // de este `if`.
      //
      // 🔴 Y se compara el NÚMERO, no la cadena. Con `e.key <= String(n)` y diez
      // vistas, `'2' <= '10'` es false: andaba ⌘1 y se rompían las ocho del
      // medio — o sea que el candado de la ÚLTIMA vista no lo habría visto.
      if (e.metaKey || e.ctrlKey) {
        const n = Number(e.key);
        const destino = n >= 1 && n <= Math.min(vistas.length, TECLAS_DE_VISTA) ? vistas[n - 1] : undefined;
        if (destino) {
          e.preventDefault();
          cambiarVista(destino.id);
          return;
        }
      }
      // ── LAS TECLAS DE LA REVISIÓN ──
      // Van acá arriba, ANTES de la guarda de «estás tecleando», porque en
      // revisión el foco vive en el composer: si esperaran a que el foco salga
      // del textarea, no funcionarían nunca. Son acordes justamente por eso.
      // `⌘↵` (aprobar) lo maneja el composer, que es el que tiene el texto
      // editado — acá solo van las que no lo necesitan.
      if (revision.activo && (e.metaKey || e.ctrlKey)) {
        if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          if (revision.actualId !== null) revision.descartarIds([revision.actualId]);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          revision.saltar(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          revision.saltar(-1);
          return;
        }
      }
      if (tecleandoEn(e)) return;
      if (e.key === '?') {
        e.preventDefault();
        setCabina((v) => !v);
        return;
      }
      // Preguntarle a Ivi: «i» sola. La hoja se cierra sola con Escape (contrato de la
      // casa, `useEscape` en captura), así que acá alcanza con abrir y alternar.
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setIvi((v) => !v);
        return;
      }
      // La libreta personal (#47): «n» sola, nunca ⌘N/Ctrl+N (eso es del navegador).
      // NAVEGA, no alterna: desde que es una vista (ADR 0034), «n» es el atajo de
      // ⌘8 y nada más. Alternar la dejaría contestando dos cosas distintas según
      // dónde estés parada, y peor: la tecla de ir a la libreta te sacaría de la
      // libreta. Volver es ⌘1..⌘8 o el riel, como con cualquier otra vista.
      if (esAtajoLibreta(e)) {
        e.preventDefault();
        cambiarVista('libreta');
        return;
      }
      // La revisión de las auto-respuestas: «a» sola. Es lo que se hace a las 9
      // de la mañana, desde donde sea que estés parada.
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        if (revision.activo) revision.salir();
        else revision.entrar();
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        cambiarVista('bandeja');
        // Doble RAF: la Bandeja está siempre montada pero oculta — hay que
        // esperar a que sea visible para que el foco agarre.
        requestAnimationFrame(() => requestAnimationFrame(() => busquedaRef.current?.focus()));
      }
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
    // `vendedora?.id` está acá porque de él sale `vistas`: sin eso, el listener
    // se quedaría con el riel de quien estaba antes y ⌘N abriría otra cosa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, cabina, abierta, revision.activo, revision.actualId, revision.fila, vendedora?.id]);

  if (cargando) {
    // El esqueleto con la anatomía del shell: riel, header, tres placas.
    return (
      <div className="flex h-dvh bg-background">
        <div className="w-[4.75rem] shrink-0 border-r border-border bg-card" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="h-14 shrink-0 border-b border-border bg-card" />
          <div className="flex-1 space-y-3 p-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-card" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!vendedora) {
    return <Login entrar={entrar} sinServer={sinServer} reintentar={reintentar} errorCenturion={errorCenturion} />;
  }

  // Abrir una conversación desde cualquier vista te trae a la Bandeja: es la
  // única vista donde se conversa. Las demás miran, esta trabaja.
  function abrirConversacion(c: Conversacion) {
    setAbierta(c);
    cambiarVista('bandeja');
  }

  function buscarPersona(telefono: string) {
    setTelefonoPersonas(telefono);
    cambiarVista('personas');
  }

  // «Escribirle» desde una ficha: el chat nuevo, con el número propio de la
  // sesión WA (la misma fábrica que el + de la cola). Solo existe con WA conectado.
  //
  // La `Conversacion` se arma en `conversacionDeTelefono` y no acá: desde que el
  // padrón abre la ficha al costado hay un SEGUNDO llamador, y dos copias de la
  // clave `conv:…` son dos claves distintas el día que una cambie.
  const escribirA =
    sesionWa?.estado === 'conectado'
      ? (telefono: string) =>
          abrirConversacion(
            conversacionDeTelefono({ telefono, numeroPropio: sesionWa.telefono }),
          )
      : undefined;

  /**
   * IR A CORREOS CON EL DESTINATARIO PUESTO — y con la conversación de la que
   * salió, que es la mitad que faltaba.
   *
   * 🔴 **Acepta las DOS formas a propósito.** El único llamador que existía
   * hasta hoy es el radar del Dashboard, que solo tiene el correo del
   * formulario (`fila.form.correo`) y ninguna conversación: pasa un string
   * suelto. Los llamadores nuevos —la ficha, en Mensajes, en el Pipeline y en
   * el padrón— sí saben de qué conversación vienen y pasan el objeto. Exigir el
   * objeto obligaría a tocar el Dashboard para no ganar nada; aceptar las dos
   * deja que cada pantalla mande lo que de verdad sabe.
   *
   * ⚠️ Sin `clave` el correo sale igual y queda huérfano (ver `lib/puente.ts`):
   * eso es correcto cuando NO hay conversación, y es un defecto cuando la hay
   * y no se pasó.
   */
  function mandarCorreoA(destino: string | DestinoCorreo) {
    const d = typeof destino === 'string' ? { para: destino } : destino;
    setPuente({ tipo: 'correo', para: d.para, clave: d.clave, nombre: d.nombre });
    cambiarVista('correos');
  }

  function agendarBienvenida(telefono: string | null) {
    setPuente({ tipo: 'agenda', telefono, nota: 'Bienvenida al curso' });
    cambiarVista('agenda');
  }

  const vistaActiva = VISTAS.find((v) => v.id === vista)!;
  const claseEntrada =
    'flex min-h-0 flex-1 flex-col duration-300 ease-house animate-in fade-in ' +
    (direccion === 'abajo' ? 'slide-in-from-bottom-1' : 'slide-in-from-top-1');

  return (
    <div className="flex h-dvh bg-background text-foreground">
      {/* ── EL RIEL: ícono + nombre. Nadie navega adivinando. ── */}
      <nav
        aria-label="Vistas"
        className="flex w-[4.75rem] shrink-0 flex-col items-center border-r border-border bg-card pb-3 pt-9"
        style={ARRASTRABLE}
        data-tauri-drag-region
      >
        <div className="mb-3" title="Hermes · Goberna">
          <Escudo size={26} />
        </div>

        <div className="flex flex-col gap-1" style={NO_ARRASTRABLE}>
          {vistas.map((v, i) => {
            const Icono = v.icono;
            const activa = vista === v.id;
            return (
              <button
                key={v.id}
                type="button"
                data-vista={v.id}
                // De la décima en adelante no hay tecla, así que el tooltip no
                // la nombra: prometer un ⌘10 que no existe es peor que no decir
                // nada — se prueba una vez, no anda, y no se vuelve a confiar.
                title={i < TECLAS_DE_VISTA ? `${v.label} · ⌘${i + 1}` : v.label}
                onClick={() => cambiarVista(v.id)}
                className={
                  'relative flex w-[4.25rem] flex-col items-center gap-0.5 rounded-xl py-1.5 transition-[color,background-color,box-shadow,transform] duration-200 ease-house active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
                  (activa
                    ? 'bg-navy text-white shadow-[0_4px_14px_-4px_rgba(14,42,82,0.55)]'
                    : 'text-muted-foreground hover:bg-secondary hover:text-navy')
                }
              >
                <Icono size={17} strokeWidth={activa ? 2.2 : 1.8} />
                <span className="max-w-full truncate px-0.5 text-[11px] font-medium leading-none">{v.label}</span>
                {v.id === 'agenda' && apuran > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold px-1 font-mono text-[11px] font-bold leading-none text-navy ring-2 ring-card">
                    {apuran}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* QUIÉN SOY. Era un `<span>` con un `title`: la única forma de saber
            con qué usuario estabas era esperar el tooltip del sistema. Con cinco
            vendedoras compartiendo una línea, «¿entré con el usuario que era?» y
            «¿por qué no veo mis leads?» son la misma pregunta, y no había dónde
            contestarla. El botón de salir se mudó adentro del panel: vivía suelto
            debajo del avatar, que es donde uno lo aprieta sin querer. */}
        <div className="mt-auto flex flex-col items-center gap-2" style={NO_ARRASTRABLE}>
          <PanelUsuario vendedora={vendedora} cerberusVivo={cerberusVivo} onSalir={salir} />
        </div>
      </nav>

      {/* ── EL CONTENIDO: barra fina arriba (título + línea de salud) y la vista ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 pb-2 pt-8"
          style={ARRASTRABLE}
          data-tauri-drag-region
        >
          <h1 className="font-heading text-sm font-bold tracking-tight text-navy">{vistaActiva.label}</h1>
          <div className="ml-auto flex items-center gap-2" style={NO_ARRASTRABLE}>
            {/* Preguntarle a Ivi. Va en la barra y no en el riel porque no es una vista: no
                se «va» a Ivi, se lo consulta sin soltar lo que estabas haciendo. Y va con
                rótulo porque una tecla que nadie descubre no existe. */}
            <button
              type="button"
              onClick={() => setIvi(true)}
              title="Preguntarle a Ivi · i"
              className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-[color,border-color,transform] duration-200 ease-house hover:border-primary/40 hover:text-navy active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <BrainCircuit size={13} strokeWidth={2} />
              Ivi
            </button>
            {/* Primero lo que le impide COBRAR: es lo único de esta barra que
                bloquea plata, así que va antes que la salud de los datos. */}
            {cerberusVivo === false && <AvisoCerberus usuario={vendedora.id} entrar={entrar} />}
            <BarraFrescura />
            {/* El interruptor va PEGADO al semáforo de WhatsApp: los dos hablan
                del estado del canal. Que la máquina esté contestando sola es
                parte de la misma pregunta que «¿el número está vivo?» (#125). */}
            <InterruptorAutoRespuesta onRevisar={revision.entrar} />
            <EstadoWhatsapp />
          </div>
        </header>

        {/* La Bandeja vive SIEMPRE montada: ocultarla no es desmontarla.

            EN MODO REVISIÓN (ADR 0018) es la MISMA mesa: cambia solo quién
            ocupa la columna izquierda —la fila de sugerencias en vez de la cola
            entera— y aparece un bloque de contexto arriba de la ficha. El
            centro no se toca: la conversación real es el punto. Por eso la
            revisión no es un modal: un modal tapa justamente lo que hay que
            mirar para poder decidir. */}
        <div className={vista === 'bandeja' ? 'flex min-h-0 flex-1 gap-3 p-3' : 'hidden'}>
          {/* La lista de revisión pide MENOS ancho que la cola: no tiene
              búsqueda, ni tabs, ni chips de categoría — solo quién y cuánto
              hace que espera. Devolverle esos 80 px al chat importa a 1280,
              donde el panel derecho ya se lleva 22,5rem. */}
          <main className={'min-h-0 shrink-0 ' + (revision.activo ? 'w-[20rem]' : 'w-[25rem]')}>
            {revision.activo ? (
              <ColaRevision
                grupos={revision.grupos}
                fila={revision.fila}
                actualId={revision.actualId}
                cargando={revision.cargando}
                error={revision.error}
                trabajando={revision.trabajando}
                recibo={revision.recibo}
                onElegir={revision.abrir}
                onDescartarTodo={revision.descartarTodo}
                onCerrarRecibo={revision.cerrarRecibo}
                onSalir={revision.salir}
              />
            ) : (
              <ColaUnificada
                seleccionada={abierta?.clave ?? null}
                onSeleccionar={setAbierta}
                conversacionAbierta={abierta}
                etapas={dash?.etapas}
                miVendedora={vendedora.id}
                onIrAgenda={() => cambiarVista('agenda')}
                inputRef={busquedaRef}
              />
            )}
          </main>
          <section className="min-h-0 min-w-0 flex-1">
            <ConversacionActiva
              conversacion={abierta}
              onCerrar={() => setAbierta(null)}
              miVendedora={vendedora.id}
              sugerencia={
                revision.activo && revision.actual && revision.actual.clave === abierta?.clave
                  ? {
                      id: revision.actual.id,
                      texto: revision.actual.texto,
                      campana: revision.actual.campana,
                      paso: pasoDeRevision(revision.fila, revision.actualId),
                      trabajando: revision.trabajando,
                      onAprobar: (texto) => revision.aprobarIds([revision.actual!.id], texto),
                      onDescartar: () => revision.descartarIds([revision.actual!.id]),
                    }
                  : undefined
              }
            />
          </section>
          {abierta && (
            // 22.5rem = 360 px: el ancho para el que está diseñado el panel
            // multifunción (antes 18rem, que solo daba para la ficha).
            <aside className="flex min-h-0 w-[22.5rem] shrink-0 flex-col gap-3">
              {/* EL PORQUÉ DE LA SUGERENCIA, arriba del panel y no en vez de él:
                  «por qué se sugiere esto» y «quién es esta persona» son dos
                  preguntas y se contestan las dos. Bloque aparte a propósito —
                  el panel multifunción (ADR 0017) es de otro frente y este
                  cambio no toca ninguno de sus archivos. Cuando convenga, esto
                  se vuelve una pestaña suya: el contenido ya está aislado y no
                  depende de dónde se monte.

                  Solo aparece en revisión, así que fuera del modo el panel
                  ocupa la columna entera como siempre. */}
              {revision.activo && revision.actual && revision.actual.clave === abierta.clave && (
                <PorQueEstaSugerencia sugerencia={revision.actual} limites={limitesAuto} />
              )}
              {/* El panel se queda con lo que sobra y scrollea adentro, como
                  siempre: el bloque del porqué es `shrink-0` y él `flex-1`. Sin
                  esto, apilarlos dejaba al de abajo aplastado a media frase. */}
              <div className="min-h-0 flex-1">
                {/* `miVendedora` viaja como prop y no llamando a `useSesion()`
                    adentro: ese hook hace su propio `fetch` a `/api/auth/yo`
                    al montar (no es react-query), así que ahí abajo sería un
                    request más por cada conversación que se abre. Lo necesita
                    el timeline para saber cuáles eventos podés editar. */}
                <PanelDerecho
                  conversacion={abierta}
                  miVendedora={vendedora.id}
                  onMandarCorreo={mandarCorreoA}
                />
              </div>
            </aside>
          )}
        </div>

        {vista !== 'bandeja' && (
          <div key={vista} className={claseEntrada}>
            {vista === 'dashboard' && (
              <VistaDashboard
                onAbrir={abrirConversacion}
                onBuscarPersona={buscarPersona}
                onIrAgenda={() => cambiarVista('agenda')}
                miVendedora={vendedora.id}
                onMandarCorreo={mandarCorreoA}
              />
            )}
            {/* El drop en Cierre/Cotizados abre su modal DENTRO del Pipeline (#60);
                acá solo se cablea la salida del recibo (agendar la bienvenida). */}
            {vista === 'embudo' && (
              <VistaEmbudo
                onAbrir={abrirConversacion}
                onAgendarBienvenida={agendarBienvenida}
                // La bandeja de Interesados no se trabaja en el kanban: se responde en Mensajes.
                onIrAMensajes={() => cambiarVista('bandeja')}
                miVendedora={vendedora.id}
                // La hoja del Pipeline es el MISMO `PanelDerecho` que Mensajes:
                // sin este cable, «Escribirle» aparecería en una pantalla y no
                // en la otra sobre la misma ficha.
                onMandarCorreo={mandarCorreoA}
              />
            )}
            {vista === 'agenda' && (
              <VistaAgenda
                onAbrir={abrirConversacion}
                crearInicial={crearInicialAgenda}
                onCrearInicialUsado={() => setPuente(null)}
              />
            )}
            {vista === 'personas' && (
              <VistaPersonas
                telefonoInicial={telefonoPersonas}
                onEscribir={escribirA}
                miVendedora={vendedora.id}
                // Baja hasta la `HojaContacto` del padrón: la tercera pantalla
                // donde vive la misma ficha (ADR 0035).
                onMandarCorreo={mandarCorreoA}
              />
            )}
            {vista === 'entrenamiento' && <VistaEntrenamiento />}
            {/* 🔴 `tapado` NO es cosmética: el navegador es un webview hijo, o
                sea una capa del SISTEMA OPERATIVO encima del DOM (ADR 0043), y
                mientras está a la vista tapa cualquier cosa de Hermes que caiga
                en su rectángulo. La cabina e Ivi son las dos capas que se
                pueden abrir estando en esta vista, así que son las dos que lo
                esconden. **Una capa nueva sobre la mesa se suma acá**; el
                síntoma de olvidarse es inconfundible (aparece detrás del
                navegador), y por eso no hay un registro global que pueda
                desincronizarse en silencio. */}
            {vista === 'navegador' && <VistaNavegador tapado={cabina || ivi} />}
            {/* Vacía a propósito (ver su archivo). Quién la ve se decide en el
                riel, no acá: esto renderiza si el estado dice `routing`, y a ese
                estado solo se llega desde un botón que existe para dos personas. */}
            {vista === 'routing' && <VistaRouting />}
            {/* El fallback dibuja la anatomía de la vista (lista + página) en vez
                de un texto: lo que se está esperando son 269 KB de editor, y un
                cartel de «cargando» donde después va a haber una hoja hace
                parpadear la pantalla dos veces. */}
            {vista === 'libreta' && (
              <Suspense
                fallback={
                  <div className="flex min-h-0 flex-1">
                    <div className="hidden w-[19rem] shrink-0 border-r border-border p-3 md:block">
                      <div className="h-9 animate-pulse rounded-lg bg-muted" />
                    </div>
                    <div className="min-h-0 flex-1 px-6 py-8">
                      <div className="mx-auto h-40 max-w-3xl animate-pulse rounded-lg bg-muted" />
                    </div>
                  </div>
                }
              >
                {/* `vendedoraId` viaja como prop por lo mismo que `miVendedora`
                    en el panel: `useSesion()` hace su propio fetch al montar.
                    Lo necesita el selector de espacios para saber cuáles podés
                    administrar (ADR 0046). */}
                <Libreta vendedoraId={vendedora.id} />
              </Suspense>
            )}

            {/* El puente lleva TRES cosas y no una: el correo prellena el Para,
                la `clave` es lo que ata el correo a su conversación (sin ella
                queda huérfano — ver `lib/puente.ts`) y el nombre es solo para
                saludar. Las tres se leen del MISMO objeto y se limpian juntas
                con `onConsumido`: si el shell limpiara antes de que la vista
                las lea, se perdería la clave y el correo saldría sin origen. */}
            {vista === 'correos' && (
              <VistaCorreos
                correoInicial={puente?.tipo === 'correo' ? puente.para : null}
                claveInicial={puente?.tipo === 'correo' ? (puente.clave ?? null) : null}
                nombreInicial={puente?.tipo === 'correo' ? (puente.nombre ?? null) : null}
                onConsumido={() => setPuente(null)}
              />
            )}
          </div>
        )}
      </div>

      {cabina && <Cabina onCerrar={() => setCabina(false)} enRevision={revision.activo} atajos={atajosDe(vistas)} />}
      <ConsultaIvi abierta={ivi} onCerrar={() => setIvi(false)} />
    </div>
  );
}
