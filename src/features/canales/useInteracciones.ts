import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../../config';
import type { Intencion, Interaccion } from './types';

/**
 * Carga paginada de un canal.
 *
 * Con 15.482 interacciones en Facebook, traerlas todas de una sería absurdo:
 * nadie scrollea 15.000 tarjetas. Se traen de a 40 y se piden más al llegar al
 * fondo. El total solo se cuenta en la primera página — contar 15.000 filas en
 * cada scroll cuesta y no aporta nada.
 */
export function useInteracciones(canal: string, intencion: Intencion, rango: string) {
  const [items, setItems] = useState<Interaccion[]>([]);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);

  const traer = useCallback(
    async (offset: number) => {
      const q = intencion ? `&intencion=${intencion}` : '';
      const res = await fetch(
        `${API_URL}/api/interactions?canal=${canal}&limit=40&offset=${offset}&rango=${rango}${q}`,
      ).then((r) => r.json());
      return res as { interacciones: Interaccion[]; total?: number; hayMas: boolean };
    },
    [canal, intencion, rango],
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
