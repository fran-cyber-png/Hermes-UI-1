import { useState, type FormEvent } from 'react';
import { AlertTriangle, Loader2, LogIn } from 'lucide-react';
import { ErrorApi } from '../../lib/datos/cliente';

/**
 * El login de la vendedora. Valida contra Cerberus (la identidad real del
 * negocio): la misma credencial con la que entra al ERP. Sobria, una sola acción
 * primaria, marca Goberna.
 */
export function Login({ entrar }: { entrar: (u: string, p: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await entrar(username.trim(), password);
    } catch (err) {
      // El backend distingue "clave mala" (401) de "Cerberus no responde": el
      // mensaje llega tal cual, así la vendedora sabe cuál de los dos pasó.
      setError(err instanceof ErrorApi ? err.message : 'No se pudo iniciar sesión.');
      setEnviando(false);
    }
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-extrabold tracking-tight text-navy">HERMES</div>
          <p className="mt-1 text-sm text-muted-foreground">La mesa de la vendedora</p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Usuario</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              placeholder="tu usuario de Cerberus"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={enviando || !username.trim() || !password}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            {enviando ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="text-center text-xs text-muted-foreground">
            Se valida con tu cuenta de Cerberus.
          </p>
        </form>
      </div>
    </div>
  );
}
