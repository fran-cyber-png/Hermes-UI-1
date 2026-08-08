import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Compass, ExternalLink, RotateCw, X } from 'lucide-react';
import { enTauri } from '../../lib/tauri';
import { abrirNavegador } from './abrir';
import { DESTINOS, interpretar } from './destino';
import { useNavegadorEmbebido } from './useNavegadorEmbebido';

/**
 * EL NAVEGADOR — la novena vista (ADR 0040, enmendado por **ADR 0043**).
 *
 * ══ QUÉ CAMBIÓ, Y POR QUÉ ════════════════════════════════════════════════════
 *
 * Acá decía que esto NO era un webview embebido, y daba dos motivos. Uno sigue
 * intacto y el otro se dio vuelta:
 *
 *   · `<iframe>` — **sigue muerto**. Cerberus manda `X-Frame-Options: DENY` y
 *     Meta también (ADR 0040). Y lo que el dueño pidió el 8-ago-2026 —enlazar
 *     Google, entrar a ChatGPT— es justo lo que un iframe no carga: medido ese
 *     día, `chatgpt.com` manda `SAMEORIGIN` y `accounts.google.com`, `DENY`.
 *   · **webview hijo** — el motivo era que es una capa del SO ENCIMA del DOM y
 *     taparía lo que caiga debajo. Sigue siendo verdad; lo que cambió es que
 *     ahora se paga con código en vez de con una ventana aparte: la vista lo
 *     ESCONDE cuando hay algo encima (`tapado`), y esa costura vive en un solo
 *     lugar (`useNavegadorEmbebido.ts`).
 *
 * ══ 🔴 LA VENTANA APARTE NO SE ARCHIVA ═══════════════════════════════════════
 *
 * Pasa a ser el peldaño del medio de la escalera de respaldo, y eso NO es
 * prolijidad: la UI viaja por OTA y llega a las cuatro máquinas en el acto,
 * mientras que la CÁSCARA es un `.dmg`/`.exe` que se reinstala a mano. O sea
 * que existe —y el día del deploy es TODAS— una franja donde esta vista llega
 * a una cáscara que no sabe atenderla. Con `soportado === false` la pantalla
 * vuelve a ser exactamente la de ADR 0040, y lo DICE.
 *
 * ══ SIN ORO ══════════════════════════════════════════════════════════════════
 *
 * El dorado significa tiempo que se acaba, y acá no se acaba nada.
 */
export function VistaNavegador({
  tapado = false,
  textoInicial = '',
  destinoInicial,
}: { tapado?: boolean; textoInicial?: string; destinoInicial?: string } = {}) {
  const nav = useNavegadorEmbebido({ tapado });

  // `textoInicial` y `destinoInicial` existen SOLO para la galería de
  // evidencia: los estados de esta pantalla dependen de lo que se teclea y de
  // lo que se abre, y una captura no puede tipear ni hacer clic. La app no los
  // pasa nunca. `destinoInicial` es el único modo de fotografiar el webview
  // embebido, que por ser una capa del SO no se puede dibujar de mentira.
  const [tecleado, setTecleado] = useState(textoInicial);
  const [editando, setEditando] = useState(false);
  const [errorClasico, setErrorClasico] = useState<string | null>(null);
  const [ultimoClasico, setUltimoClasico] = useState<string | null>(null);
  const caja = useRef<HTMLInputElement | null>(null);

  /**
   * ⚠️ LA BARRA MUESTRA DÓNDE ESTÁ, NO LO QUE SE PIDIÓ — salvo mientras se
   * escribe. Sin la guarda de `editando`, el sondeo de `navegador_donde`
   * (1/segundo) le pisaría las letras a la vendedora a mitad de tipeo.
   */
  useEffect(() => {
    if (!editando && nav.donde) setTecleado(nav.donde);
  }, [nav.donde, editando]);

  const destino = interpretar(tecleado);
  const embebido = nav.soportado !== false;

  // Solo la galería lo usa. Se dispara una vez, después del primer layout: sin
  // el hueco medido, `ir()` no tiene rectángulo que mandar.
  const yaArranco = useRef(false);
  useEffect(() => {
    if (!destinoInicial || yaArranco.current) return;
    yaArranco.current = true;
    void nav.ir(destinoInicial);
  }, [destinoInicial, nav]);

  async function abrirClasico(url: string, rotulo: string) {
    setErrorClasico(null);
    const r = await abrirNavegador(url);
    if (r.ok) setUltimoClasico(r.donde === 'hermes' ? rotulo : `${rotulo} · en tu navegador`);
    else {
      setUltimoClasico(null);
      setErrorClasico(r.motivo);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    // La MISMA función que decide si el botón va habilitado. Separadas, el
    // Enter se saltaría la validación y el error saldría de Rust en vez de
    // salir de acá — la trampa de `motivoParaNoPreguntar` en Ivi (ADR 0024).
    if (!destino.ok) return;
    caja.current?.blur();
    if (embebido) void nav.ir(destino.url);
    else void abrirClasico(destino.url, destino.url);
  }

  function tocarDestino(url: string, nombre: string) {
    if (embebido) void nav.ir(url);
    else void abrirClasico(url, nombre);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── LA BARRA ──────────────────────────────────────────────────────────
          Es lo que ADR 0040 no podía tener: en una ventana externa sin barra de
          direcciones, «volver» costaba cerrar y empezar de nuevo. Acá la barra
          es DOM de Hermes, arriba del rectángulo del webview, así que no la
          tapa nada. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2.5">
        {embebido && (
          <div className="flex shrink-0 items-center gap-0.5">
            {/* ⚠️ Nunca deshabilitados: Tauri no expone el historial del webview
                (solo `reload`), así que atrás/adelante van por `history` y NO se
                puede saber si hay a dónde volver. Apagarlos pediría un dato que
                no existe; que a veces no hagan nada es el costo honesto. */}
            <BotonBarra titulo="Atrás" onClick={nav.atras} apagado={!nav.montado}>
              <ArrowLeft size={16} strokeWidth={2} />
            </BotonBarra>
            <BotonBarra titulo="Adelante" onClick={nav.adelante} apagado={!nav.montado}>
              <ArrowRight size={16} strokeWidth={2} />
            </BotonBarra>
            <BotonBarra titulo="Recargar" onClick={nav.recargar} apagado={!nav.montado}>
              <RotateCw size={15} strokeWidth={2} />
            </BotonBarra>
          </div>
        )}

        <form onSubmit={enviar} className="flex min-w-0 flex-1 items-center gap-2">
          <input
            ref={caja}
            type="text"
            value={tecleado}
            onChange={(e) => {
              setTecleado(e.target.value);
              setErrorClasico(null);
            }}
            onFocus={(e) => {
              setEditando(true);
              e.target.select();
            }}
            onBlur={() => setEditando(false)}
            placeholder="app.goberna.us"
            aria-label="Dirección"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-[13px] text-foreground placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <button
            type="submit"
            disabled={!destino.ok}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-navy px-3 py-1.5 text-[13px] font-semibold text-white transition-[opacity,transform] duration-200 ease-house active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ir
            <ArrowUpRight size={14} strokeWidth={2.2} />
          </button>
        </form>

        {embebido && nav.montado && (
          <BotonBarra titulo="Cerrar la página" onClick={nav.cerrar}>
            <X size={16} strokeWidth={2} />
          </BotonBarra>
        )}
      </div>

      {/* ── EL HUECO ──────────────────────────────────────────────────────────
          🔴 Acá NO se dibuja el navegador: se RESERVA su rectángulo. El webview
          es una capa del sistema operativo puesta encima, y lo único que existe
          en React es este `div` vacío que el hook mide. Por eso tiene que estar
          montado ANTES del primer destino: sin él, `medir()` no tiene qué medir
          y el primer clic no abriría nada. */}
      <div ref={nav.hueco} className="relative min-h-0 flex-1 bg-background">
        {(!nav.montado || !embebido) && (
          <Lanzador
            embebido={embebido}
            destino={destino}
            error={nav.error ?? errorClasico}
            ultimo={ultimoClasico}
            onDestino={tocarDestino}
          />
        )}
      </div>
    </div>
  );
}

function BotonBarra({
  titulo,
  onClick,
  apagado = false,
  children,
}: {
  titulo: string;
  onClick: () => void;
  apagado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      disabled={apagado}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 ease-house hover:bg-secondary hover:text-navy disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  );
}

/**
 * A DÓNDE SE VA TODOS LOS DÍAS — y el estado vacío del navegador.
 *
 * Ocupa el hueco mientras no hay página montada, así que la vendedora nunca ve
 * un rectángulo gris sin explicación. Cuando el webview aparece, esto
 * desaparece debajo de él.
 */
function Lanzador({
  embebido,
  destino,
  error,
  ultimo,
  onDestino,
}: {
  embebido: boolean;
  destino: ReturnType<typeof interpretar>;
  error: string | null;
  ultimo: string | null;
  onDestino: (url: string, nombre: string) => void;
}) {
  const enLaCascara = enTauri();

  return (
    <div className="absolute inset-0 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-navy">
            <Compass size={18} strokeWidth={1.9} />
          </div>
          <p className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">
            {embebido
              ? 'Se abre acá adentro, con la sesión de trabajo de Hermes — separada de tu navegador personal. Las cuentas que enlaces quedan enlazadas.'
              : enLaCascara
                ? 'Esta versión de la app todavía abre el navegador en una ventana aparte. Cuando se reinstale, se abre acá adentro.'
                : 'Acá se abre en tu navegador: el navegador propio de Hermes existe solo en la app de escritorio.'}
          </p>
        </header>

        {/* El motivo se dice solo cuando hay algo escrito: con la caja vacía, un
            cartel de «no es una dirección» reta por no haber empezado. */}
        {!destino.ok && destino.motivo === 'no_es_direccion' && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Eso no parece una dirección. Arriba va un sitio (<span className="font-mono">app.goberna.us</span>), no una
            búsqueda.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] font-medium text-destructive"
          >
            {error}
          </p>
        )}

        {ultimo && !error && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Abierto: <span className="font-mono text-foreground">{ultimo}</span>
          </p>
        )}

        <h2 className="mt-8 font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          A dónde se va todos los días
        </h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {DESTINOS.map((d) => (
            <button
              key={d.url}
              type="button"
              onClick={() => onDestino(d.url, d.nombre)}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-[border-color,box-shadow,transform] duration-200 ease-house hover:border-navy/30 hover:shadow-panel active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-navy">{d.nombre}</p>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{d.para}</p>
              </div>
              <ExternalLink
                size={14}
                strokeWidth={1.9}
                className="mt-0.5 shrink-0 text-muted-foreground transition-colors duration-200 group-hover:text-navy"
              />
            </button>
          ))}
        </div>

        {/* Lo que NO hace, dicho donde se pregunta. La regla es de toda la casa:
            un envío es una acción humana por el composer (ADR 0015). */}
        <p className="mt-6 text-[12px] leading-relaxed text-muted-foreground">
          {embebido
            ? 'Una sola página a la vez: abrir otro sitio te lleva ahí. Y no manda nada — lo que sale hacia un lead sale del chat.'
            : 'Una sola ventana: abrir otro sitio la lleva ahí, no acumula ventanas. Y no manda nada — lo que sale hacia un lead sale del chat.'}
        </p>
      </div>
    </div>
  );
}
