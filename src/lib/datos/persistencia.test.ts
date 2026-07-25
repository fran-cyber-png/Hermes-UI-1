import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClientSave, type PersistedClient } from '@tanstack/react-query-persist-client';
import {
  CADUCIDAD_MS,
  agrupandoEscrituras,
  arrancarCache,
  crearPersistidor,
  debePersistir,
  olvidarCache,
  opcionesDePersistencia,
  selloDeViejo,
  type AlmacenAsync,
} from './persistencia';

/**
 * El almacén de mentira: la misma interfaz que IndexedDB, en memoria.
 *
 * Es lo que permite testear la política sin un navegador — la costura está
 * puesta justo ahí: `crearPersistidor` no sabe dónde se guarda, solo cómo.
 */
function almacenFalso(): AlmacenAsync & {
  contenido: () => PersistedClient | undefined;
  envejecer: (ms: number) => void;
} {
  let dato: PersistedClient | undefined;
  return {
    leer: async () => dato,
    escribir: async (c: PersistedClient) => {
      dato = c;
    },
    borrar: async () => {
      dato = undefined;
    },
    contenido: () => dato,
    /** Retrasa el sello de tiempo de lo guardado, para probar la caducidad sin tocar el reloj. */
    envejecer: (ms: number) => {
      if (dato) dato = { ...dato, timestamp: dato.timestamp - ms };
    },
  };
}

describe('debePersistir — qué sobrevive al cierre de la app', () => {
  it('el radar y la cola sí: son las dos pantallas que la vendedora abre primero', () => {
    expect(debePersistir(['dashboard'], 'success')).toBe(true);
    expect(debePersistir(['conversaciones', { intencion: '', canal: '' }], 'success')).toBe(true);
  });

  it('el panel del negocio también, con sus filtros en la clave (#128)', () => {
    // Está adentro POR DECISIÓN, no porque la clave empiece con «dashboard» de
    // casualidad: el panel escanea la historia entera y abrirlo contra un
    // spinner es lo que ADR 0007 vino a evitar. Cada combinación de filtros
    // guarda la suya, y ninguna puede mentir sobre cuándo es — la pantalla
    // imprime su rango de fechas.
    expect(debePersistir(['dashboard', 'negocio', '7d', null, 'curso'], 'success')).toBe(true);
    expect(debePersistir(['dashboard', 'negocio', '30d', '51986394450', 'anuncio'], 'success')).toBe(true);
  });

  it('lo que ya es en vivo por SSE no: guardarlo sería mostrar un estado que quizá ya no existe', () => {
    expect(debePersistir(['wa', 'sesion'], 'success')).toBe(false);
    expect(debePersistir(['wa', 'conversacion', '51986394450'], 'success')).toBe(false);
  });

  it('la frescura tampoco: un dato viejo que dice "los datos están frescos" miente dos veces', () => {
    expect(debePersistir(['frescura'], 'success')).toBe(false);
  });

  it('es una lista blanca: lo que no está listado no se guarda', () => {
    // Es la garantía de que ninguna credencial toca el disco — no hay que auditar
    // consulta por consulta, alcanza con que la lista sea corta y explícita.
    expect(debePersistir(['ficha', '51986394450'], 'success')).toBe(false);
    expect(debePersistir(['venta', 'formulario'], 'success')).toBe(false);
    expect(debePersistir(['loQueSeInventenMañana'], 'success')).toBe(false);
    expect(debePersistir([], 'success')).toBe(false);
  });

  it('solo guarda lo que salió bien: un error o una carga a medias no son "el último estado conocido"', () => {
    expect(debePersistir(['dashboard'], 'error')).toBe(false);
    expect(debePersistir(['dashboard'], 'pending')).toBe(false);
  });
});

describe('selloDeViejo — decirle a la vendedora de cuándo es lo que mira', () => {
  const ahora = Date.UTC(2026, 6, 22, 9, 0, 0);
  const horas = (n: number) => ahora - n * 3_600_000;

  it('lo recién traído no se marca: el sello solo aparece cuando tiene algo que decir', () => {
    expect(selloDeViejo(ahora, ahora)).toBeNull();
    expect(selloDeViejo(horas(0.005), ahora)).toBeNull(); // 18 s
  });

  it('marca lo de la noche anterior, que es el caso que existe', () => {
    expect(selloDeViejo(horas(14), ahora)).toBe('hace 14 horas');
  });

  it('habla en minutos, horas o días según corresponda — una sola voz', () => {
    expect(selloDeViejo(horas(0.0833), ahora)).toBe('hace 5 min');
    expect(selloDeViejo(horas(48), ahora)).toBe('hace 2 días');
  });

  it('sin dato traído no hay sello: nunca se pintó nada que marcar', () => {
    expect(selloDeViejo(0, ahora)).toBeNull();
    expect(selloDeViejo(undefined, ahora)).toBeNull();
  });
});

describe('el caché que sobrevive al cierre de la app', () => {
  it('con algo persistido, la primera pintura ya tiene datos — no hay estado de carga', async () => {
    const almacen = almacenFalso();
    const persistidor = crearPersistidor(almacen);

    // Ayer: la vendedora tenía el radar cargado y cerró la app.
    const ayer = new QueryClient();
    ayer.setQueryData(['dashboard'], { chats: [{ clave: 'conv:whatsapp:1:51986394450' }] });
    await persistQueryClientSave(opcionesDePersistencia(ayer, persistidor));

    // Hoy: abre de nuevo. Proceso nuevo, QueryClient nuevo, cero memoria.
    const hoy = new QueryClient();
    const dejarDeGuardar = await arrancarCache(hoy, persistidor);

    // `pending` es lo que las vistas leen para pintar el skeleton. Que sea
    // `success` ANTES del primer render es, literalmente, "sin spinner".
    expect(hoy.getQueryState(['dashboard'])?.status).toBe('success');
    expect(hoy.getQueryData(['dashboard'])).toEqual({ chats: [{ clave: 'conv:whatsapp:1:51986394450' }] });

    dejarDeGuardar();
  });

  it('lo persistido caduca: pasado el plazo se descarta en vez de mostrarse', async () => {
    const almacen = almacenFalso();
    const persistidor = crearPersistidor(almacen);

    const ayer = new QueryClient();
    ayer.setQueryData(['dashboard'], { chats: [] });
    await persistQueryClientSave(opcionesDePersistencia(ayer, persistidor));
    almacen.envejecer(CADUCIDAD_MS + 1);

    const hoy = new QueryClient();
    const dejarDeGuardar = await arrancarCache(hoy, persistidor);

    expect(hoy.getQueryData(['dashboard'])).toBeUndefined();
    dejarDeGuardar();
  });

  it('guarda el radar y la cola, y nada más', async () => {
    const almacen = almacenFalso();
    const persistidor = crearPersistidor(almacen);

    const qc = new QueryClient();
    qc.setQueryData(['dashboard'], { chats: [] });
    qc.setQueryData(['conversaciones', { intencion: '', canal: '', porTanda: 30 }], { pages: [] });
    qc.setQueryData(['wa', 'sesion'], { estado: 'conectado' });
    qc.setQueryData(['ficha', '51986394450'], { nombre: 'Ana' });
    await persistQueryClientSave(opcionesDePersistencia(qc, persistidor));

    const raices = almacen.contenido()!.clientState.queries.map((q) => q.queryKey[0]);
    expect([...raices].sort()).toEqual(['conversaciones', 'dashboard']);
  });

  it('cerrar sesión lo limpia: lo de una vendedora no lo hereda la siguiente', async () => {
    const almacen = almacenFalso();
    const persistidor = crearPersistidor(almacen);

    const suyo = new QueryClient();
    suyo.setQueryData(['dashboard'], { chats: [{ clave: 'conv:whatsapp:1:51986394450' }] });
    await persistQueryClientSave(opcionesDePersistencia(suyo, persistidor));

    await olvidarCache(suyo, persistidor);

    expect(suyo.getQueryData(['dashboard'])).toBeUndefined();
    const siguiente = new QueryClient();
    const dejarDeGuardar = await arrancarCache(siguiente, persistidor);
    expect(siguiente.getQueryData(['dashboard'])).toBeUndefined();
    dejarDeGuardar();
  });

  it('agrupa las escrituras: una ráfaga de cambios escribe una vez, con lo último', async () => {
    vi.useFakeTimers();
    try {
      const almacen = almacenFalso();
      const escribir = vi.spyOn(almacen, 'escribir');
      const persistidor = agrupandoEscrituras(crearPersistidor(almacen), 1_000);

      // El caché avisa de cada cambio; sin agrupar, cada tecleo escribiría decenas de KB.
      for (let i = 0; i < 20; i++) {
        void persistidor.persistClient({ buster: 'x', timestamp: i, clientState: { queries: [], mutations: [] } });
      }
      expect(escribir).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(escribir).toHaveBeenCalledTimes(1);
      expect(almacen.contenido()?.timestamp).toBe(19);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cerrar sesión cancela la escritura en vuelo: nada vuelve a escribirse después de borrar', async () => {
    vi.useFakeTimers();
    try {
      const almacen = almacenFalso();
      const persistidor = agrupandoEscrituras(crearPersistidor(almacen), 1_000);

      // Una escritura agendada, y la vendedora cierra sesión antes de que caiga.
      void persistidor.persistClient({ buster: 'x', timestamp: 1, clientState: { queries: [], mutations: [] } });
      await persistidor.removeClient();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(almacen.contenido()).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
