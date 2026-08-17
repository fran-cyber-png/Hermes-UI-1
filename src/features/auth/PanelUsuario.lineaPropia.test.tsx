// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { montar, type Montado } from '../../pruebas/dom';
import { ContenidoUsuario } from './PanelUsuario';
import type { Vendedora } from './sesion';

/**
 * 🔴 «VINCULAR TU WHATSAPP» LO DECIDE NO TENER LÍNEA **PROPIA**, NO NO TENER
 * NINGUNA — y la diferencia era todo el equipo de ventas.
 *
 * ── Qué pasaba, medido en producción el 17-ago-2026 ──
 *
 * La condición era `mias.length === 0`. Pero `51984429504` («Ventas Meta», la
 * Cloud API que trae TODOS los leads) tiene **siete** personas asignadas: Luz,
 * Sindy y las cinco `ventas1X@`. Para las siete `mias.length` era 1, así que el
 * botón **no se dibujaba** — el frente de auto-vinculación era inalcanzable
 * justo para quienes se construyó.
 *
 * Y era MUDO: no había un rechazo que leer, ni un error, ni un log. Simplemente
 * no aparecía nada. Por eso el candado está acá, en el DOM: ningún test puro lo
 * podía ver, porque lo que estaba mal era la condición de dibujo (ADR 0024).
 *
 * ⚠️ **Esta regla es gemela de la del server** (`numeros/autoVinculacion.ts`:
 * sólo las líneas con `duenas === 1` ocupan el cupo). Si divergen, el botón
 * aparece y el POST contesta 409 `ya_tiene_linea` — una pantalla que ofrece algo
 * que el server rechaza es peor que no ofrecerlo.
 */

const LUZ: Vendedora = { id: 'luz', nombre: 'Luz' };
const LINEA_DEL_EQUIPO = { numero: '51984429504', etiqueta: 'Ventas Meta', compartida: true };
const LINEA_PROPIA = { numero: '51987654321', etiqueta: 'luz', compartida: false };

function panel(mias: { numero: string; etiqueta: string; compartida?: boolean }[], tienePropia: boolean) {
  return (
    <ContenidoUsuario
      vendedora={LUZ}
      cerberusVivo
      mias={mias}
      tienePropia={tienePropia}
      onSalir={() => {}}
      onVincular={() => {}}
    />
  );
}

const boton = (m: Montado) =>
  [...m.contenedor.querySelectorAll('button')].find((b) => /vincular tu whatsapp/i.test(b.textContent ?? ''));

describe('PanelUsuario · a quién se le ofrece traer su línea', () => {
  let m: Montado | null = null;
  afterEach(() => m?.desmontar());

  it('🔴 con SOLO la línea del equipo, el botón SÍ aparece', () => {
    // El caso de las siete de `51984429504`. Antes de este arreglo, no salía.
    m = montar(panel([LINEA_DEL_EQUIPO], false));
    expect(boton(m)).toBeTruthy();
  });

  it('con una línea PROPIA, el botón NO aparece', () => {
    m = montar(panel([LINEA_PROPIA], true));
    expect(boton(m)).toBeFalsy();
  });

  it('con las dos —la del equipo y la suya—, tampoco: ya tiene la suya', () => {
    m = montar(panel([LINEA_DEL_EQUIPO, LINEA_PROPIA], true));
    expect(boton(m)).toBeFalsy();
  });

  it('sin ninguna línea, aparece — el caso de siempre, que no se rompió', () => {
    m = montar(panel([], false));
    expect(boton(m)).toBeTruthy();
  });

  it('⚠️ un server viejo no manda `tienePropia`: se ofrece igual, no se esconde', () => {
    // Fail-open del lado correcto: ofrecerle vincular a quien ya tiene línea
    // termina en un 409 que se lee; esconderlo a quien no tiene la deja sin
    // ninguna forma de traerla, que es el defecto que esto arregla.
    m = montar(
      <ContenidoUsuario
        vendedora={LUZ}
        cerberusVivo
        mias={[LINEA_DEL_EQUIPO]}
        onSalir={() => {}}
        onVincular={() => {}}
      />,
    );
    expect(boton(m)).toBeTruthy();
  });

  it('la línea del equipo se rotula como tal — es lo que explica el botón', () => {
    m = montar(panel([LINEA_DEL_EQUIPO], false));
    expect(m.contenedor.textContent).toContain('del equipo');
  });
});
