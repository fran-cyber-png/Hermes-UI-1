import { describe, expect, it } from 'vitest';
import { guardarBorrador, leerBorrador, limpiarBorrador } from './borradorComposer';

/**
 * EL BORRADOR DEL COMPOSER (issue #3) — el texto a medio escribir NO puede
 * filtrarse entre conversaciones. Vive en un Map de módulo, afuera del
 * componente, así sobrevive al cambio de `telefono` sin depender del ciclo
 * de vida de React. Solo el TEXTO se persiste acá — el adjunto (File) es
 * intencionalmente efímero (decisión del orquestador, ver PR).
 */
describe('borradorComposer', () => {
  it('un teléfono nunca escrito arranca vacío', () => {
    expect(leerBorrador('51999000001')).toBe('');
  });

  it('guardar y leer el mismo teléfono devuelve lo guardado', () => {
    guardarBorrador('51999000002', 'hola, ¿cómo estás?');
    expect(leerBorrador('51999000002')).toBe('hola, ¿cómo estás?');
  });

  it('el borrador es por teléfono: escribir en A no aparece en B', () => {
    guardarBorrador('51999000003', 'borrador de A');
    expect(leerBorrador('51999000004')).toBe('');
  });

  it('volver a un teléfono con borrador previo lo conserva', () => {
    guardarBorrador('51999000005', 'primero esto');
    guardarBorrador('51999000006', 'después esto otro');
    expect(leerBorrador('51999000005')).toBe('primero esto');
  });

  it('limpiarBorrador deja el teléfono vacío (como tras un envío exitoso)', () => {
    guardarBorrador('51999000007', 'se va a enviar');
    limpiarBorrador('51999000007');
    expect(leerBorrador('51999000007')).toBe('');
  });

  it('guardar texto vacío no deja basura: se lee igual vacío', () => {
    guardarBorrador('51999000008', 'algo');
    guardarBorrador('51999000008', '');
    expect(leerBorrador('51999000008')).toBe('');
  });
});
