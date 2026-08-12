import { describe, expect, test } from 'vitest';
import { aplicarRespuesta, comandoEnCurso, filtrarRespuestas } from './comandoBarra';

/**
 * EL `/` DEL COMPOSER — los bordes, que son casi toda la superficie.
 *
 * Lo que importa acá no es que `/cuo` abra el selector: es que **una URL, una
 * fecha y una fracción NO lo abran**. Un selector que salta mientras la
 * vendedora pega un link de pago es peor que no tener el atajo.
 */

describe('cuándo hay un comando', () => {
  test('la barra al principio, con lo tipeado detrás', () => {
    expect(comandoEnCurso('/cuo', 4)).toEqual({ consulta: 'cuo', desde: 0, hasta: 4 });
  });

  test('recién abierta la barra, la consulta es vacía y el selector se abre igual', () => {
    // Abrir con la lista completa es la mitad del valor: la vendedora que no se
    // acuerda del nombre entra por acá.
    expect(comandoEnCurso('/', 1)).toEqual({ consulta: '', desde: 0, hasta: 1 });
  });

  test('después de un espacio o de un salto de línea también', () => {
    expect(comandoEnCurso('hola /pre', 9)?.desde).toBe(5);
    expect(comandoEnCurso('hola\n/pre', 9)?.desde).toBe(5);
  });

  test('🔴 una URL NO abre el selector', () => {
    // El caso real: la vendedora pega el link de pago. Con la regla ingenua («el
    // texto tiene una barra»), acá se abriría un menú encima de lo que escribe.
    expect(comandoEnCurso('te dejo https://pagos.goberna.us/x', 34)).toBeNull();
  });

  test('🔴 una fecha ni una fracción tampoco', () => {
    expect(comandoEnCurso('el 12/08 arrancamos', 8)).toBeNull();
    expect(comandoEnCurso('son 2/3 del total', 7)).toBeNull();
  });

  test('un espacio CIERRA el comando: lo que sigue ya es prosa', () => {
    expect(comandoEnCurso('/cuotas y algo más', 18)).toBeNull();
  });

  test('🔴 el comando se busca en el CURSOR, no al final del texto', () => {
    // Escribió todo el mensaje y volvió con las flechas a meter el dato al
    // principio. Buscando al final, acá no pasaría nada.
    const texto = '/cuo y después te confirmo';
    expect(comandoEnCurso(texto, 4)).toEqual({ consulta: 'cuo', desde: 0, hasta: 4 });
  });

  test('con el cursor ANTES de la barra no hay comando', () => {
    expect(comandoEnCurso('hola /cuo', 3)).toBeNull();
  });

  test('la consulta se normaliza a minúsculas', () => {
    expect(comandoEnCurso('/CUOtas', 7)?.consulta).toBe('cuotas');
  });

  test('un cursor fuera de rango no rompe', () => {
    expect(comandoEnCurso('/cuo', 999)?.consulta).toBe('cuo');
    expect(comandoEnCurso('/cuo', -5)).toBeNull();
  });
});

const R = [
  { clave: 'cuotas', rotulo: 'Dos cuotas', texto: 'Se puede pagar en dos cuotas sin interés.' },
  { clave: 'acceso-un-anio', rotulo: 'Acceso 1 año', texto: 'El acceso lo tenés por todo un año.' },
  { clave: 'publico', rotulo: 'Para todos', texto: 'Es para público general, sin requisitos.' },
];

describe('qué respuestas se ofrecen', () => {
  test('sin consulta, TODAS — no las tres del panel', () => {
    // El chip del panel recorta a 3 por momento de venta. Ese recorte acá sería
    // un catálogo mutilado: el sentido del `/` es llegar a las 27.
    expect(filtrarRespuestas(R, '')).toHaveLength(3);
  });

  test('busca por clave, por rótulo y por texto', () => {
    expect(filtrarRespuestas(R, 'cuo').map((r) => r.clave)).toEqual(['cuotas']);
    expect(filtrarRespuestas(R, 'acceso 1').map((r) => r.clave)).toEqual(['acceso-un-anio']);
    // Por el TEXTO: la vendedora se acuerda de la frase, no de la clave.
    expect(filtrarRespuestas(R, 'requisitos').map((r) => r.clave)).toEqual(['publico']);
  });

  test('🔴 lo que EMPIEZA con lo tipeado va antes que lo que solo lo contiene', () => {
    const con = [
      { clave: 'pago-yape', rotulo: 'Yape', texto: 'x' },
      { clave: 'cuotas', rotulo: 'Cuotas', texto: 'se paga en dos veces con yape' },
    ];
    expect(filtrarRespuestas(con, 'yape').map((r) => r.clave)).toEqual(['pago-yape', 'cuotas']);
  });

  test('dentro de cada grupo se respeta el orden del catálogo', () => {
    // El equipo decidió ese orden. Reordenar por una «relevancia» inventada haría
    // que la misma consulta dé resultados distintos sin que nadie toque nada.
    expect(filtrarRespuestas(R, 'a').map((r) => r.clave)).toEqual(['acceso-un-anio', 'cuotas', 'publico']);
  });

  test('lo que no matchea nada devuelve vacío, no todo', () => {
    expect(filtrarRespuestas(R, 'zzz')).toEqual([]);
  });
});

describe('elegir una respuesta', () => {
  test('reemplaza el tramo del comando y deja el cursor detrás', () => {
    const cmd = comandoEnCurso('/cuo', 4)!;
    expect(aplicarRespuesta('/cuo', cmd, 'Se puede pagar en dos cuotas.')).toEqual({
      texto: 'Se puede pagar en dos cuotas.',
      cursor: 29,
    });
  });

  test('respeta lo que ya había escrito antes y después', () => {
    const texto = 'Hola Javier, /cuo y te confirmo';
    const cmd = comandoEnCurso(texto, 17)!;
    expect(aplicarRespuesta(texto, cmd, 'son dos cuotas').texto).toBe('Hola Javier, son dos cuotas y te confirmo');
  });

  test('agrega un espacio detrás, pero no lo duplica', () => {
    const a = comandoEnCurso('/cuo', 4)!;
    expect(aplicarRespuesta('/cuo', a, 'x').texto).toBe('x');

    const conCola = 'ver /cuo ahora';
    const b = comandoEnCurso(conCola, 8)!;
    // La cola ya empieza con espacio: no se agrega otro.
    expect(aplicarRespuesta(conCola, b, 'dos cuotas').texto).toBe('ver dos cuotas ahora');
  });
});
