import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileText } from 'lucide-react';
import { API_URL } from '../config';
import { useLocalStorage } from '../lib/useLocalStorage';
import type { CanalesResponse, Rango } from '../features/canales/types';
import EstadoHero from '../features/canales/EstadoHero';
import FlujoChart from '../features/canales/FlujoChart';
import CanalesBoard from '../features/canales/CanalesBoard';
import type { CostoResponse } from '../features/leads/costoTypes';
import CostoPorLeadCard from '../features/leads/CostoPorLeadCard';
import DecisionesPendientesCard from '../features/decisions/DecisionesPendientesCard';

/**
 * Una sola pantalla, una sola historia, de arriba hacia abajo:
 *
 *   1. Cuánta gente está esperando que la contactes, en el rango que elijas.
 *   2. Cuándo entró y por dónde — si un canal se apagó, se ve acá.
 *   3. Los canales: quiénes son, uno por uno, y qué se puede hacer con cada uno.
 *   4. La plata: lo que costó traerlos. Es lo que le da peso a todo lo de arriba.
 *
 * Antes esto vivía partido en dos pantallas que se contradecían entre sí. El
 * rango de fechas es de la página, no de un componente: si el hero, el gráfico
 * y las columnas no miran el mismo período, vuelven a mentir cada uno por su lado.
 */
export default function DashboardPage() {
  const [rango, setRango] = useLocalStorage<Rango>('meta-escuela.rango', 'todo');
  const [estado, setEstado] = useState<CanalesResponse | null>(null);
  const [costo, setCosto] = useState<CostoResponse | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`${API_URL}/api/interactions/canales?rango=${rango}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelado) setEstado(d);
      });
    return () => {
      cancelado = true;
    };
  }, [rango]);

  // La plata no depende del rango: viene de los insights históricos de Meta, que
  // son de toda la vida de cada anuncio. Se carga una sola vez, y se dice.
  useEffect(() => {
    fetch(`${API_URL}/api/leads/costo`)
      .then((r) => r.json())
      .then((d) => setCosto(d.totales ? d : null))
      .catch(() => setCosto(null));
  }, []);

  const formularios = estado?.formularios;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
      <EstadoHero estado={estado} rango={rango} onRango={setRango} />

      <FlujoChart porDia={estado?.porDia ?? []} rango={rango} />

      {/* Los formularios son una fila, no una cuarta columna: traen dato
          estructurado (nombre, teléfono, correo), no texto suelto. Son otra
          clase de entrada, y se atienden en otra pantalla. */}
      {formularios && formularios.total > 0 && (
        <Link
          to="/leads"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card px-6 py-4 shadow-sm transition-colors hover:border-primary"
        >
          <FileText size={18} className="shrink-0 text-navy" />
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            <span className="font-heading text-lg font-extrabold tabular-nums text-foreground">
              {formularios.total.toLocaleString('es')}
            </span>{' '}
            <span className="font-semibold text-foreground">formularios</span> — de los cuales{' '}
            {formularios.sin_atender.toLocaleString('es')} sin contactar. Traen nombre, teléfono y
            correo: son los más fáciles de atender.
          </p>
          <ArrowRight size={16} className="shrink-0 text-primary" />
        </Link>
      )}

      <CanalesBoard estado={estado} rango={rango} />

      {/* La plata cierra la historia: sin esto, "hay gente esperando" es una
          cifra suelta. Con esto, es lo que ya pagaste por traerla. */}
      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <div>
          <h2 className="font-heading text-sm font-bold text-navy">Lo que costó traerlos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            De toda la vida de cada anuncio, según Meta. No sigue el filtro de fechas de arriba.
          </p>
        </div>

        <DecisionesPendientesCard />
        {costo && <CostoPorLeadCard porAnuncio={costo.porAnuncio} />}
      </section>
    </div>
  );
}
