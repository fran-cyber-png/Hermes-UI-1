import { describe, expect, it, vi } from 'vitest';
import { ejecutarEnvioComposer, guardarBorrador, leerBorrador, limpiarBorrador } from './borradorComposer';

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

/**
 * EJECUTAR ENVÍO — la carrera detectada en la review de PR #84: `onEnviar`
 * hacía `await mutateAsync(...); setTexto('')` con el `telefono` del closure
 * viejo. Si la vendedora cambiaba de conversación MIENTRAS el envío volaba,
 * el `setTexto('')` de la promesa que recién resolvía pisaba el composer
 * VISIBLE de la conversación nueva (no la que se mandó).
 *
 * Esta función separa las dos cosas que pasan al enviar: el borrador
 * GUARDADO del teléfono que se envió se limpia siempre (ya se mandó, no
 * depende de qué se esté mirando); el composer VISIBLE (los callbacks
 * `limpiar*Visible`) solo se toca si la conversación que se ve ahora
 * (`telefonoVisibleAhora()`, leído recién AL RESOLVER, no antes) sigue
 * siendo la del envío. `mutateAsync` llega mockeado — nada de esto pega a la
 * red ni monta React.
 */
describe('ejecutarEnvioComposer', () => {
  it('camino de texto: manda, limpia el Map del teléfono del envío, y limpia el composer visible si seguís ahí', async () => {
    guardarBorrador('51999000010', 'chau');
    const enviarTexto = vi.fn().mockResolvedValue({ ok: true });
    const enviarConAdjunto = vi.fn();
    const limpiarTextoVisible = vi.fn();
    const limpiarAdjuntoVisible = vi.fn();

    await ejecutarEnvioComposer({
      telefonoDelEnvio: '51999000010',
      texto: '  chau  ',
      adjunto: null,
      enviarTexto,
      enviarConAdjunto,
      telefonoVisibleAhora: () => '51999000010', // seguís viendo esa conversación
      limpiarTextoVisible,
      limpiarAdjuntoVisible,
    });

    expect(enviarTexto).toHaveBeenCalledWith('chau'); // trim antes de mandar
    expect(enviarConAdjunto).not.toHaveBeenCalled();
    expect(leerBorrador('51999000010')).toBe(''); // el Map se limpió
    expect(limpiarTextoVisible).toHaveBeenCalledTimes(1);
  });

  it('si cambiaste de conversación mientras el envío volaba, limpia el Map pero NO toca el composer visible', async () => {
    guardarBorrador('51999000011', 'para A');
    const enviarTexto = vi.fn().mockResolvedValue({ ok: true });
    const limpiarTextoVisible = vi.fn();

    await ejecutarEnvioComposer({
      telefonoDelEnvio: '51999000011', // se mandó para A
      texto: 'para A',
      adjunto: null,
      enviarTexto,
      enviarConAdjunto: vi.fn(),
      telefonoVisibleAhora: () => '51999000012', // pero ahora se ve B
      limpiarTextoVisible,
      limpiarAdjuntoVisible: vi.fn(),
    });

    expect(leerBorrador('51999000011')).toBe(''); // el borrador de A sí se limpia: ya se mandó
    expect(limpiarTextoVisible).not.toHaveBeenCalled(); // pero el composer de B queda intacto
  });

  it('con adjunto: el texto viaja como caption, y limpia texto Y adjunto visibles si seguís ahí', async () => {
    const archivo = new File(['contenido'], 'foto.jpg', { type: 'image/jpeg' });
    const enviarConAdjunto = vi.fn().mockResolvedValue({ ok: true });
    const limpiarTextoVisible = vi.fn();
    const limpiarAdjuntoVisible = vi.fn();

    await ejecutarEnvioComposer({
      telefonoDelEnvio: '51999000013',
      texto: '  mirá esto  ',
      adjunto: archivo,
      enviarTexto: vi.fn(),
      enviarConAdjunto,
      telefonoVisibleAhora: () => '51999000013',
      limpiarTextoVisible,
      limpiarAdjuntoVisible,
    });

    expect(enviarConAdjunto).toHaveBeenCalledWith(archivo, 'mirá esto'); // caption trimmeada
    expect(limpiarTextoVisible).toHaveBeenCalledTimes(1);
    expect(limpiarAdjuntoVisible).toHaveBeenCalledTimes(1);
  });

  it('con adjunto pero cambiaste de conversación: limpia el Map, no toca ni texto ni adjunto visibles', async () => {
    guardarBorrador('51999000014', 'leyenda');
    const archivo = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const limpiarTextoVisible = vi.fn();
    const limpiarAdjuntoVisible = vi.fn();

    await ejecutarEnvioComposer({
      telefonoDelEnvio: '51999000014',
      texto: 'leyenda',
      adjunto: archivo,
      enviarTexto: vi.fn(),
      enviarConAdjunto: vi.fn().mockResolvedValue({ ok: true }),
      telefonoVisibleAhora: () => '51999000099', // ya se fue a otra conversación
      limpiarTextoVisible,
      limpiarAdjuntoVisible,
    });

    expect(leerBorrador('51999000014')).toBe('');
    expect(limpiarTextoVisible).not.toHaveBeenCalled();
    expect(limpiarAdjuntoVisible).not.toHaveBeenCalled();
  });

  it('sin texto y sin adjunto no manda nada', async () => {
    const enviarTexto = vi.fn();
    const enviarConAdjunto = vi.fn();

    await ejecutarEnvioComposer({
      telefonoDelEnvio: '51999000015',
      texto: '   ',
      adjunto: null,
      enviarTexto,
      enviarConAdjunto,
      telefonoVisibleAhora: () => '51999000015',
      limpiarTextoVisible: vi.fn(),
      limpiarAdjuntoVisible: vi.fn(),
    });

    expect(enviarTexto).not.toHaveBeenCalled();
    expect(enviarConAdjunto).not.toHaveBeenCalled();
  });
});
