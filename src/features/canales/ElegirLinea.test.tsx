// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { montar, tocar, teclear } from '../../pruebas/dom';
import { ElegirLinea } from './ElegirLinea';

const LINEAS = [
  { numero: '51984429504', etiqueta: 'Ventas Meta', estado: 'conectado' },
  { numero: '51963139984', etiqueta: 'Betto', estado: 'conectado' },
];

describe('ElegirLinea', () => {
  it('llama a onElegir con la línea tocada', () => {
    const elegir = vi.fn();
    const cerrar = vi.fn();
    const vista = montar(
      <ElegirLinea telefono="51987654321" lineas={LINEAS} onElegir={elegir} onCerrar={cerrar} />,
    );

    const boton = Array.from(vista.contenedor.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Betto'),
    );
    expect(boton).not.toBeNull();
    tocar(boton!);

    expect(elegir).toHaveBeenCalledWith('51963139984');
    expect(cerrar).not.toHaveBeenCalled();
    vista.desmontar();
  });

  it('cierra con Escape', () => {
    const cerrar = vi.fn();
    const vista = montar(
      <ElegirLinea telefono="51987654321" lineas={LINEAS} onElegir={vi.fn()} onCerrar={cerrar} />,
    );

    teclear('Escape');

    expect(cerrar).toHaveBeenCalledTimes(1);
    vista.desmontar();
  });
});
