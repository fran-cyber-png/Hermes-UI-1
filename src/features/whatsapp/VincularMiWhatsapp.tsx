import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Smartphone, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import { ErrorApi } from '../../lib/datos/cliente';
import {
  useCancelarAutoVinculacion,
  useEstadoAutoVinculacion,
  useIniciarAutoVinculacion,
  useInvalidarMiLinea,
} from './miLinea';

/**
 * VINCULAR MI WHATSAPP — la auto-vinculación desde `PanelUsuario` (decisión del
 * dueño, 15-ago-2026): «siempre un vendedor (no supervisor) va a tener la
 * posibilidad de enlazar su número, solo 1».
 *
 * Molde: la consola de operador (`routes/vincular.ts`, D13) — mismo ritmo de
 * polling, mismos cinco estados. Lo que cambia es que ACÁ hay una vendedora
 * detrás del token, así que el server sabe de quién es el pareo y este
 * componente no pide ni muestra un número ajeno.
 *
 * Partido en DOS, como `PanelUsuario`/`ContenidoUsuario`: acá el cableado
 * (hooks, polling), en `VistaMiLinea` lo que se DIBUJA. La galería
 * (`galeria-mi-linea.tsx`) pinta cada paso importando la vista directo, sin
 * simular un click ni mockear `fetch` — misma regla que ya vale para
 * `ContenidoUsuario`: la evidencia no puede depender de un navegador que sepa
 * hacer click.
 */
export function VincularMiWhatsapp({ onCerrar }: { onCerrar: () => void }) {
  useEscape(onCerrar);
  const [numero, setNumero] = useState('');
  const [enVuelo, setEnVuelo] = useState(false);

  const iniciar = useIniciarAutoVinculacion();
  const cancelar = useCancelarAutoVinculacion();
  const invalidarMiLinea = useInvalidarMiLinea();
  const estadoQuery = useEstadoAutoVinculacion(enVuelo);
  const e = estadoQuery.data;

  async function vincular() {
    const limpio = numero.replace(/\D/g, '');
    if (limpio.length < 8) return;
    setEnVuelo(true);
    try {
      await iniciar.mutateAsync(limpio);
    } catch {
      setEnVuelo(false); // el 400/409 lo muestra `iniciar.error`; no hay nada que pollear
    }
  }

  function volverAIntentar() {
    setEnVuelo(false);
    iniciar.reset();
  }

  async function cancelarPareo() {
    await cancelar.mutateAsync();
    setEnVuelo(false);
  }

  const paso: PasoMiLinea = !enVuelo
    ? {
        tipo: 'formulario',
        numero,
        onNumero: setNumero,
        onVincular: () => void vincular(),
        error: iniciar.error instanceof ErrorApi ? iniciar.error.message : null,
      }
    : e?.estado === 'conectado'
      ? {
          tipo: 'conectado',
          numero: e.numero,
          onCerrar: () => {
            invalidarMiLinea();
            onCerrar();
          },
        }
      : e?.estado === 'baneado'
        ? { tipo: 'baneado', ban: e.ban, onVolver: volverAIntentar }
        : e?.estado === 'error'
          ? { tipo: 'error', motivo: e.motivo, onVolver: volverAIntentar }
          : e?.estado === 'expirado'
            ? { tipo: 'error', motivo: 'La vinculación se cortó. Probá de nuevo.', onVolver: volverAIntentar }
            : e?.estado === 'esperando_qr'
              ? { tipo: 'qr', qr: e.qr, onCancelar: () => void cancelarPareo() }
              : { tipo: 'esperando', onCancelar: () => void cancelarPareo() };

  return <VistaMiLinea paso={paso} onCerrar={onCerrar} />;
}

// ── LA VISTA — sin un solo hook de datos, así se puede importar en la galería ──

export type PasoMiLinea =
  | { tipo: 'formulario'; numero: string; onNumero: (v: string) => void; onVincular: () => void; error: string | null }
  | { tipo: 'esperando'; onCancelar: () => void }
  | { tipo: 'qr'; qr: string; onCancelar: () => void }
  | { tipo: 'conectado'; numero: string; onCerrar: () => void }
  | { tipo: 'baneado'; ban: { codigo: string; expira: string }; onVolver: () => void }
  | { tipo: 'error'; motivo: string; onVolver: () => void };

export function VistaMiLinea({ paso, onCerrar }: { paso: PasoMiLinea; onCerrar: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Vincular tu WhatsApp"
          className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-card shadow-panel"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-navy px-5 py-3 text-white">
            <div className="flex items-center gap-2 font-heading text-sm font-bold">
              <Smartphone size={16} /> Vincular tu WhatsApp
            </div>
            <button type="button" aria-label="Cerrar" onClick={onCerrar} className="rounded-lg p-1 hover:bg-white/10">
              <X size={16} />
            </button>
          </header>

          <div className="flex flex-col gap-3 p-5">
            {paso.tipo === 'formulario' && (
              <>
                <p className="text-sm leading-snug text-muted-foreground">
                  Traé tu número de WhatsApp a Hermes. Es <b>solo 1 por vendedora</b> — una vez vinculado,
                  para cambiarlo hablá con quien administra Hermes.
                </p>
                <input
                  value={paso.numero}
                  onChange={(ev) => paso.onNumero(ev.target.value)}
                  placeholder="51955135507"
                  inputMode="numeric"
                  autoFocus
                  onKeyDown={(ev) => ev.key === 'Enter' && paso.onVincular()}
                  className="rounded-lg border border-border px-3 py-2 text-center font-mono text-sm"
                />
                {paso.error && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-[12px] leading-snug text-destructive">
                    <AlertTriangle size={13} className="mt-px shrink-0" />
                    {paso.error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={paso.onVincular}
                  disabled={paso.numero.replace(/\D/g, '').length < 8}
                  className="rounded-lg bg-blue-600 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  Vincular
                </button>
              </>
            )}

            {(paso.tipo === 'esperando' || paso.tipo === 'qr') && (
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                {paso.tipo === 'qr' ? (
                  <>
                    <img src={paso.qr} alt="Código QR de WhatsApp" className="size-64 rounded-xl border border-border p-2" />
                    <p className="text-[12px] leading-snug text-muted-foreground">
                      En tu teléfono: <b>WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo</b>{' '}
                      → escaneá este QR. Se refresca solo.
                    </p>
                  </>
                ) : (
                  <>
                    <Loader2 size={28} className="animate-spin text-muted-foreground" />
                    <p className="text-[12px] text-muted-foreground">Generando el QR…</p>
                  </>
                )}
                <button
                  type="button"
                  onClick={paso.onCancelar}
                  className="text-[12px] font-semibold text-muted-foreground underline underline-offset-2"
                >
                  Cancelar
                </button>
              </div>
            )}

            {paso.tipo === 'conectado' && (
              <div className="flex flex-col items-center gap-2 py-3 text-center">
                <CheckCircle2 size={32} className="text-success" />
                <p className="text-sm font-bold text-foreground">¡Listo! Tu número quedó vinculado.</p>
                <button
                  type="button"
                  onClick={paso.onCerrar}
                  className="mt-1 rounded-lg bg-blue-600 px-4 py-1.5 text-[12px] font-bold text-white"
                >
                  Cerrar
                </button>
              </div>
            )}

            {paso.tipo === 'baneado' && (
              <div className="flex flex-col items-center gap-2 py-2 text-center">
                <AlertTriangle size={24} className="text-destructive" />
                <p className="text-[12px] font-bold text-destructive">
                  WhatsApp suspendió el número (código {paso.ban.codigo}). Se levanta {paso.ban.expira}.
                </p>
                <button type="button" onClick={paso.onVolver} className="text-[12px] underline">
                  Volver
                </button>
              </div>
            )}

            {paso.tipo === 'error' && (
              <div className="flex flex-col items-center gap-2 py-2 text-center">
                <AlertTriangle size={24} className="text-destructive" />
                <p className="text-[12px] text-destructive">{paso.motivo}</p>
                <button
                  type="button"
                  onClick={paso.onVolver}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-[12px] font-bold text-white"
                >
                  Reintentar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
