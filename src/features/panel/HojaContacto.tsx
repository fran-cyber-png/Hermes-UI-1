import { IdCard, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import type { Conversacion } from '../../dominio/conversaciones';
import { PanelDerecho } from './PanelDerecho';

/**
 * LA FICHA, AL COSTADO DE DONDE ESTABAS — el panel derecho fuera de Mensajes.
 *
 * ══ QUÉ PROBLEMA CIERRA ══════════════════════════════════════════════════════
 *
 * «¿Quién es esta persona?» se pregunta en el Pipeline y en el padrón, y hasta
 * hoy la única forma de contestarla era **irse a Mensajes** (el botoncito de la
 * tarjeta llama a `onAbrir`, que conmuta de vista). O sea que para saber si a
 * alguien ya le vendimos había que perder el tablero, y volver.
 *
 * No hay componente nuevo adentro: es `PanelDerecho` (ADR 0017) tal cual, con su
 * banda de estado, su timeline, su ficha de Cerberus y su «Registrar venta». Lo
 * único que aporta esta hoja es DÓNDE se monta y CÓMO se cierra.
 *
 * ══ SE SUPERPONE, NO EMPUJA — y el motivo es aritmético ═══════════════════════
 *
 * El `GRID` del Pipeline declara mínimos que suman **1.000 px**. A 1280×720 (la
 * pantalla para la que está diseñada esta app) el área de contenido son ~1.180 px
 * menos el riel: empujando, al tablero le quedarían ~810 px para algo que pide
 * 1.000, y aparecería scroll horizontal — que en Hermes no existe, se scrollea el
 * riel o una columna, nunca la página. Así que la hoja va encima, con el molde
 * que la casa ya tiene (`ConsultaIvi`, ADR 0024).
 *
 * Lo que NO copia de aquélla: el scrim. Ivi es modal porque es una conversación
 * aparte; acá se está eligiendo a quién mirar, y tapar la lista de la que se
 * elige haría falsa la pregunta. Sin scrim se puede tocar otra tarjeta y la hoja
 * cambia de persona sin cerrarse.
 *
 * ══ EL ESCAPE, Y POR QUÉ LLEVA CONDICIÓN ═════════════════════════════════════
 *
 * `useEscape` registra en CAPTURA sobre `window` y corta la propagación: un
 * listener de más apaga el Escape de TODA la app, en silencio (fue exactamente
 * lo que pasó con Ivi, ADR 0024). Acá se paga de dos formas:
 *
 *  · esta hoja se monta y se desmonta con su apertura —el llamador la envuelve en
 *    `{ficha && <HojaContacto …/>}`—, así que cerrada no existe ni el listener;
 *  · y `escapeActivo` deja apagarlo cuando hay algo ENCIMA que también escucha
 *    (los modales de compuerta del Pipeline). Sin eso, un Escape cerraría el
 *    modal y la hoja de una, y la vendedora perdería de vista a quién le estaba
 *    por registrar la venta.
 */
export function HojaContacto({
  conversacion,
  onCerrar,
  escapeActivo = true,
  miVendedora,
}: {
  conversacion: Conversacion;
  onCerrar: () => void;
  /** `false` cuando hay un modal encima que ya maneja su propio Escape. */
  escapeActivo?: boolean;
  /**
   * Quién está mirando. Baja hasta `PanelDerecho` para el timeline (ADR 0037):
   * un evento del contacto lo edita y lo borra SOLO quien lo registró, y sin
   * esto `esMio` da `false` para todos.
   *
   * Sin este cable la hoja no se rompía —degrada a no dibujar los botones, que
   * es el lado correcto del fail— pero la ficha de Pipeline y la del padrón
   * quedaban en solo lectura sin que nada lo dijera: la misma acción se podía
   * hacer desde Mensajes y no desde acá.
   */
  miVendedora?: string | null;
}) {
  useEscape(onCerrar, escapeActivo);

  return (
    <aside
      aria-label="Ficha del contacto"
      className="absolute inset-y-3 right-3 z-30 flex w-[22.5rem] flex-col gap-2 animate-entrar"
    >
      {/* La barra propia existe porque el encabezado del panel no tiene dónde
          poner una X: su esquina derecha es la pastilla de estado (Cliente /
          Lead nuevo), que es justamente lo que no se puede tapar. */}
      <header className="flex shrink-0 items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-panel">
        <IdCard size={14} strokeWidth={2.1} className="shrink-0 text-navy" />
        <h2 className="font-heading text-xs font-bold text-navy">Ficha</h2>
        <kbd className="ml-auto rounded bg-muted px-1.5 font-mono text-[10px] font-semibold text-muted-foreground">
          Esc
        </kbd>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar la ficha"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-200 ease-house hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X size={14} />
        </button>
      </header>

      {/* El panel se queda con lo que sobra y scrollea adentro, igual que en
          Mensajes: su pie («Registrar venta») está clavado y no se puede empujar
          fuera de la hoja. */}
      <div className="min-h-0 flex-1">
        <PanelDerecho conversacion={conversacion} miVendedora={miVendedora} />
      </div>
    </aside>
  );
}
