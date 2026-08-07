import { useState, type FormEvent } from 'react';
import { ArrowUpRight, Compass, ExternalLink } from 'lucide-react';
import { enTauri } from '../../lib/tauri';
import { abrirNavegador } from './abrir';
import { DESTINOS, interpretar } from './destino';

/**
 * EL NAVEGADOR — la novena vista (ADR 0040).
 *
 * ══ QUÉ ES, Y QUÉ NO ═════════════════════════════════════════════════════════
 *
 * Es el LUGAR desde donde se sale a la web con la sesión de TRABAJO: una
 * ventana de Hermes, aparte de la mesa, aparte del Chrome personal. Entrar a la
 * ficha de Cerberus deja de costar «buscar la pestaña entre veinte».
 *
 * NO es un webview embebido en esta pantalla. Se probaron las dos alternativas
 * y las dos se cayeron con datos, no con opiniones (7-ago-2026):
 *
 *   · `<iframe>` — los destinos que importan lo prohíben. Cerberus manda
 *     `X-Frame-Options: DENY`; Meta también; Mattermost y Google, `SAMEORIGIN`.
 *     De la lista entera, lo único que carga es grupogoberna.com.
 *   · webview hijo adentro de la vista — es feature `unstable` de Tauri, y es
 *     una capa del SO ENCIMA del DOM: taparía los modales de Hermes que
 *     cayeran en su rectángulo (compuertas, cabina, Ivi).
 *
 * ══ SIN ORO ══════════════════════════════════════════════════════════════════
 *
 * El dorado significa tiempo que se acaba, y acá no se acaba nada.
 */
export function VistaNavegador({ textoInicial = '' }: { textoInicial?: string } = {}) {
  // `textoInicial` existe SOLO para la galería de evidencia: los estados de esta
  // pantalla dependen de lo que se teclea, y una captura no puede tipear. La app
  // no lo pasa nunca — si algún día alguien lo usa para pre-cargar una
  // dirección, deja de ser un seam de prueba y hay que decir por qué.
  const [tecleado, setTecleado] = useState(textoInicial);
  const [error, setError] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<string | null>(null);

  const destino = interpretar(tecleado);
  const enLaCascara = enTauri();

  async function abrir(url: string, rotulo: string) {
    setError(null);
    const r = await abrirNavegador(url);
    if (r.ok) setUltimo(r.donde === 'hermes' ? rotulo : `${rotulo} · en tu navegador`);
    else {
      setUltimo(null);
      setError(r.motivo);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    // La MISMA función que decide si el botón va habilitado. Separadas, el
    // Enter se saltaría la validación y el error saldría de Rust en vez de
    // salir de acá — la trampa de `motivoParaNoPreguntar` en Ivi (ADR 0024).
    if (!destino.ok) return;
    void abrir(destino.url, destino.url);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-3xl">
        {/* Sin título propio: el rótulo de la vista ya lo pone la cabecera de
            `App.tsx` desde `VISTAS`, y repetirlo dos centímetros más abajo es la
            misma palabra dos veces — además de un segundo `h1` en la página. */}
        <header className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-navy">
            <Compass size={18} strokeWidth={1.9} />
          </div>
          <p className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">
            {enLaCascara
              ? 'Se abre en una ventana de Hermes, con su propia sesión — separada de tu navegador personal.'
              : 'Acá se abre en tu navegador: la ventana propia de Hermes existe solo en la app de escritorio.'}
          </p>
        </header>

        <form onSubmit={enviar} className="mt-6 flex gap-2">
          <input
            type="text"
            value={tecleado}
            onChange={(e) => {
              setTecleado(e.target.value);
              setError(null);
            }}
            placeholder="app.goberna.us"
            aria-label="Dirección"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3.5 py-2.5 font-mono text-sm text-foreground placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <button
            type="submit"
            disabled={!destino.ok}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-white transition-[opacity,transform] duration-200 ease-house active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Abrir
            <ArrowUpRight size={15} strokeWidth={2.2} />
          </button>
        </form>

        {/* El motivo se dice solo cuando hay algo escrito: con la caja vacía, un
            cartel de «no es una dirección» reta por no haber empezado. */}
        {!destino.ok && destino.motivo === 'no_es_direccion' && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Eso no parece una dirección. Acá va un sitio (<span className="font-mono">app.goberna.us</span>), no una
            búsqueda.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] font-medium text-destructive">
            {error}
          </p>
        )}

        {ultimo && !error && (
          <p className="mt-2 text-[12px] text-muted-foreground">
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
              onClick={() => void abrir(d.url, d.nombre)}
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
          Una sola ventana: abrir otro sitio la lleva ahí, no acumula ventanas. Y no manda nada — lo que sale hacia un
          lead sale del chat.
        </p>
      </div>
    </div>
  );
}
