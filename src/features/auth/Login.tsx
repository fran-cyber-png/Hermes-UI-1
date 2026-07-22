import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { AlertTriangle, Loader2, LogIn } from 'lucide-react';
import { Escudo } from '../../components/Marca';
import { ErrorApi } from '../../lib/datos/cliente';
import { sectionLabel } from '../../lib/styles';
import { CLAVE_ULTIMO_USUARIO } from './sesion';

/**
 * El saludo de la mañana. Valida contra Cerberus (la identidad real del
 * negocio): la misma credencial con la que la vendedora entra al ERP. Banda navy
 * institucional (el ÚNICO navy pleno de fondo de la app), el escudo se firma una
 * vez al montar, último usuario precargado. Ritual de 3 segundos, no un form.
 */

const CLASE_INPUT =
  'rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25';

/**
 * Tres causas distintas, tres mensajes — y ninguno es el error crudo.
 *
 * Ramificar por status solo (401 vs. "todo lo demás") le echaba a Cerberus la
 * culpa de un 500 de Hermes, del CORS o del wifi de la vendedora, y la mandaba
 * a esperar a que se recupere un sistema que nunca estuvo caído. Por eso el
 * server marca su 503 con `type: 'cerberus_caido'` (`routes/auth.ts`) y acá se
 * lee: sin esta lectura, ese campo no servía para nada.
 *
 * Cada mensaje termina en el próximo paso, no en el diagnóstico.
 */
function mensajeDeError(err: unknown): string {
  if (err instanceof ErrorApi && err.status === 401) {
    return 'Usuario o contraseña incorrectos. Revisá y volvé a intentar.';
  }
  if (err instanceof ErrorApi && err.tipo === 'cerberus_caido') {
    return 'Cerberus no responde. Esperá un minuto y probá de nuevo; si sigue, avisá a sistemas.';
  }
  return 'No pude conectar con Hermes. Revisá tu internet y probá de nuevo; si sigue, avisá a sistemas.';
}

/* La firma de apertura: el trazo del escudo se dibuja al montar (~600 ms).
   Los dasharray son los largos reales de cada trazo (con margen); el fill `both`
   deja el escudo completo al terminar — y con prefers-reduced-motion el global
   de index.css lleva la animación a su frame final al instante. */
const FIRMA = `
.escudo-firma circle, .escudo-firma path {
  animation: hermes-firma 600ms var(--ease-house) both;
}
.escudo-firma circle { stroke-dasharray: 73; stroke-dashoffset: 73; }
.escudo-firma path:nth-of-type(1) { stroke-dasharray: 15; stroke-dashoffset: 15; animation-delay: 90ms; }
.escudo-firma path:nth-of-type(2) { stroke-dasharray: 25; stroke-dashoffset: 25; animation-delay: 170ms; }
.escudo-firma path:nth-of-type(3) { stroke-dasharray: 12.5; stroke-dashoffset: 12.5; animation-delay: 250ms; }
@keyframes hermes-firma { to { stroke-dashoffset: 0; } }
`;

export function Login({
  entrar,
  sinServer = false,
  reintentar,
}: {
  entrar: (u: string, p: string) => Promise<void>;
  /** Fase 3 (App): hay token guardado pero el server no contesta — la sesión no se perdió. */
  sinServer?: boolean;
  /** Fase 3 (App): vuelve a validar el token guardado. */
  reintentar?: () => void;
}) {
  const [ultimo] = useState(() => localStorage.getItem(CLAVE_ULTIMO_USUARIO));
  const [username, setUsername] = useState(ultimo ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mayusculas, setMayusculas] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await entrar(username.trim(), password);
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  }

  function detectarMayusculas(e: KeyboardEvent<HTMLInputElement>) {
    setMayusculas(e.getModifierState('CapsLock'));
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-6">
      <style>{FIRMA}</style>
      <div className="w-full max-w-sm">
        <div className="mb-4 flex flex-col items-center rounded-2xl bg-navy px-6 py-8 text-center">
          <span className="escudo-firma">
            <Escudo size={44} />
          </span>
          <div className="mt-3 font-heading text-4xl font-extrabold tracking-[0.06em] text-white">HERMES</div>
          <p className="mt-1.5 text-xs text-navy-muted">La mesa de la vendedora</p>
        </div>

        {sinServer && (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5"
          >
            <p className="text-xs text-warning-foreground">
              No pude conectar con el server — tu sesión quedó guardada.
            </p>
            {reintentar && (
              <button
                type="button"
                onClick={reintentar}
                className="shrink-0 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
              >
                Reintentar
              </button>
            )}
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl bg-card p-6 shadow-panel">
          {ultimo && <p className="font-heading text-base font-bold text-navy">Hola de nuevo</p>}

          <label className="flex flex-col gap-1.5">
            <span className={sectionLabel}>Usuario</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus={!ultimo}
              autoComplete="username"
              className={CLASE_INPUT}
              placeholder="tu usuario"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={sectionLabel}>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={!!ultimo}
              autoComplete="current-password"
              onKeyDown={detectarMayusculas}
              onKeyUp={detectarMayusculas}
              className={CLASE_INPUT}
              placeholder="••••••••"
            />
            {mayusculas && <span className="font-mono text-[11px] text-muted-foreground">Mayúsculas activadas</span>}
          </label>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={enviando || !username.trim() || !password}
            aria-busy={enviando}
            className={
              'group mt-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground shadow-[0_4px_16px_-4px_rgba(37,99,235,0.5)] transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 ' +
              (enviando ? 'cursor-wait opacity-90' : 'disabled:opacity-40 disabled:shadow-none')
            }
          >
            {enviando ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <LogIn size={15} className="transition-transform duration-200 ease-house group-hover:translate-x-0.5" />
            )}
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="text-center text-xs text-muted-foreground">Se valida con tu cuenta de Cerberus.</p>
        </form>
      </div>
    </div>
  );
}
