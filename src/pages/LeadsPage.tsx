import { useEffect, useState } from 'react';
import { fetchLeadStats } from '../features/leads/api';
import type { LeadStats } from '../features/leads/types';
import LeadsInbox from '../features/leads/LeadsInbox';
import LlegadaChart from '../features/leads/LlegadaChart';
import DesgloseBars from '../features/leads/DesgloseBars';

const PAIS_NOMBRE: Record<string, string> = {
  MX: 'México', GT: 'Guatemala', CL: 'Chile', PE: 'Perú', EC: 'Ecuador',
  BO: 'Bolivia', DO: 'Rep. Dominicana', US: 'Estados Unidos', CO: 'Colombia',
  AR: 'Argentina', ES: 'España', HN: 'Honduras', PA: 'Panamá', SV: 'El Salvador',
};

/**
 * Los formularios, a fondo. La home dice cuántos son; aquí se ve quiénes son.
 *
 * El "quiénes son" y el "de dónde son" vivían en el Pulso, donde competían con
 * los canales por atención. Aquí tienen contexto: son el perfil de la gente que
 * dejó sus datos, y esta es la pantalla de esa gente.
 */
export default function LeadsPage() {
  const [stats, setStats] = useState<LeadStats | null>(null);

  useEffect(() => {
    fetchLeadStats().then(setStats);
  }, []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="font-heading mb-1 text-2xl font-bold text-navy">Formularios</h1>
        <p className="text-sm text-muted-foreground">
          Cada persona que dejó sus datos. La banda de color muestra hace cuánto está esperando.
        </p>
      </div>

      <LeadsInbox />

      {stats && (
        <>
          <LlegadaChart porDia={stats.porDia} />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <DesgloseBars
              titulo="Quiénes son"
              filas={stats.porPerfil.map((p) => ({ etiqueta: p.perfil, valor: p.leads }))}
              formatoEtiqueta={(s) => s.replace(/_/g, ' ')}
            />
            <DesgloseBars
              titulo="De dónde son"
              filas={stats.porPais.map((p) => ({ etiqueta: p.pais, valor: p.leads }))}
              formatoEtiqueta={(s) => PAIS_NOMBRE[s] ?? s}
            />
          </div>
        </>
      )}
    </div>
  );
}
