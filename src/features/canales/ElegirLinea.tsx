import { MessageCircle, Phone, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import { formatoTelefono } from '../../lib/formato';
import type { LineaWhatsapp } from '../../dominio/lineas';
import { boton } from '../../lib/styles';

/**
 * ELEGIR LÍNEA PARA ESCRIBIR — cuando hay varias, no se adivina.
 *
 * Hoy `App.tsx` arma el chat nuevo con `sesionWa.telefono`, que es la única
 * línea de la sesión WA conectada. Eso anduvo mientras había una sola línea;
 * con dos (Cloud API + whatsmeow) la vendedora necesita decidir desde cuál
 * inicia el contacto, porque el transporte, los topes de media y el riesgo de
 * ban cambian según la línea.
 *
 * Este modal se abre solo cuando hay más de una línea activa. Con una sola, el
 * puente salta directo y esto ni se monta.
 */

export function ElegirLinea({
  telefono,
  lineas,
  onElegir,
  onCerrar,
}: {
  telefono: string;
  lineas: LineaWhatsapp[];
  onElegir: (numeroPropio: string) => void;
  onCerrar: () => void;
}) {
  useEscape(onCerrar);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]"
        onClick={onCerrar}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Elegir línea para escribir"
          className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-card shadow-panel"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-navy px-5 py-3 text-white">
            <div className="flex items-center gap-2 font-heading text-sm font-bold">
              <Phone size={16} /> Elegir línea
            </div>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onCerrar}
              className="rounded-lg p-1 hover:bg-white/10"
            >
              <X size={16} />
            </button>
          </header>

          <div className="p-5">
            <p className="mb-3 text-sm text-foreground">
              ¿Desde qué número le escribís a{' '}
              <span className="font-mono tabular-nums text-navy-ink">{formatoTelefono(telefono)}</span>?
            </p>
            <div className="flex flex-col gap-2">
              {lineas.map((linea) => (
                <button
                  key={linea.numero}
                  type="button"
                  onClick={() => onElegir(linea.numero)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary hover:bg-secondary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-bold text-foreground">{linea.etiqueta}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatoTelefono(linea.numero)}
                    </span>
                  </span>
                  <MessageCircle size={16} className="shrink-0 text-primary" />
                </button>
              ))}
            </div>
          </div>

          <footer className="flex shrink-0 justify-end border-t border-border p-4">
            <button
              type="button"
              onClick={onCerrar}
              className={boton('secundario')}
            >
              Cancelar
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}
