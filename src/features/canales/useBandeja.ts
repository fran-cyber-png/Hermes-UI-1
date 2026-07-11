import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../../config';
import type { Intencion, Interaccion } from './types';

/**
 * La bandeja: una sola cola, todos los canales juntos.
 *
 * Antes se pedía un canal por columna. Pero nadie trabaja "por canal" — se
 * trabaja por persona, y a la persona que se te está por vencer no te importa
 * si te escribió por Facebook o por Instagram. El canal pasó a ser una insignia.
 *
 * El backend ya devuelve la cola ordenada por urgencia (ventana abierta primero,
 * y dentro de esa, la más vieja arriba: es a la que le quedan menos horas).
 */
export function useBandeja(intencion: Intencion) {
  const [items, setItems] = useState<Interaccion[]>([]);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);

  const traer = useCallback(
    async (offset: number) => {
      const q = intencion ? `&intencion=${intencion}` : '';
      const res = await fetch(
        `${API_URL}/api/interactions?limit=30&offset=${offset}&rango=todo${q}`,
      ).then((r) => r.json());
      return res as { interacciones: Interaccion[]; total?: number; hayMas: boolean };
    },
    [intencion],
  );

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    traer(0).then((d) => {
      if (cancelado) return;
      setItems(d.interacciones);
      setTotal(d.total ?? 0);
      setHayMas(d.hayMas);
      setCargando(false);
    });
    return () => {
      cancelado = true;
    };
  }, [traer]);

  const cargarMas = useCallback(async () => {
    if (cargandoMas || !hayMas) return;
    setCargandoMas(true);
    const d = await traer(items.length);
    setItems((prev) => [...prev, ...d.interacciones]);
    setHayMas(d.hayMas);
    setCargandoMas(false);
  }, [cargandoMas, hayMas, items.length, traer]);

  return { items, total, hayMas, cargando, cargandoMas, cargarMas };
}
