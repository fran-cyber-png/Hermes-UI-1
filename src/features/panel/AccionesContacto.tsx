import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Loader2, ShoppingCart } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import type { Conversacion } from '../canales/conversaciones';
import { RegistrarGestion } from '../gestion/RegistrarGestion';
import { FormularioVenta } from '../venta/FormularioVenta';
import type { EstadoContacto } from './estadoContacto';

/**
 * QUÉ HAGO — el pie del panel, y la única acción primaria de la pantalla.
 *
 * ── Lo que estaba roto ──
 * «Registrar venta» vivía DENTRO de la pestaña Ficha. Abrir Notas lo hacía
 * desaparecer: el botón que cierra la venta se escondía detrás de una pestaña.
 * Acá está fuera de las pestañas, siempre presente, y es lo último que se lee
 * porque es lo último que se hace.
 *
 * ── Una sola acción primaria ──
 * Antes competían tres botones y dos párrafos («Registrar venta» / «Próxima
 * acción» / «Marcar como interesado» / «Crear cliente en Cerberus» / «refrescá
 * la ficha»). Ahora el estado decide **cuál es LA acción** —cliente: registrar
 * la venta; lead nuevo: marcarlo interesado— y todo lo demás baja de rango:
 * «Próxima acción» es un botón secundario en la misma fila, y el alta en
 * Cerberus es un link chico, no un tercer botón del mismo tamaño.
 */

const CERBERUS = import.meta.env.VITE_CERBERUS_URL ?? 'https://app.goberna.us';

export function AccionesContacto({
  conversacion,
  estado,
  cerberusId,
  cerberusNombre,
  paisNombre,
  onAgendarBienvenida,
}: {
  conversacion: Conversacion;
  estado: EstadoContacto;
  cerberusId: number | null;
  cerberusNombre: string | null;
  paisNombre: string;
  onAgendarBienvenida?: (telefono: string | null) => void;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const telefono = conversacion.persona_id;
  const qc = useQueryClient();

  // Cambiar de conversación desarma cualquier formulario pendiente de la anterior.
  useEffect(() => {
    setMostrarForm(false);
  }, [conversacion.clave]);

  // Para un lead NUEVO registramos la conversión (el dato de embudo): la venta
  // necesita primero que el cliente exista en Cerberus.
  const registrarConversion = useMutation({
    mutationFn: () =>
      api('/api/contactos/registrar-venta', {
        method: 'POST',
        body: JSON.stringify({ telefono, nombre: conversacion.persona_nombre }),
      }),
  });

  const esCliente = estado.tono === 'cliente' && cerberusId !== null;
  const esNuevo = estado.tono === 'nuevo';

  return (
    <footer className="shrink-0 border-t border-border">
      {/* La bitácora: etapa (solo lectura) + próxima acción, que cae en la Agenda.
          Compacta: en una fila, para no comerle alto al detalle en un laptop. */}
      <RegistrarGestion conversacion={conversacion} compacta />

      {/* Ni cliente ni lead: NO hay acción primaria, y se dice por qué. Sin esto
          el pie se quedaba mudo —y en producción la ficha de Cerberus a veces
          cuelga, así que «mudo» es el caso frecuente, no el raro. */}
      {!esCliente && !esNuevo && (
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            {estado.tono === 'cargando' && <Loader2 size={12} className="shrink-0 animate-spin" />}
            {estado.tono === 'cargando'
              ? 'Esperando la ficha de Cerberus para saber qué se puede registrar.'
              : estado.tono === 'sin-saber'
                ? 'Sin la ficha no se puede registrar una venta: no sabemos contra qué cliente.'
                : 'Las ventas se registran contra un teléfono, y este canal no lo trae.'}
          </div>
        </div>
      )}

      {(esCliente || esNuevo) && (
        <div className="px-3 pb-3">
          {esCliente ? (
            <button
              type="button"
              onClick={() => setMostrarForm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-2.5 text-sm font-bold text-white shadow-[0_4px_16px_-4px_rgba(14,42,82,0.5)] transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98]"
            >
              <ShoppingCart size={15} /> Registrar venta
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => registrarConversion.mutate()}
                disabled={registrarConversion.isPending || registrarConversion.isSuccess}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-2.5 text-sm font-bold text-white shadow-[0_4px_16px_-4px_rgba(14,42,82,0.5)] transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:opacity-50"
              >
                {registrarConversion.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : registrarConversion.isSuccess ? (
                  <Check size={15} />
                ) : (
                  <ShoppingCart size={15} />
                )}
                {registrarConversion.isSuccess ? 'Conversión registrada' : 'Marcar como interesado'}
              </button>
              {registrarConversion.isError && (
                <p className="mt-1.5 text-center text-[11px] text-destructive">
                  No se registró la conversión — probá de nuevo.
                </p>
              )}
              <p className="mt-1.5 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                <span>Para cobrarle:</span>
                <a
                  href={`${CERBERUS}/clientes/nuevo/`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                >
                  crear en Cerberus <ExternalLink size={9} />
                </a>
                <button
                  type="button"
                  onClick={() => void qc.invalidateQueries({ queryKey: ['ficha', telefono] })}
                  className="font-semibold text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  refrescar
                </button>
              </p>
            </>
          )}
        </div>
      )}

      {mostrarForm && cerberusId !== null && (
        <FormularioVenta
          clienteId={cerberusId}
          clienteNombre={cerberusNombre ?? conversacion.persona_nombre ?? ''}
          telefono={telefono ?? ''}
          canal={conversacion.canal}
          clave={conversacion.clave}
          personaNombre={conversacion.persona_nombre}
          numeroPropio={conversacion.numero_propio}
          paisNombre={paisNombre}
          onAgendarBienvenida={onAgendarBienvenida}
          onCerrar={() => setMostrarForm(false)}
        />
      )}
    </footer>
  );
}
