import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import { MOMENTOS, type MomentoDeVenta } from './hechos';

/**
 * EL CATÁLOGO DE DATOS RECOMENDADOS, del lado de quien lo mantiene.
 *
 * ══ EL NÚMERO QUE JUSTIFICA ESTA PANTALLA ═══════════════════════════════════
 *
 * Medido el 4-ago-2026 en producción: la tabla `hechos` tiene **30 filas (27
 * activas)** con precios por país, dónde pagar en ocho países, cuotas y quién
 * certifica — cargadas y editadas en cuatro días distintos. Y hasta hoy **no
 * existía una sola pantalla para editarla**: la API estaba entera desde #153 y
 * tenía CERO consumidores en el front. El único uso era leer los tres chips que
 * el panel muestra por conversación.
 *
 * La consecuencia, que es el punto: **el bot ve las 27 piezas y la vendedora
 * ve 3.** Con 21 de 27 sin momentos y las 13 frases de plata en `orden = 100`
 * —el default del schema—, las de precio y las de dónde pagar no aparecen nunca.
 *
 * ══ POR QUÉ EL RECORTE VIENE CALCULADO DEL SERVER ═══════════════════════════
 *
 * `vistaPrevia` dice qué claves llegan a verse en cada momento, y la calcula
 * `vistaPreviaPorMomento()` — la MISMA función que recorta en el panel. Acá no
 * se vuelve a implementar: dos cabezas se separan sin que nada falle, y esta
 * pantalla afirmaría «esto se ve» sobre algo que la vendedora no ve (#37).
 */

export interface HechoDelCatalogo {
  clave: string;
  rotulo: string;
  texto: string;
  momentos: MomentoDeVenta[];
  orden: number;
  activo: boolean;
}

export interface RespuestaCatalogo {
  hechos: HechoDelCatalogo[];
  /** `false` = la tabla no está (falta la migración): se ve el catálogo de fábrica y no se puede guardar. */
  editable: boolean;
  origen: 'tabla' | 'defecto' | 'sin-tabla';
  /**
   * Cuántos entran en el panel. Viene del server para no escribir «3» a mano acá.
   * Opcional por lo mismo que `vistaPrevia`: un server viejo no lo manda.
   */
  tope?: number;
  /**
   * Por momento, las claves que LLEGAN a verse. Calculado con la regla del panel.
   *
   * **OPCIONAL A PROPÓSITO**: el front se despliega solo (N4) y el server con un
   * botón (N5), así que existe una ventana real en la que esta pantalla corre
   * contra un server que todavía no manda el campo. Tipado como requerido, la
   * pantalla reventaba en esa ventana. Sin él se degrada y **se dice**: no se
   * afirma «no se ve» sobre nada, porque no se sabe.
   */
  vistaPrevia?: Record<MomentoDeVenta, string[]>;
}

/** Lo que se manda al crear o editar. `clave` es la identidad y no se edita. */
export interface CamposDeHecho {
  rotulo: string;
  texto: string;
  momentos: MomentoDeVenta[];
  orden: number;
}

export const CLAVE_CATALOGO = ['hechos', 'catalogo'] as const;

export function useCatalogoHechos(activo = true) {
  return useQuery({
    queryKey: CLAVE_CATALOGO,
    queryFn: () => api<RespuestaCatalogo>('/api/hechos/catalogo'),
    enabled: activo,
    retry: false,
  });
}

/**
 * Las mutaciones invalidan `['hechos']` ENTERO, no solo el catálogo: el panel
 * de cada conversación cachea sus tres chips bajo `['hechos', <clave>]`, y
 * cambiar el orden o apagar un dato cambia lo que le toca ver. Sin esto, la
 * vendedora edita el catálogo y el panel le sigue mostrando lo de antes.
 */
export function useMutacionesHechos() {
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: ['hechos'] });

  const crear = useMutation({
    mutationFn: (v: CamposDeHecho & { clave: string }) =>
      api<{ ok: true; hecho: HechoDelCatalogo }>('/api/hechos', {
        method: 'POST',
        body: JSON.stringify(v),
      }),
    onSuccess: invalidar,
  });

  const editar = useMutation({
    mutationFn: ({ clave, ...campos }: CamposDeHecho & { clave: string }) =>
      api<{ ok: true; hecho: HechoDelCatalogo }>(`/api/hechos/${encodeURIComponent(clave)}`, {
        method: 'PUT',
        body: JSON.stringify(campos),
      }),
    onSuccess: invalidar,
  });

  /** Apagar, no borrar: la frase que dejó de funcionar sirve de historia (regla del server). */
  const apagar = useMutation({
    mutationFn: (clave: string) =>
      api<{ ok: true }>(`/api/hechos/${encodeURIComponent(clave)}`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });

  /** Volver a prenderlo: es un `PUT` con `activo`, la puerta que faltaba. */
  const prender = useMutation({
    mutationFn: (clave: string) =>
      api<{ ok: true; hecho: HechoDelCatalogo }>(`/api/hechos/${encodeURIComponent(clave)}`, {
        method: 'PUT',
        body: JSON.stringify({ activo: true }),
      }),
    onSuccess: invalidar,
  });

  return { crear, editar, apagar, prender };
}

/**
 * LA CLAVE SE SUGIERE DESDE EL RÓTULO, y después se congela.
 *
 * Es la identidad contra la que se edita (`PUT /api/hechos/:clave`) y contra la
 * que se estampa la procedencia de cada envío (`hecho:<clave>`, ADR 0022):
 * renombrar el rótulo no puede romper el lazo de resultados. Por eso la clave
 * se propone al crear y **no se edita después**.
 *
 * El server exige `^[a-z0-9-]+$`, 2 a 40 (`routes/hechos.ts`). Acá se produce
 * algo que ya cumple, para que nadie choque contra un 400 escribiendo un rótulo
 * con tilde.
 */
export function claveSugerida(rotulo: string): string {
  return rotulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * EN CUÁNTOS MOMENTOS SE LLEGA A VER — el número que la lista muestra al lado
 * de cada dato, y la razón de ser de la pantalla.
 *
 * Se cuenta sobre `vistaPrevia`, o sea sobre el recorte REAL del server. No se
 * deduce de `momentos`: un dato puede valer para los seis y no verse en ninguno
 * porque otros tres le ganan por `orden`. Esa diferencia es justamente la que
 * no se ve mirando la lista.
 */
export function enCuantosMomentosSeVe(
  clave: string,
  vistaPrevia: Record<MomentoDeVenta, string[]> | undefined,
): number | null {
  // `null` y no `0`: sin recorte NO SE SABE, y decir «no se ve» sería afirmar
  // lo más alarmante justo cuando no hay con qué. Pasa de verdad mientras el
  // front nuevo corre contra un server que todavía no se desplegó (N4 vs N5).
  if (!vistaPrevia) return null;
  return MOMENTOS.filter((m) => vistaPrevia[m]?.includes(clave)).length;
}
