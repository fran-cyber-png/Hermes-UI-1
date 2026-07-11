import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../../config';
import type { Intencion, Interaccion, Rango, TipoFiltro } from './types';

interface Filtros {
  canal?: string;
  tipo?: TipoFiltro;
  intencion?: Intencion;
  rango?: Rango;
  porTanda?: number;
}

/**
 * Carga paginada de interacciones. Sirve para la bandeja (todos los canales
 * mezclados) y para la pantalla de un canal (uno solo, separado por tipo).
 *
 * El backend ya devuelve la cola ordenada por urgencia: ventana abierta primero,
 * y dentro de esa la más vieja arriba — es a la que le quedan menos horas.
 *
 * Se trae de a tandas porque hay 15.482 interacciones en Facebook: nadie
 * scrollea quince mil tarjetas, y el total solo se cuenta en la primera página
 * (recontarlo en cada scroll cuesta y no aporta nada).
 */
export function useInteracciones({
  canal = '',
  tipo = '',
  intencion = '',
  rango = 'todo',
  porTanda = 30,
}: Filtros) {
  const [items, setItems] = useState<Interaccion[]>([]);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);

  const traer = useCallback(
    async (offset: number) => {
      const q = new URLSearchParams({ limit: String(porTanda), offset: String(offset), rango });
      if (canal) q.set('canal', canal);
      if (tipo) q.set('tipo', tipo);
      if (intencion) q.set('intencion', intencion);

      const res = await fetch(`${API_URL}/api/interactions?${q}`).then((r) => r.json());
      return res as { interacciones: Interaccion[]; total?: number; hayMas: boolean };
    },
    [canal, tipo, intencion, rango, porTanda],
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
