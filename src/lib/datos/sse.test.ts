import { describe, expect, test } from 'vitest';
import { crearParserSSE } from './sse';

/**
 * El parser existe porque EventSource no puede mandar `Authorization`, y desde
 * el cierre del issue #36 `/api/stream` exige el Bearer como todo /api. El
 * stream se consume con fetch y este parser reconstruye los eventos SSE del
 * server (`routes/stream.ts`): `data: {...}\n\n`, keep-alives `: comentario` y
 * la directiva `retry:`. Si esto se rompe, el tiempo real muere en silencio.
 */

function recolector() {
  const datos: string[] = [];
  const alimentar = crearParserSSE((d) => datos.push(d));
  return { datos, alimentar };
}

describe('crearParserSSE', () => {
  test('un evento completo en un chunk se entrega', () => {
    const { datos, alimentar } = recolector();
    alimentar('data: {"tipo":"estado"}\n\n');
    expect(datos).toEqual(['{"tipo":"estado"}']);
  });

  test('un evento partido en dos chunks se entrega UNA vez, completo', () => {
    const { datos, alimentar } = recolector();
    alimentar('data: {"tipo":"mensaje","tele');
    expect(datos).toEqual([]);
    alimentar('fono":"51999888777"}\n\n');
    expect(datos).toEqual(['{"tipo":"mensaje","telefono":"51999888777"}']);
  });

  test('dos eventos en un chunk salen en orden', () => {
    const { datos, alimentar } = recolector();
    alimentar('data: uno\n\ndata: dos\n\n');
    expect(datos).toEqual(['uno', 'dos']);
  });

  test('los keep-alive (comentarios) y el retry del server no emiten nada', () => {
    const { datos, alimentar } = recolector();
    alimentar('retry: 3000\n\n'); // lo primero que manda routes/stream.ts
    alimentar(': keep-alive\n\n'); // el latido cada 25s
    expect(datos).toEqual([]);
  });

  test('data multilínea se une con salto de línea, como manda la spec', () => {
    const { datos, alimentar } = recolector();
    alimentar('data: primera\ndata: segunda\n\n');
    expect(datos).toEqual(['primera\nsegunda']);
  });

  test('data sin espacio tras los dos puntos también vale', () => {
    const { datos, alimentar } = recolector();
    alimentar('data:pegado\n\n');
    expect(datos).toEqual(['pegado']);
  });

  test('CRLF (proxies que normalizan) funciona igual, aun partido entre chunks', () => {
    const { datos, alimentar } = recolector();
    alimentar('data: con-crlf\r');
    alimentar('\n\r\n');
    expect(datos).toEqual(['con-crlf']);
  });
});
