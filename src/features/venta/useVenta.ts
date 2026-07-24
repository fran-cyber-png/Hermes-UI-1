import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * Los datos y acciones del formulario de venta. Todo pega contra Hermes, que a su
 * vez habla con Cerberus con la sesión de la vendedora. Ella nunca ve Cerberus.
 */

export interface Opcion {
  id: string;
  nombre: string;
}
export interface FormularioVenta {
  monedas: Opcion[];
  paises: Opcion[];
  medios: Opcion[];
  origenes: Opcion[];
}
export interface ProductoCurso {
  id: string;
  sku: string;
  nombre: string;
  precioNormal: number;
  precioPromocion: number;
  /**
   * Símbolo o código de la moneda del precio («S/», «USD») — `''` cuando
   * Cerberus no la trae (#43): mejor un hueco que una moneda inventada.
   * OJO: el payload vivo hoy viene sin la key (escalado en el issue), así que
   * esto es `''` hasta que Cerberus la exponga. Formatear/mostrar es Fase 1.
   */
  moneda: string;
}

/** Las opciones del formulario (monedas, países, medios, orígenes). */
export function useFormularioVenta(activo: boolean) {
  return useQuery({
    queryKey: ['venta', 'formulario'],
    queryFn: () => api<FormularioVenta>('/api/venta/formulario'),
    enabled: activo,
    staleTime: 10 * 60_000, // las monedas/países no cambian seguido
  });
}

/** Buscador de cursos. */
export function useProductos(q: string, activo: boolean) {
  return useQuery({
    queryKey: ['venta', 'productos', q],
    queryFn: () => api<{ productos: ProductoCurso[] }>(`/api/venta/productos?q=${encodeURIComponent(q)}`),
    enabled: activo,
    staleTime: 60_000,
  });
}

export interface ItemVenta {
  productoId: string;
  nombre?: string;
  cantidad: number;
  precioRegular: number;
  precioVenta: number;
}

export function useCrearVenta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      clienteId: number;
      monedaId: string;
      paisId: string;
      preventa: boolean;
      medio: string;
      origen: string;
      montoTotal: number;
      productos: ItemVenta[];
      saveMode: 'cotizacion' | 'venta';
      telefono?: string | null;
      canal?: string | null;
      clave?: string | null;
      personaNombre?: string | null;
      numeroPropio?: string | null;
    }) => api<{ ok: true; folio?: string; mensaje?: string }>('/api/venta/crear', { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: () => {
      // La ficha (compras) quedó vieja, y la venta movió el embudo: cotización →
      // cotizado, venta → cierre. Todo lo que lo muestra se refresca.
      void qc.invalidateQueries({ queryKey: ['ficha'] });
      void qc.invalidateQueries({ queryKey: ['gestiones'] });
      void qc.invalidateQueries({ queryKey: ['embudo'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
