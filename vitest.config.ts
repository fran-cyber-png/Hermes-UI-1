import { defineConfig } from 'vitest/config'

/**
 * Los tests del FRONT. Aparte de `vite.config.ts` a propósito: acá no hacen falta
 * ni el plugin de React ni el compilador, porque la enorme mayoría de lo que se
 * testea son módulos puros — la política de qué se persiste, cuándo caduca y cómo
 * se rehidrata.
 *
 * ── Por qué ahora también hay `.tsx` ──
 * El entorno por defecto sigue siendo `node`, sin DOM, y para los módulos puros
 * está bien. Pero dejaba un agujero con forma exacta: **una regresión de teclado
 * no la podía ver ningún test**. `escapeDePopover.ts` está testeado hasta el hueso
 * y la app perdió igual el Escape global, porque el defecto no estaba en la
 * decisión sino en el CABLEADO — un hook que registra en `window` desde un
 * componente que está montado cerrado. Eso solo se ve montando.
 *
 * Los tests de componente declaran su entorno en la PRIMERA LÍNEA del archivo:
 *
 *     // @vitest-environment jsdom
 *
 * Por archivo y no acá: meter los ~40 tests puros adentro de jsdom los haría más
 * lentos sin ganar nada, y el docblock deja el costo escrito donde se paga. El
 * andamio para montar (raíz de React, `QueryClientProvider`, un `keydown` que
 * viaja de verdad) vive en `src/pruebas/dom.tsx`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /**
     * `index.css` SE PUEDE LEER; el resto del CSS sigue apagado.
     *
     * Vitest sirve todo `.css` como cadena VACÍA por default, y eso incluye a
     * `?raw`. `seleccionVisible.test.ts` —que mide el contraste del resalte de
     * selección contra el fondo de las burbujas del hilo— leía `''` y pasaba por
     * vacío: el falso verde de siempre. Con esto esa lectura devuelve la fuente.
     *
     * Es un regex y no `true` a propósito: prender el CSS entero haría que
     * cualquier test que monte algo con estilos pague PostCSS + Tailwind para no
     * mirar ni un píxel (jsdom no hace layout). Y NO lleva `$`, porque el id que
     * se compara viene con la query pegada (`index.css?raw`).
     */
    css: { include: [/index\.css/] },
  },
  // Lo inyecta `vite.config.ts` en los builds de verdad; acá alcanza un valor
  // fijo. Sin esto, importar `persistencia.ts` reventaría por el global ausente.
  define: {
    __ID_DEL_BUILD__: JSON.stringify('test'),
  },
})
