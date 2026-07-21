import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, ExternalLink, Loader2, ShoppingBag, ShoppingCart, UserPlus } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import type { Conversacion } from '../canales/conversaciones';
import { FormularioVenta } from '../venta/FormularioVenta';
import { RegistrarGestion } from '../gestion/RegistrarGestion';

/**
 * LA FICHA DEL CONTACTO — la razón de ser de Hermes.
 *
 * Al lado del chat, quién es esta persona en Cerberus: ¿ya es cliente? ¿cuánto
 * compró? Saberlo antes de escribir cambia todo — no le hablás igual a un lead
 * nuevo que a alguien que ya pagó tres cursos.
 *
 * Cuatro estados, porque colapsarlos miente: cliente / persona nueva / cargando /
 * Cerberus caído. JAMÁS mostrar "no figura" cuando lo que pasó es que la API
 * falló: son cosas opuestas.
 */

interface VentaFicha {
  folio: string;
  estado: string;
  monto: string;
  moneda: string;
  fecha: string;
}

type Ficha =
  | { estado: 'cliente'; id: number; nombre: string; codigo: string; dni: string; pais: string; correo: string; ventasCount: number; ventas: VentaFicha[] }
  | { estado: 'nuevo' }
  | { estado: 'error'; motivo: string };

function useFicha(telefono: string | null, activo: boolean) {
  return useQuery({
    queryKey: ['ficha', telefono],
    queryFn: () => api<Ficha>(`/api/contactos/ficha?telefono=${encodeURIComponent(telefono ?? '')}`),
    enabled: activo && Boolean(telefono),
    staleTime: 60_000,
  });
}

const CERBERUS = import.meta.env.VITE_CERBERUS_URL ?? 'https://app.goberna.us';

export function FichaContacto({ conversacion }: { conversacion: Conversacion }) {
  // La ficha se resuelve por teléfono. Solo aplica a WhatsApp (ahí el persona_id
  // ES el teléfono); en comentarios el persona_id es un id de Meta, no un número.
  const esTelefono = conversacion.canal === 'whatsapp';
  const telefono = conversacion.persona_id;
  const { data, isPending, isError } = useFicha(telefono, esTelefono);
  const [mostrarForm, setMostrarForm] = useState(false);

  // Para un lead NUEVO (todavía no cliente) registramos la conversión (el dato de
  // embudo) — la venta necesita primero crear el cliente en Cerberus.
  const registrarConversion = useMutation({
    mutationFn: () =>
      api('/api/contactos/registrar-venta', {
        method: 'POST',
        body: JSON.stringify({ telefono, nombre: conversacion.persona_nombre }),
      }),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Ficha del contacto</div>
        <div className="mt-1 truncate text-sm font-bold text-foreground">
          {conversacion.persona_nombre ?? telefono ?? 'Contacto'}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!esTelefono ? (
          <p className="text-xs text-muted-foreground">
            La ficha por teléfono aplica a WhatsApp. Para {conversacion.canal}, la identidad cruzada llega
            con <code className="rounded bg-muted px-1 font-mono">tb_contacto_canal</code>.
          </p>
        ) : isPending ? (
          // Skeleton — nunca un flash de "no es cliente" mientras carga.
          <div className="space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : isError || data?.estado === 'error' ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-gold-ink">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>Cerberus no responde — no se puede saber si ya es cliente. No es que sea nuevo: es que la ficha no cargó.</span>
          </div>
        ) : data?.estado === 'nuevo' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <UserPlus size={14} className="shrink-0" />
            No figura en Cerberus todavía. Es un lead nuevo.
          </div>
        ) : data?.estado === 'cliente' ? (
          <div className="flex flex-col gap-4">
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-bold text-success">
                <BadgeCheck size={12} /> Cliente
              </span>
              <div className="mt-2 text-sm font-bold text-foreground">{data.nombre}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
                <span>{data.codigo}</span>
                {data.dni && <span>DNI {data.dni}</span>}
                {data.pais && <span>{data.pais}</span>}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <ShoppingBag size={12} /> Compras ({data.ventasCount})
              </div>
              {data.ventas.length === 0 ? (
                <p className="text-xs text-muted-foreground">Es cliente, pero sin ventas cargadas.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {data.ventas.map((v) => (
                    <li key={v.folio} className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-foreground">{v.folio}</span>
                        <span className="font-semibold tabular-nums text-navy">
                          {v.moneda} {v.monto}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-muted-foreground">
                        <span>{v.estado}</span>
                        <span>{v.fecha}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <a
              href={`${CERBERUS}/clientes/${data.id}/`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
            >
              Ver en Cerberus <ExternalLink size={11} />
            </a>
          </div>
        ) : null}
      </div>

      {/* La bitácora comercial: etapa + próxima acción (cae en la Agenda) + notas. */}
      <RegistrarGestion conversacion={conversacion} />

      {/* Registrar venta — el formulario vive DENTRO de Hermes (la vendedora no
          entra a Cerberus). Para un cliente existente, abre el form; para un lead
          nuevo, registra la conversión (crear el cliente es el paso previo). */}
      {esTelefono && data?.estado === 'cliente' && (
        <footer className="shrink-0 border-t border-border p-3">
          <button
            type="button"
            onClick={() => setMostrarForm(true)}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-2.5 text-sm font-bold text-white shadow-[0_4px_16px_-4px_rgba(14,42,82,0.5)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-navy/90 active:scale-[0.98]"
          >
            <ShoppingCart size={15} /> Registrar venta
          </button>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            El formulario se llena acá. Medio y Origen salen solos de por dónde vino el lead.
          </p>
        </footer>
      )}
      {esTelefono && data?.estado === 'nuevo' && (
        <footer className="shrink-0 border-t border-border p-3">
          <button
            type="button"
            onClick={() => registrarConversion.mutate()}
            disabled={registrarConversion.isPending || registrarConversion.isSuccess}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {registrarConversion.isPending ? <Loader2 size={15} className="animate-spin" /> : <ShoppingCart size={15} />}
            {registrarConversion.isSuccess ? 'Conversión registrada' : 'Marcar como interesado'}
          </button>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            Todavía no es cliente en Cerberus. Se guarda la conversión con el origen del lead.
          </p>
        </footer>
      )}

      {mostrarForm && data?.estado === 'cliente' && (
        <FormularioVenta
          clienteId={data.id}
          clienteNombre={data.nombre}
          telefono={telefono ?? ''}
          canal={conversacion.canal}
          clave={conversacion.clave}
          personaNombre={conversacion.persona_nombre}
          numeroPropio={conversacion.numero_propio}
          onCerrar={() => setMostrarForm(false)}
        />
      )}
    </div>
  );
}
