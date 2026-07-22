import { defineConfig } from 'vitest/config'

/**
 * Los tests del FRONT. Aparte de `vite.config.ts` a propósito: acá no hacen falta
 * ni el plugin de React ni el compilador, porque lo que se testea son módulos
 * puros — la política de qué se persiste, cuándo caduca y cómo se rehidrata.
 *
 * Entorno `node`: nada de jsdom. El día que haya que testear un componente,
 * eso pide una decisión aparte (y un runner con DOM), no un ajuste acá.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
