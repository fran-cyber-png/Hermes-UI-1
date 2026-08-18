import { describe, expect, it } from 'vitest';

/**
 * EL CANDADO DE LA RUTA HUÉRFANA — que `GET /api/correos/:id` tenga quien la llame,
 * y que quien la llama esté montado en una pantalla de verdad.
 *
 * 🔴 **ESTE TEST EXISTE PORQUE EL DEFECTO QUE VIGILA NO TIENE SÍNTOMA, y este repo
 * ya lo pagó tres veces.** La pestaña «Notas» estuvo meses declarada y sin ningún
 * componente que la renderizara (`PanelDerecho.tsx`), `FichaContacto` dibujaba
 * «Escribirle» sólo si le llegaba un `onCorreo` que **nadie le pasaba nunca**
 * (`puenteCorreo.test.ts`), y `BloqueHechos`/`DosRespuestas` quedaron huérfanos con
 * el rediseño del panel. En los tres casos no hubo error, ni log, ni test rojo: la
 * pantalla se veía perfecta y la funcionalidad no existía.
 *
 * Acá el riesgo es el mismo con la punta invertida. Sacarle el cuerpo a
 * `GET /api/correos` fue el arreglo de una fuga (viajaba el texto de todos los
 * correos del equipo a los nueve navegadores); `GET /api/correos/:id` es la mitad
 * que lo devuelve **cuando alguien lo pide**. Si nadie lo pide, el server sigue
 * sirviendo una ruta que se ve viva desde el lado del server y Hermes queda **sin
 * ninguna forma de leer lo que mandó** — que es estrictamente peor que antes del
 * arreglo, y no se nota porque nada falla.
 *
 * ⚠️ **`import.meta.glob` y NUNCA `node:fs`**: con `fs` el test pasa en vitest y
 * **falla el typecheck** de `tsconfig.app.json`, que no lleva los tipos de node (la
 * cicatriz es `etapas.test.ts`, ADR 0049).
 */

const FUENTES = import.meta.glob('../../**/*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>;

/**
 * Las galerías montan las piezas a mano para fotografiarlas sin server —y el stub de
 * Correos hasta contesta esta ruta—, así que si contaran, el test quedaría en verde
 * con la app sin cablear: la evidencia probaría la evidencia.
 */
function esPantallaDeVerdad(ruta: string): boolean {
  return !ruta.includes('galeria') && !ruta.includes('.test.');
}

/**
 * 🔴 **LOS COMENTARIOS DE ESTE REPO CITAN RUTAS Y JSX, y eso ya rompió un candado
 * hermano.** Este archivo mismo nombra `GET /api/correos/:id` cuatro veces y
 * `LecturaDeCorreo.tsx` lo explica en prosa: leídos crudos, un docblock cuenta como
 * un cable. **Un candado que lee el árbol tiene que leer CÓDIGO.**
 */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function codigoDePantallas(): { ruta: string; codigo: string }[] {
  return Object.entries(FUENTES)
    .filter(([ruta]) => esPantallaDeVerdad(ruta))
    .map(([ruta, fuente]) => ({ ruta, codigo: sinComentarios(fuente) }));
}

describe('leer un correo enviado', () => {
  it('algún componente vivo pide el cuerpo por `GET /api/correos/:id`', () => {
    const pantallas = codigoDePantallas();
    // Si esto diera cero, el glob dejó de leer el árbol y el test estaría pasando sin
    // mirar nada — el modo de falla de `seleccionVisible.test.ts` con el CSS, que
    // aprobaba leyendo la cadena vacía.
    expect(pantallas.length).toBeGreaterThan(10);

    /**
     * ⚠️ El interpolado es lo que separa esta ruta de las de remitentes: aquéllas son
     * `/api/correos/remitentes/${id}` y no matchean. Buscar `/api/correos/` a secas
     * daría verde con sólo el composer cableado.
     */
    const piden = pantallas.filter(({ codigo }) => codigo.includes('`/api/correos/${'));
    expect(
      piden.length,
      'nadie llama a GET /api/correos/:id — el cuerpo dejó de viajar en la lista y no hay quién lo pida',
    ).toBeGreaterThan(0);
  });

  /**
   * La otra mitad, y es la que faltó las tres veces anteriores: el componente puede
   * existir, hacer el `fetch` perfecto y **no estar montado en ninguna parte**. Ahí
   * el cable existe adentro de un archivo que nadie renderiza.
   */
  it('y ese componente está montado en la vista', () => {
    const montado = codigoDePantallas().filter(({ codigo }) => codigo.includes('<LecturaDeCorreo'));
    expect(
      montado.map((m) => m.ruta),
      'LecturaDeCorreo no se monta en ninguna pantalla',
    ).not.toHaveLength(0);
  });
});
