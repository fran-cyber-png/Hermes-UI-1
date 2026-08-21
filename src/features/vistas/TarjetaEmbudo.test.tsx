// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arrastrar, montar, reposar, tocar, type Montado } from '../../pruebas/dom';
import type { Conversacion } from '../../dominio/conversaciones';
import { TarjetaEmbudo } from './TarjetaEmbudo';

/**
 * LA TARJETA CLICKEABLE, ADENTRO DE UNA TARJETA ARRASTRABLE.
 *
 * Un test puro no puede ver ninguna de las dos cosas que se rompen acá: que un
 * arrastre termine contando como clic (y cada drop abra una ficha encima del
 * tablero que se estaba ordenando), y que un botón de adentro dispare además la
 * acción de afuera. Las dos son cableado, y el cableado se ve montando.
 */

const BASE: Conversacion = {
  clave: 'conv:whatsapp:51987654321:51986394450',
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: '51987654321',
  persona_nombre: 'Javier Peralta',
  numero_propio: '51986394450',
  texto: 'me interesa el diplomado',
  contexto_texto: null,
  respondida: false,
  ventana_abierta: false,
  pregunto: false,
  n: 3,
  referencia: '2026-08-05T12:00:00.000Z',
  ultimo_at: '2026-08-05T12:00:00.000Z',
  dias: 0,
  nivel: 3,
};

let vista: Montado | null = null;

afterEach(() => {
  vista?.desmontar();
  vista = null;
});

function pintar(props: Partial<Parameters<typeof TarjetaEmbudo>[0]> = {}) {
  const todo = {
    c: BASE,
    indice: 0,
    onAbrir: vi.fn(),
    onFicha: vi.fn(),
    alArrastrar: vi.fn(),
    alTerminar: vi.fn(),
    arrastrando: false,
    rebotada: false,
    ...props,
  };
  vista = montar(<TarjetaEmbudo {...todo} />);
  const tarjeta = vista.contenedor.querySelector('[role="button"]');
  if (!tarjeta) throw new Error('la tarjeta no se dibujó como clickeable');
  return { ...todo, tarjeta, contenedor: vista.contenedor };
}

describe('TarjetaEmbudo — el clic que abre la ficha', () => {
  it('un clic en la tarjeta abre la ficha de esa conversación', () => {
    const { tarjeta, onFicha } = pintar();

    tocar(tarjeta);

    expect(onFicha).toHaveBeenCalledWith(BASE);
  });

  it('🔴 un ARRASTRE no cuenta como clic', async () => {
    // La tarjeta es `draggable` desde #60. Un drag que empieza y termina sobre
    // ella misma —soltar sin moverse, cancelar con Escape— puede terminar
    // disparando `click`: sin la guarda, cada arrastre fallido abre la ficha.
    const { tarjeta, onFicha } = pintar();

    arrastrar(tarjeta);
    tocar(tarjeta);

    expect(onFicha).not.toHaveBeenCalled();
  });

  it('y en el tick siguiente la tarjeta vuelve a ser clickeable', async () => {
    // La guarda se levanta sola: si no, arrastrar una tarjeta la dejaría muda
    // para siempre y nadie relacionaría las dos cosas.
    const { tarjeta, onFicha } = pintar();

    arrastrar(tarjeta);
    await reposar();
    tocar(tarjeta);

    expect(onFicha).toHaveBeenCalledTimes(1);
  });

  it('el botón de Mensajes abre el selector «Escribir en» con los 6 países, y NO abre además la ficha', () => {
    // Sin `stopPropagation`, el clic haría las dos: se abriría el popover Y la
    // ficha de al lado, en una vista que ya está tapada por el cuadrito.
    const { contenedor, onAbrir, onFicha } = pintar();

    const boton = contenedor.querySelector('button[title="Abrir en Mensajes"]');
    expect(boton).not.toBeNull();
    tocar(boton!);

    // El primer clic solo abre el selector — todavía no manda a Mensajes.
    expect(onAbrir).not.toHaveBeenCalled();
    expect(onFicha).not.toHaveBeenCalled();

    // El cuadrito va por PORTAL a `document.body` — escapa del recorte de la
    // columna del Pipeline (`overflow-y-auto`), así que no cuelga de `contenedor`.
    const paises = ['Estados Unidos', 'Perú', 'Ecuador', 'México', 'Brasil', 'Bolivia'];
    const botonesDePais = paises.map((p) => document.body.querySelector(`button[title="${p}"]`));
    expect(botonesDePais.every(Boolean)).toBe(true);

    // Elegir un país recién ahí manda a Mensajes.
    tocar(botonesDePais[2]!); // Ecuador
    expect(onAbrir).toHaveBeenCalledWith(BASE);
    expect(onFicha).not.toHaveBeenCalled();
    // Y el selector se cierra: no queda ningún botón de país en el DOM.
    expect(document.body.querySelector('button[title="Ecuador"]')).toBeNull();
  });

  it('sin `onFicha` la tarjeta no se anuncia como clickeable', () => {
    // El Pipeline es el único que la pasa. Un `role="button"` sin nada detrás le
    // promete al lector de pantalla una acción que no existe.
    const sinFicha = montar(
      <TarjetaEmbudo
        c={BASE}
        indice={0}
        onAbrir={vi.fn()}
        alArrastrar={vi.fn()}
        alTerminar={vi.fn()}
        arrastrando={false}
        rebotada={false}
      />,
    );

    expect(sinFicha.contenedor.querySelector('[role="button"]')).toBeNull();
    sinFicha.desmontar();
  });
});
