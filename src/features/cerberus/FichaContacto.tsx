import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, ExternalLink, Loader2, ShoppingBag, ShoppingCart, UserPlus } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { fechaCorta } from '../../lib/formato';
import { sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../canales/conversaciones';
import { Avatar } from '../canales/Avatar';
import { FormularioVenta } from '../venta/FormularioVenta';
import { RegistrarGestion } from '../gestion/RegistrarGestion';
import { Intereses } from '../gestion/Intereses';
import { PanelNotas } from '../notas/PanelNotas';
import { BloqueLeadForm } from './BloqueLeadForm';

/**
 * LA FICHA DEL CONTACTO — la razón de ser de Hermes.
 *
 * Al lado del chat, quién es esta persona en Cerberus: ¿ya es cliente? ¿cuánto
 * compró? Saberlo antes de escribir cambia todo — no le hablás igual a un lead
 * nuevo que a alguien que ya pagó tres cursos. La cifra héroe de la ficha es
 * ESA: cuánto compró.
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

export type Ficha =
  | { estado: 'cliente'; id: number; nombre: string; codigo: string; dni: string; pais: string; correo: string; ventasCount: number; ventas: VentaFicha[] }
  | { estado: 'nuevo' }
  | { estado: 'error'; motivo: string };

/** Exportado para el modal de Cierre del Pipeline (#60): misma query, mismo caché. */
export function useFicha(telefono: string | null, activo: boolean) {
  return useQuery({
    queryKey: ['ficha', telefono],
    queryFn: () => api<Ficha>(`/api/contactos/ficha?telefono=${encodeURIComponent(telefono ?? '')}`),
    enabled: activo && Boolean(telefono),
    staleTime: 60_000,
  });
}

const CERBERUS = import.meta.env.VITE_CERBERUS_URL ?? 'https://app.goberna.us';

/** Cuánto compró: suma de las ventas no anuladas de la moneda principal. */
function resumenCompras(ventas: VentaFicha[]): { moneda: string; total: number; n: number } | null {
  const validas = ventas.filter((v) => !/anul/i.test(v.estado));
  if (validas.length === 0) return null;
  const moneda = validas[0].moneda;
  const mismas = validas.filter((v) => v.moneda === moneda);
  const total = mismas.reduce((s, v) => s + (Number.parseFloat(v.monto) || 0), 0);
  return { moneda, total, n: mismas.length };
}

function claseEstadoVenta(estado: string): string {
  if (/pagad/i.test(estado)) return 'text-success';
  if (/anul/i.test(estado)) return 'text-destructive';
  return 'text-muted-foreground';
}

export function FichaContacto({
  conversacion,
  onCorreo,
  onAgendarBienvenida,
}: {
  conversacion: Conversacion;
  /** Puente a Correos: prellena el Para con el correo de la ficha. Sin esto, la acción no se muestra. */
  onCorreo?: (para: string) => void;
  /** Puente a la Agenda desde el recibo de venta. Sin esto, el botón no se muestra. */
  onAgendarBienvenida?: (telefono: string | null) => void;
}) {
  // La ficha se resuelve por teléfono. Solo aplica a WhatsApp (ahí el persona_id
  // ES el teléfono); en comentarios el persona_id es un id de Meta, no un número.
  const esTelefono = conversacion.canal === 'whatsapp';
  const telefono = conversacion.persona_id;
  const { data, isPending, isError } = useFicha(telefono, esTelefono);
  const [mostrarForm, setMostrarForm] = useState(false);
  const qc = useQueryClient();

  // Cambiar de conversación desarma cualquier form pendiente de la anterior.
  // (La señal `senalVenta` del drop en Cierre del kanban se retiró en #60: ese
  // drop ahora abre su modal DENTRO del Pipeline, sin viajar a la Bandeja.)
  useEffect(() => {
    setMostrarForm(false);
  }, [conversacion.clave]);

  // Para un lead NUEVO (todavía no cliente) registramos la conversión (el dato de
  // embudo) — la venta necesita primero crear el cliente en Cerberus.
  const registrarConversion = useMutation({
    mutationFn: () =>
      api('/api/contactos/registrar-venta', {
        method: 'POST',
        body: JSON.stringify({ telefono, nombre: conversacion.persona_nombre }),
      }),
  });

  const resumen = data?.estado === 'cliente' ? resumenCompras(data.ventas) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className={sectionLabel}>Ficha del contacto</div>
        <div className="mt-1 flex items-center gap-2.5">
          <Avatar
            nombre={conversacion.persona_nombre ?? telefono}
            telefono={esTelefono ? telefono : null}
            conFoto={esTelefono}
            className="size-8 shrink-0 rounded-[11px] bg-secondary text-xs font-bold text-navy"
          />
          <div className="min-w-0 truncate text-sm font-bold text-foreground">
            {conversacion.persona_nombre ?? telefono ?? 'Contacto'}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!esTelefono ? (
          <p className="text-xs text-muted-foreground">
            La ficha por teléfono aplica a WhatsApp. Para este canal, la ficha cruzada está en camino.
          </p>
        ) : isPending ? (
          // Skeleton con la anatomía de la ficha — nunca un flash de "no es cliente".
          <div className="space-y-3">
            <div className="h-5 w-[60px] animate-pulse rounded-full bg-muted" />
            <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
            <div className="flex gap-2">
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="h-3 w-12 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : isError || data?.estado === 'error' ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
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
            {/* La cifra héroe: cuánto compró. */}
            {resumen && (
              <div>
                <div className="font-heading text-2xl font-bold tabular-nums text-navy">
                  {resumen.moneda} {resumen.total.toLocaleString('es', { maximumFractionDigits: 2 })}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  en {resumen.n} {resumen.n === 1 ? 'compra' : 'compras'}
                </div>
              </div>
            )}

            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-bold text-success">
                <BadgeCheck size={12} /> Cliente
              </span>
              <div className="mt-2 text-sm font-bold text-foreground">{data.nombre}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
                <span>{data.codigo}</span>
                {data.dni && <span>DNI {data.dni}</span>}
                {data.pais && <span>{data.pais}</span>}
                {data.correo && (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{data.correo}</span>
                    {onCorreo && (
                      <button
                        type="button"
                        onClick={() => onCorreo(data.correo)}
                        className="shrink-0 font-sans font-semibold text-primary hover:underline"
                      >
                        Mandar correo
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className={'mb-1.5 flex items-center gap-1.5 ' + sectionLabel}>
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
                      <div className="mt-0.5 flex items-center justify-between">
                        <span className={'font-medium ' + claseEstadoVenta(v.estado)}>{v.estado}</span>
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{fechaCorta(v.fecha)}</span>
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

        {/* Lo que Meta o la landing web ya sabía, por match de teléfono (#113):
            nombre real, EMAIL y campaña, marcados por origen. Va SIEMPRE (es dato
            de Hermes, no de Cerberus); se auto-oculta si el teléfono no matcheó
            ningún lead. */}
        <BloqueLeadForm telefono={telefono} activo={esTelefono} pushname={conversacion.persona_nombre} />

        {/* La línea de tiempo del interés: qué cursos pidió y cuándo (#57). Va
            SIEMPRE (sea cliente, lead nuevo o Cerberus caído): el interés es dato
            de Hermes, no de la ficha de Cerberus. */}
        <div className={'mt-5 ' + sectionLabel}>Le interesa</div>
        <div className="mt-2">
          <Intereses clave={conversacion.clave} compacto />
        </div>
      </div>

      {/* La bitácora comercial: próxima acción (cae en la Agenda). */}
      <RegistrarGestion conversacion={conversacion} />
      {/* Las notas de ESTA conversación (#47) — editables, se archivan, no derivan nada. */}
      <PanelNotas clave={conversacion.clave} />

      {/* Registrar venta — el formulario vive DENTRO de Hermes (la vendedora no
          entra a Cerberus). Para un cliente existente, abre el form; para un lead
          nuevo, registra la conversión (crear el cliente es el paso previo). */}
      {esTelefono && data?.estado === 'cliente' && (
        <footer className="shrink-0 border-t border-border p-3">
          <button
            type="button"
            onClick={() => setMostrarForm(true)}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-2.5 text-sm font-bold text-white shadow-[0_4px_16px_-4px_rgba(14,42,82,0.5)] transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98]"
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
          {registrarConversion.isError && (
            <p className="mt-1.5 text-center text-[11px] text-destructive">No se registró la conversión — probá de nuevo.</p>
          )}
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            Todavía no es cliente en Cerberus. Se guarda la conversión con el origen del lead.
          </p>
          {/* La salida honesta mientras no exista el alta proxy: crear el cliente allá. */}
          <a
            href={`${CERBERUS}/clientes/nuevo/`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 text-xs font-bold text-primary hover:underline"
          >
            Crear cliente en Cerberus <ExternalLink size={11} />
          </a>
          <p className="mt-1 text-center text-[11px] text-muted-foreground">
            Al volver,{' '}
            <button
              type="button"
              onClick={() => void qc.invalidateQueries({ queryKey: ['ficha', telefono] })}
              className="font-semibold text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              refrescá la ficha
            </button>
            .
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
          paisNombre={data.pais}
          onAgendarBienvenida={onAgendarBienvenida}
          onCerrar={() => setMostrarForm(false)}
        />
      )}
    </div>
  );
}
