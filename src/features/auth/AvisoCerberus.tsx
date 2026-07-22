import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';

/**
 * «PERDISTE LA LLAVE DE CERBERUS» — el aviso que llega ANTES de la venta.
 *
 * ── El problema que mata ──
 * El token de Hermes y la sesión de Cerberus tienen vidas distintas: el primero
 * dura 14 días y sobrevive un reinicio del server; la segunda vive en memoria del
 * proceso y muere con él (`cerberus/sesionStore.ts`, a propósito: es una
 * credencial viva y no va al disco).
 *
 * Consecuencia: tras cualquier reinicio, la vendedora seguía trabajando como si
 * nada —la cola carga, los chats andan, el buscador de cursos responde— y se
 * enteraba **recién al registrar una venta**, con un 409 y un texto que le decía
 * «volvé a entrar» sin darle por dónde. En el peor momento posible: con el
 * cliente esperando del otro lado.
 *
 * Acá se lo decimos antes, y con el botón puesto. Reconectar es entrar de nuevo
 * —es el único camino que repone la cookie— pero sin perder nada: `entrar()` con
 * el mismo usuario conserva el caché.
 *
 * Ámbar, no dorado: en Hermes el oro es tiempo que se acaba. Esto no se acaba,
 * está roto.
 */
export function AvisoCerberus({
  usuario,
  entrar,
}: {
  usuario: string;
  entrar: (u: string, p: string) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState('');
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reconectar() {
    if (!clave || yendo) return;
    setYendo(true);
    setError(null);
    try {
      await entrar(usuario, clave);
      setClave('');
      setAbierto(false);
    } catch {
      // El detalle del fallo ya lo cuenta el Login; acá alcanza el próximo paso.
      setError('No se pudo reconectar. Revisá la contraseña y probá de nuevo.');
    } finally {
      setYendo(false);
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning-foreground transition-colors hover:bg-warning/20"
      >
        <KeyRound size={12} />
        Reconectá con Cerberus para registrar ventas
      </button>

      {abierto && (
        <>
          <button type="button" aria-label="Cerrar" onClick={() => setAbierto(false)} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl bg-card p-4 shadow-panel animate-entrar">
            <p className="text-xs font-bold text-foreground">Hermes perdió tu sesión de Cerberus.</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Pasa cuando el server se reinicia. Todo lo demás sigue funcionando —
              lo único que no vas a poder es <strong className="font-semibold">registrar una venta</strong>, porque
              se registra con tu identidad de Cerberus.
            </p>

            <label className="mt-3 block text-[11px] font-semibold text-muted-foreground" htmlFor="clave-cerberus">
              Contraseña de {usuario}
            </label>
            <input
              id="clave-cerberus"
              type="password"
              value={clave}
              autoFocus
              autoComplete="current-password"
              onChange={(e) => setClave(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void reconectar();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setAbierto(false);
                }
              }}
              className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
            />

            {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}

            <button
              type="button"
              onClick={() => void reconectar()}
              disabled={!clave || yendo}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-3 py-2 text-xs font-bold text-white transition-[background-color,transform] hover:bg-navy/90 active:scale-[0.98] disabled:opacity-40"
            >
              {yendo ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
              Reconectar
            </button>

            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              No perdés nada: seguís siendo vos, con tu cola y tus conversaciones donde estaban.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** El mismo aviso, en línea, para cuando el formulario de venta ya rebotó. */
export function VentaSinCerberus({ onReconectar }: { onReconectar: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning-foreground">
        <KeyRound size={22} />
      </div>
      <p className="text-sm font-bold text-foreground">Hermes perdió tu sesión de Cerberus.</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
        La venta se registra con tu identidad de Cerberus, y esa sesión se cae cuando el server se
        reinicia. Reconectá y volvé a abrir la venta — no perdés nada de lo demás.
      </p>
      <button
        type="button"
        onClick={onReconectar}
        className="flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition-[background-color,transform] hover:bg-navy/90 active:scale-[0.98]"
      >
        <KeyRound size={14} /> Reconectar con Cerberus
      </button>
    </div>
  );
}
