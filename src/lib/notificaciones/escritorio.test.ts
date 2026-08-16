// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificarEscritorio, pedirPermisoDeNotificacion } from './escritorio';

function instalarNotificationFalso(permiso: NotificationPermission) {
  const requestPermission = vi.fn();
  const instancias: Array<{ titulo: string; opciones: NotificationOptions | undefined }> = [];
  class NotificationFalso {
    static permission = permiso;
    static requestPermission = requestPermission;
    constructor(titulo: string, opciones?: NotificationOptions) {
      instancias.push({ titulo, opciones });
    }
  }
  // @ts-expect-error — stub mínimo para el test, no el Notification real
  window.Notification = NotificationFalso;
  return { requestPermission, instancias };
}

describe('pedirPermisoDeNotificacion', () => {
  afterEach(() => {
    // @ts-expect-error limpiar entre tests
    delete window.Notification;
  });

  it('pide permiso cuando todavía no se preguntó (default)', () => {
    const { requestPermission } = instalarNotificationFalso('default');
    pedirPermisoDeNotificacion();
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('no vuelve a preguntar si ya está concedido', () => {
    const { requestPermission } = instalarNotificationFalso('granted');
    pedirPermisoDeNotificacion();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('no vuelve a preguntar si ya lo denegaron', () => {
    const { requestPermission } = instalarNotificationFalso('denied');
    pedirPermisoDeNotificacion();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('notificarEscritorio', () => {
  afterEach(() => {
    // @ts-expect-error limpiar entre tests
    delete window.Notification;
    vi.restoreAllMocks();
  });

  it('con la pestaña VISIBLE no avisa — ya se ve solo en la cola', () => {
    const { instancias } = instalarNotificationFalso('granted');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    notificarEscritorio('Hermes', 'Nuevo mensaje de +51 984 429 504');
    expect(instancias).toHaveLength(0);
  });

  it('con la pestaña OCULTA y permiso concedido, avisa con el título y el cuerpo', () => {
    const { instancias } = instalarNotificationFalso('granted');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    notificarEscritorio('Hermes', 'Nuevo mensaje de +51 984 429 504');
    expect(instancias).toHaveLength(1);
    expect(instancias[0].titulo).toBe('Hermes');
    expect(instancias[0].opciones?.body).toBe('Nuevo mensaje de +51 984 429 504');
  });

  it('el aviso es silent — no duplica el sonido del SO sobre la campanita propia', () => {
    const { instancias } = instalarNotificationFalso('granted');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    notificarEscritorio('Hermes', 'hola');
    expect(instancias[0].opciones?.silent).toBe(true);
  });

  it('con la pestaña OCULTA pero SIN permiso concedido, no avisa', () => {
    const { instancias } = instalarNotificationFalso('default');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    notificarEscritorio('Hermes', 'hola');
    expect(instancias).toHaveLength(0);
  });
});
