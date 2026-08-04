// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import { api } from '../../lib/datos/cliente';

/**
 * ¿UNA MUTACIÓN DISPARADA EN EL DESMONTAJE LLEGA A LA RED?
 *
 * De esto depende la única garantía nueva de la Libreta: al salir de la vista,
 * **lo que estaba por guardarse se guarda**. El autoguardado espera 800 ms, y
 * como vista del riel se sale con ⌘1..⌘8 o con un clic en cualquier ícono — o
 * sea, muy fácil de hacer dentro de esa ventana. Antes de esto, el cleanup solo
 * limpiaba el temporizador y lo escrito se perdía en silencio.
 *
 * El test no mira la Libreta: mira **el supuesto de la librería** en el que se
 * apoya —que TanStack Query no cancela la `mutationFn` cuando el observador se
 * va—. Es lo único acá que no está bajo nuestro control y lo único que, si
 * cambiara en una actualización, convertiría una garantía escrita en un
 * comentario mentiroso sin que se caiga ningún otro test.
 *
 * Si esto se pone rojo: la Libreta necesita otra forma de adelantar el guardado
 * (llamar `api()` derecho desde el cleanup, sin pasar por la mutación).
 */

let montado: Montado | null = null;

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

/** Un componente con la MISMA forma que el autoguardado: espera, y adelanta al salir. */
function ComoLaLibreta({ espera }: { espera: number }) {
  const guardar = useMutation({
    mutationFn: (texto: string) =>
      api<{ ok: true }>('/api/notas/1', { method: 'PATCH', body: JSON.stringify({ texto }) }),
  });
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendiente = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const hacerlo = async () => {
      pendiente.current = null;
      await guardar.mutateAsync('lo que alcanzó a escribir');
    };
    pendiente.current = hacerlo;
    temporizador.current = setTimeout(hacerlo, espera);

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      void pendiente.current?.();
    };
    // Se arma una sola vez: imita el `alCambiar` que quedó pendiente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <p>escribiendo…</p>;
}

function fetchEspia() {
  const espia = vi.fn(
    async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', espia);
  return espia;
}

it('salir ANTES de que venza la espera igual manda lo escrito', async () => {
  const espia = fetchEspia();
  // Espera larguísima: si algo sale, salió por el desmontaje y no por el reloj.
  montado = montar(<ComoLaLibreta espera={60_000} />);
  await reposar();
  expect(espia).not.toHaveBeenCalled();

  montado.desmontar();
  montado = null;
  await reposar();

  expect(espia).toHaveBeenCalledTimes(1);
  const [url, init] = espia.mock.calls[0] as unknown as [string, RequestInit];
  expect(String(url)).toContain('/api/notas/1');
  expect(String(init.body)).toContain('lo que alcanzó a escribir');
});

it('y no manda DOS veces cuando la espera ya había vencido', async () => {
  const espia = fetchEspia();
  montado = montar(<ComoLaLibreta espera={0} />);
  await reposar();
  expect(espia).toHaveBeenCalledTimes(1);

  montado.desmontar();
  montado = null;
  await reposar();

  expect(espia).toHaveBeenCalledTimes(1);
});
