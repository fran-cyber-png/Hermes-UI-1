import { useEffect, useState } from 'react';
import { API_URL } from '../config';
import type { CanalesResponse } from '../features/canales/types';
import BandejaHero from '../features/canales/BandejaHero';
import Bandeja from '../features/canales/Bandeja';

/**
 * La pantalla principal es para ACTUAR. Nada más.
 *
 * El gráfico de flujo y el costo por lead se fueron a Análisis. No porque no
 * importen, sino porque competían: mientras decides a quién responder, un
 * gráfico de dos años de barras no te ayuda, te distrae.
 *
 * Acá solo hay dos cosas: a cuántos les puedes escribir hoy, y quiénes son.
 */
export default function BandejaPage() {
  const [estado, setEstado] = useState<CanalesResponse | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/interactions/canales?rango=todo`)
      .then((r) => r.json())
      .then(setEstado)
      .catch(() => setEstado(null));
  }, []);

  const abiertas = (estado?.interacciones ?? []).reduce((s, c) => s + c.ventana_abierta, 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <BandejaHero estado={estado} abiertas={abiertas} />
      <Bandeja />
    </div>
  );
}
