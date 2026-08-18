import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Mail, Megaphone } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { fechaCorta } from '../../lib/formato';
import { sectionLabel } from '../../lib/styles';
import { etiquetaFuente, nombreDistinto, type LeadForm as LeadFormDato } from './leadForm';
import type { DestinoCorreo } from '../../lib/puente';

/**
 * EL BLOQUE «LEAD-FORM» (#113) — lo que Meta o la landing web ya sabía.
 *
 * Cuando el teléfono de la conversación matchea un lead de formulario, esto trae
 * el nombre real, el EMAIL (el insumo para la cotización, #46) y la campaña. Cada
 * dato va MARCADO con «📋 del formulario de Meta» / «📋 del formulario web»: no es
 * dato de Cerberus, es lo que la persona escribió al levantar la mano.
 *
 * Neutro a propósito (sin dorado: el oro significa tiempo que se acaba, nada
 * más). Sin lead → no renderiza NADA: ni placeholder ni hueco. El componente se
 * pone en la ficha y en el panel de contexto; se auto-oculta si no hay teléfono
 * (los canales de Meta no traen número) o si no hubo match.
 */

/** Exportada: la banda de estado del panel la usa para el NOMBRE REAL (mismo caché). */
export function useLeadForm(telefono: string | null, activo: boolean) {
  return useQuery({
    queryKey: ['lead-form', telefono],
    queryFn: () =>
      api<{ lead: LeadFormDato | null }>(`/api/contactos/lead?telefono=${encodeURIComponent(telefono ?? '')}`),
    enabled: activo && Boolean(telefono),
    staleTime: 60_000,
  });
}

function EmailCopiable({ email }: { email: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono text-xs text-foreground">{email}</span>
      <button
        type="button"
        title="Copiar el correo"
        onClick={() => {
          void navigator.clipboard?.writeText(email);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        }}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        {copiado ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      </button>
    </span>
  );
}

export function BloqueLeadForm({
  telefono,
  activo,
  pushname,
  sinNombre = false,
  onCorreo,
}: {
  telefono: string | null;
  activo: boolean;
  pushname: string | null;
  /** El nombre real ya se muestra arriba (la banda del panel): no repetirlo acá. */
  sinNombre?: boolean;
  /**
   * 🔴 **ACÁ EL CORREO NO ES UN DATO MÁS: ES EL ÚNICO CANAL QUE HAY.** Un lead
   * de formulario nunca nos escribió (ADR 0051), así que abrirle el chat es
   * contacto en frío — el camino corto al ban en whatsmeow (regla dura #7) —
   * y en la línea de Cloud API la ventana de 24 h ni siquiera está abierta.
   * El correo sí se puede mandar hoy, y hasta ahora lo único que se podía
   * hacer con él era copiarlo a mano.
   *
   * Sin esta prop se dibuja solo el copiar, como antes: nunca un botón que
   * no lleva a ningún lado.
   */
  onCorreo?: (destino: DestinoCorreo) => void;
}) {
  const { data } = useLeadForm(telefono, activo);
  const lead = data?.lead;
  if (!lead) return null; // sin match: nada. Ni placeholder ni hueco.

  const nombre = sinNombre ? null : nombreDistinto(pushname, lead.nombre);
  const etiqueta = etiquetaFuente(lead.fuente);
  const titulo = etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1); // «Del formulario de Meta»

  return (
    <div className="mt-5">
      <div className={sectionLabel}>📋 {titulo}</div>
      <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
        {nombre && (
          <div>
            <div className="text-[11px] text-muted-foreground">Nombre real</div>
            <div className="text-sm font-semibold text-foreground">{nombre}</div>
          </div>
        )}

        {lead.email && (
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">Correo</div>
            <EmailCopiable email={lead.email} />
            {onCorreo && (
              <button
                type="button"
                onClick={() => onCorreo({ para: lead.email!, nombre: lead.nombre ?? pushname ?? undefined })}
                className="mt-1 inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-secondary"
              >
                <Mail size={10} /> Escribirle
              </button>
            )}
          </div>
        )}

        {lead.campana && (
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">Campaña</div>
            <div className="flex items-start gap-1.5 text-sm text-foreground">
              <Megaphone size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">{lead.campana}</span>
            </div>
          </div>
        )}

        <div className="text-[11px] text-muted-foreground">Lo llenó el {fechaCorta(lead.fecha)}</div>
      </div>
    </div>
  );
}
