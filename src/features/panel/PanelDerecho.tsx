import { useState } from 'react';
import type { Conversacion } from '../canales/conversaciones';
import { marcaDeCliente } from '../canales/cliente';
import { useFicha } from '../cerberus/FichaContacto';
import type { Ficha } from '../cerberus/ficha';
import { useLeadForm } from '../cerberus/BloqueLeadForm';
import { useIntereses } from '../gestion/Intereses';
import { useSenales } from '../senales/senales';
import { estadoDelContacto } from './estadoContacto';
import { nombreDelContacto } from './identidad';
import { ensamblarTimeline } from './timeline';
import { EncabezadoTimeline } from './EncabezadoTimeline';
import { EventoLinea } from './EventoLinea';
import { PieAccionTimeline } from './PieAccionTimeline';
import { ZonaPendientes } from './ZonaPendientes';
import { VentaDesdeElPanel } from '../venta/VentaDesdeElPanel';

function fichaDeCliente(f: Ficha | undefined): Extract<Ficha, { estado: 'cliente' }> | null {
  return f?.estado === 'cliente' ? f : null;
}

function formatearTelefono(raw: string): string {
  const digitos = raw.replace(/\D/g, '');
  if (digitos.length < 8) return raw;
  const cc = digitos.length > 9 ? digitos.slice(0, digitos.length - 9) : '51';
  const resto = digitos.slice(cc.length);
  const grupos = resto.match(/.{1,3}/g) ?? [resto];
  return '+' + [cc, ...grupos].join(' ');
}

export function PanelDerecho({ conversacion }: { conversacion: Conversacion }) {
  /**
   * El registro de la venta. Vive acá y no adentro del pie porque el pie es
   * presentación: decide cómo se ve el botón, no qué pasa al tocarlo.
   */
  const [vendiendo, setVendiendo] = useState(false);
  const esWa = conversacion.canal === 'whatsapp';
  const telefono = conversacion.persona_id;

  const ficha = useFicha(telefono, esWa);
  const lead = useLeadForm(telefono, esWa);
  const { data: senales } = useSenales([conversacion.clave]);
  const { data: intereses } = useIntereses(conversacion.clave);

  const padron = marcaDeCliente(conversacion);
  const estado = estadoDelContacto({
    conTelefono: esWa,
    cargando: ficha.isPending && esWa,
    error: ficha.isError,
    ficha: ficha.data,
    enfriada: senales?.senales[conversacion.clave]?.enfriamiento.enfriada ?? false,
    padron: padron?.nivel ?? null,
  });

  const cliente = fichaDeCliente(ficha.data);

  const nombreData = nombreDelContacto({
    pushname: conversacion.persona_nombre,
    leadNombre: lead.data?.lead?.nombre ?? null,
    cerberusNombre: cliente?.nombre ?? null,
  });

  const timeline = ensamblarTimeline({
    ficha: ficha.data,
    intereses: intereses?.lista,
    senales: senales?.senales[conversacion.clave],
    leadForm: lead.data?.lead ? { campana: lead.data.lead.campana ?? undefined, fecha: lead.data.lead.fecha } : undefined,
    conversacion: { persona_nombre: conversacion.persona_nombre ?? undefined, lead_nombre: conversacion.lead_nombre ?? undefined },
  });

  const nombre = nombreData.principal ?? 'Sin nombre';
  const iniciales = nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  const chips: string[] = [];
  if (padron?.nivel === 'vip') {
    chips.push('VIP');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      <EncabezadoTimeline
        iniciales={iniciales}
        nombre={nombre}
        telefono={esWa && telefono ? formatearTelefono(telefono) : ''}
        canal={conversacion.canal}
        acento={estado.acento}
        tituloEstado={estado.titulo}
        compras={estado.compras}
        chips={chips}
        cargandoMeta={esWa && lead.isPending}
        meta={
          lead.data?.lead
            ? {
                origen: lead.data.lead.fuente === 'meta' ? 'Meta Ads' : 'Web',
                campana: lead.data.lead.campana ?? lead.data.lead.anuncio ?? '',
                primerContacto: lead.data.lead.fecha,
                asignadoA: '',
              }
            : null
        }
        resumenIa={null}
      />
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
        <div className="px-4 py-2.5">
          <ZonaPendientes pendientes={timeline.pendientes} progreso={timeline.progreso} />
          <h3 className="text-xs font-semibold text-muted-foreground">Timeline</h3>
          <ol className="mt-1">
            {timeline.grupos.map((grupo) => (
              <li key={grupo.etiqueta}>
                <h4 className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {grupo.etiqueta}
                </h4>
                <ol className="mt-0.5">
                  {grupo.eventos.map((e, i) => (
                    <EventoLinea key={e.id} e={e} esUltimo={i === grupo.eventos.length - 1} />
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {/* ⚠️ EL `onVender` ES LO QUE FALTABA. Sin él, `PieAccionTimeline` no
          dibuja nada —por diseño: nunca un no-op— y el botón de registrar la
          venta era invisible en TODOS los estados, no solo en algunos. */}
      <PieAccionTimeline estado={estado} onVender={() => setVendiendo(true)} />
      {vendiendo && (
        <VentaDesdeElPanel conversacion={conversacion} onCerrar={() => setVendiendo(false)} />
      )}
    </div>
  );
}
