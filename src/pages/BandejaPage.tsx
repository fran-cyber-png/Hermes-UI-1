import { useEffect, useState } from 'react';
import { API_URL } from '../config';
import type { CanalesResponse } from '../features/canales/types';
import BandejaHero from '../features/canales/BandejaHero';
import Bandeja from '../features/canales/Bandeja';
import Volver from '../layout/Volver';

/**
 * La bandeja completa: aquí sí se trabaja.
 *
 * En el home solo se asoma (los más urgentes, para enterarte). Acá está todo:
 * los filtros, la cola entera, y el scroll. Una sola cosa en pantalla, porque
 * responderle a gente es una sola cosa.
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
      <Volver a="/" texto="Volver al inicio" />
      <BandejaHero estado={estado} abiertas={abiertas} />
      <Bandeja />
    </div>
  );
}
