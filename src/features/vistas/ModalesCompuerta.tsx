import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  ClipboardList,
  GraduationCap,
  MessageSquareText,
  ShoppingCart,
  UserPlus,
  X,
} from 'lucide-react';
import type { Conversacion } from '../canales/conversaciones';
import { api } from '../../lib/datos/cliente';
import { useEscape } from '../../lib/teclado/useEscape';
import { Intereses } from '../gestion/Intereses';
import { FormularioVenta } from '../venta/FormularioVenta';
import { useFicha } from '../cerberus/FichaContacto';
import { cotizarEnUnClic, nombreDeTarjeta } from './tarjeta';

/**
 * LOS MODALES DE LAS COMPUERTAS DEL PIPELINE (#60).
 *
 * Soltar una tarjeta en una etapa que necesita un dato ya no rebota: abre acá
 * el modal que pide LO QUE FALTA, y al completarlo el movimiento se concreta.
 * Las compuertas del server (`gestiones.ts`) no se tocan — estos modales las
 * satisfacen, no las evitan. Nada se mueve solo: guardar el interés o registrar
 * la venta es siempre una acción humana explícita.
 */

function Cascara({
  titulo,
  ariaLabel,
  icono,
  onCerrar,
  children,
}: {
  titulo: string;
  ariaLabel: string;
  icono: React.ReactNode;
  onCerrar: () => void;
  children: React.ReactNode;
}) {
  useEscape(onCerrar);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-card shadow-panel"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-navy px-5 py-3 text-white">
            <div className="flex items-center gap-2 font-heading text-sm font-bold">
              {icono} {titulo}
            </div>
            <button type="button" aria-label="Cerrar" onClick={onCerrar} className="rounded-lg p-1 hover:bg-white/10">
              <X size={16} />
            </button>
          </header>
          {children}
        </div>
      </div>
    </>
  );
}

/**
 * COTIZADOS SIN INTERÉS — la compuerta del server rebotó el movimiento porque
 * no se sabe qué curso quiere. Este modal lo registra ahí mismo (reusa el
 * mismo `Intereses` de las tarjetas) y, al guardar, el drag original se
 * completa solo (`onGuardado` reintenta el POST). Cancelar devuelve la tarjeta.
 */
export function ModalInteresCotizado({
  c,
  onGuardado,
  onCancelar,
}: {
  c: Conversacion;
  /** El interés quedó guardado: el Pipeline reintenta mover a Cotizados. */
  onGuardado: () => void;
  /** La vendedora desistió: la tarjeta vuelve a su columna, explícitamente. */
  onCancelar: () => void;
}) {
  const nombre = nombreDeTarjeta(c);
  // El curso que la persona eligió en el formulario: la respuesta más probable a
  // la pregunta de este modal, y ya la sabemos. Un clic en vez de una búsqueda.
  //
  // `cotizarEnUnClic` da las DOS formas del mismo curso y no las confunde: se
  // MUESTRA `etiqueta` (el nombre corto del chip) y se GUARDA `crudo` (el texto
  // del catálogo). Al revés, este botón asentaría un curso inexistente.
  const sugerido = cotizarEnUnClic(c);
  const guardar = useMutation({
    mutationFn: (curso: string) =>
      api('/api/gestiones/intereses', { method: 'POST', body: JSON.stringify({ clave: c.clave, curso }) }),
    onSuccess: onGuardado,
  });

  return (
    <Cascara
      titulo="¿Qué curso está cotizando?"
      ariaLabel="Qué curso está cotizando"
      icono={<GraduationCap size={16} />}
      onCerrar={onCancelar}
    >
      <div className="space-y-3 p-5">
        <p className="text-sm text-foreground">
          Para que <b>{nombre.texto}</b> sepa el precio hay que registrar qué curso le interesa — no
          se cotiza lo que no se sabe qué es.
        </p>

        {sugerido?.hayQueRegistrar && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <ClipboardList size={12} className="shrink-0" />
              Esto eligió en el formulario que llenó
            </p>
            <button
              type="button"
              disabled={guardar.isPending}
              onClick={() => guardar.mutate(sugerido.crudo)}
              className="mt-1.5 flex w-full items-center gap-2 rounded-lg bg-primary px-3 py-2 text-left text-sm font-bold text-primary-foreground transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 active:scale-[0.99] disabled:opacity-60"
            >
              <Check size={14} className="shrink-0" />
              <span className="min-w-0 flex-1">{sugerido.etiqueta}</span>
            </button>
            {guardar.isError && (
              <p className="mt-1.5 text-[11px] text-destructive">
                No se guardó el interés — probá con el buscador de abajo.
              </p>
            )}
          </div>
        )}

        {/* La propuesta del anuncio (#102) llega DENTRO de `Intereses`: cuando la
            hay, no hay nada que buscar — se confirma ahí. El modal no puede saber
            cuál de los dos casos le tocó, así que el texto cubre los dos. */}
        <p className="text-xs text-muted-foreground">
          {sugerido?.hayQueRegistrar
            ? 'O buscá otro curso: al guardarlo, la tarjeta pasa sola a «Saben el precio».'
            : 'Confirmá el curso con el que llegó, o buscalo y agregalo: al guardarlo, la tarjeta pasa sola a «Saben el precio».'}
        </p>
        <Intereses clave={c.clave} senalAbrir={1} onAgregado={onGuardado} />
      </div>
      <footer className="flex shrink-0 justify-end border-t border-border p-4">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted"
        >
          Cancelar — la tarjeta vuelve
        </button>
      </footer>
    </Cascara>
  );
}

/**
 * CIERRE — el cierre no se declara, se gana registrando la venta. El drop abre
 * el formulario de venta REAL (el mismo de la ficha, con precio de Cerberus)
 * con la conversación precargada. Al registrar, el server asienta la etapa
 * `cierre` solo (`asentarVentaEnEmbudo`) — acá no se mueve nada a mano.
 */
export function ModalVentaCierre({
  c,
  onCerrar,
  onAbrir,
  onAgendarBienvenida,
}: {
  c: Conversacion;
  onCerrar: () => void;
  /** La salida cuando la venta no puede registrarse desde acá (lead sin alta en Cerberus). */
  onAbrir: (c: Conversacion) => void;
  onAgendarBienvenida?: (telefono: string | null) => void;
}) {
  const telefono = c.persona_id ?? '';
  const { data, isPending, isError } = useFicha(telefono, Boolean(telefono));

  // Cliente en Cerberus: el formulario de venta de siempre, precargado. Él es
  // su propio modal (overlay incluido) — no se envuelve en otra cáscara.
  if (data?.estado === 'cliente') {
    return (
      <FormularioVenta
        clienteId={data.id}
        clienteNombre={data.nombre}
        telefono={telefono}
        canal={c.canal}
        clave={c.clave}
        personaNombre={c.persona_nombre}
        numeroPropio={c.numero_propio}
        paisNombre={data.pais}
        onAgendarBienvenida={onAgendarBienvenida}
        onCerrar={onCerrar}
      />
    );
  }

  return (
    <Cascara titulo="Registrar venta" ariaLabel="Registrar venta" icono={<ShoppingCart size={16} />} onCerrar={onCerrar}>
      <div className="space-y-3 p-5">
        {isPending ? (
          <>
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-9 animate-pulse rounded-lg bg-muted" />
            <p className="text-xs text-muted-foreground">Buscando la ficha en Cerberus…</p>
          </>
        ) : isError || data?.estado === 'error' ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Cerberus no responde — no se puede registrar la venta ahora. La tarjeta se queda donde
              estaba; probá de nuevo en un rato.
            </span>
          </div>
        ) : (
          <>
            <p className="flex items-start gap-2 text-sm text-foreground">
              <UserPlus size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                <b>{c.persona_nombre ?? telefono}</b> todavía no es cliente en Cerberus, y la venta
                necesita el cliente creado.
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Abrí la conversación: desde la ficha se registra la conversión y está el alta en
              Cerberus. Al crear la venta, la tarjeta pasa sola a Cierre.
            </p>
          </>
        )}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border p-4">
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
        {!isPending && !(isError || data?.estado === 'error') && (
          <button
            type="button"
            onClick={() => {
              onAbrir(c);
              onCerrar();
            }}
            className="flex items-center gap-2 rounded-xl bg-navy px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98]"
          >
            <MessageSquareText size={14} /> Abrir la conversación
          </button>
        )}
      </footer>
    </Cascara>
  );
}
