import { useEffect, useRef } from 'react';
import { type Capa, figurasDe, ordenarParaPintar } from './capas';
import { cajaDeVarias, type Figura } from './figuras';
import { pintar } from './pintar';

/**
 * LA MINIATURA DE UNA CAPA — un render de verdad de lo que tiene adentro.
 *
 * ══ POR QUÉ SE RE-PINTA Y NO SE ESCALA EL CANVAS GRANDE ═════════════════════
 *
 * Copiar el canvas del documento con `drawImage` sería más barato, y estaría
 * mal: ese canvas tiene TODAS las capas encima y mide lo que mide la página. La
 * miniatura de la capa 3 mostraría también los trazos de la 1 y la 5, y una
 * página de 4.000 px de alto se vería como una franja ilegible.
 *
 * Acá se pinta solo lo de ESA capa, y **encuadrado en su contenido**: se calcula
 * el rectángulo que envuelve sus figuras y se escala para que entre. Una flecha
 * suelta en el pie de una página larga se ve como una flecha, no como un punto.
 *
 * ══ CUÁNDO SE RE-PINTA ══════════════════════════════════════════════════════
 *
 * El `useEffect` depende de las figuras de la capa y de sus tres perillas, así
 * que se rehace cuando cambia lo que se ve y no cuando se mueve el mouse: la
 * capa transparente solo publica figuras nuevas al CERRAR un gesto
 * (`confirmar`), y arrastrar usa `vistaPrevia`, que no llega hasta acá porque
 * el panel se monta con `figuras` ya confirmadas.
 */

/** Las medidas del recuadro, en píxeles de CSS. */
const ANCHO = 52;
const ALTO = 38;

/** El lado de cada cuadro del damero de transparencia. */
const DAMERO = 6;

/** Aire alrededor del contenido, para que no toque el borde del recuadro. */
const MARGEN = 3;

/**
 * EL DAMERO — lo que se ve en una capa vacía.
 *
 * Es el patrón que todo editor gráfico usa para decir «acá no hay nada, y lo que
 * hay detrás se ve». Un recuadro liso se confundiría con una capa que tiene un
 * rectángulo blanco pintado.
 */
function damero(ctx: CanvasRenderingContext2D, ancho: number, alto: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.fillStyle = '#e5e7eb';
  for (let y = 0; y < alto; y += DAMERO) {
    for (let x = 0; x < ancho; x += DAMERO) {
      if (((x / DAMERO) + (y / DAMERO)) % 2 === 0) ctx.fillRect(x, y, DAMERO, DAMERO);
    }
  }
}

export function MiniaturaDeCapa({ capa, figuras }: { capa: Capa; figuras: Figura[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const propias = figurasDe(figuras, capa.id);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(ANCHO * dpr);
    canvas.height = Math.round(ALTO * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ANCHO, ALTO);
    damero(ctx, ANCHO, ALTO);

    const caja = cajaDeVarias(propias);
    if (!caja) return;

    /**
     * EL ENCUADRE. Se escala para que el contenido entre entero y se centra.
     *
     * El `min(…, 1)` es lo que impide AGRANDAR: un solo punto de lápiz escalado
     * hasta llenar el recuadro se vería como una mancha enorme y mentiría sobre
     * lo que hay en la capa. Lo chico se ve chico.
     */
    const anchoContenido = Math.max(1, caja.x2 - caja.x1);
    const altoContenido = Math.max(1, caja.y2 - caja.y1);
    const escala = Math.min((ANCHO - MARGEN * 2) / anchoContenido, (ALTO - MARGEN * 2) / altoContenido, 1);

    ctx.save();
    ctx.translate(
      (ANCHO - anchoContenido * escala) / 2 - caja.x1 * escala,
      (ALTO - altoContenido * escala) / 2 - caja.y1 * escala,
    );
    ctx.scale(escala, escala);

    // Se reusa el pintor del documento: una segunda implementación acá haría que
    // la miniatura y el dibujo se fueran separando figura por figura.
    // `dpr: 1` porque la densidad ya está en la transformación de arriba, y sin
    // adornos: los recuadros de selección no son contenido de la capa.
    pintar(ctx, ordenarParaPintar(propias, [capa]), {
      ancho: ANCHO / escala,
      alto: ALTO / escala,
      dpr: 1,
      conAdornos: false,
      // La miniatura muestra la opacidad de la capa, como pidió el punto 17.
      opacidadDe: (f) => f.opacidad * capa.opacidad,
    });
    ctx.restore();
  }, [propias, capa]);

  return (
    <canvas
      ref={ref}
      style={{ width: ANCHO, height: ALTO }}
      className="shrink-0 rounded border border-border"
      // Es decorativa: lo que la capa contiene ya lo dicen el nombre y el
      // contador de al lado, y describir un dibujo sin verlo sería inventar.
      aria-hidden
      data-miniatura={capa.id}
    />
  );
}
