import { describe, expect, it } from 'vitest';

/**
 * EL CANDADO DEL PUENTE MUERTO — que se pueda escribirle un correo desde
 * TODOS los lugares donde la app dibuja el botón.
 *
 * 🔴 **ESTE TEST EXISTE PORQUE EL DEFECTO NO TIENE SÍNTOMA.** `FichaContacto`
 * declaraba `onCorreo`, dibujaba «Escribirle» solo si le llegaba, y **nadie se
 * la pasaba nunca**: `grep 'onCorreo=' src/` daba CERO durante casi un mes. No
 * hubo error, ni log, ni test rojo — la pantalla se veía perfecta y la acción
 * simplemente no existía. Es el mismo patrón que ya había dejado a
 * `FichaContacto` entero huérfano una vez (ver `PanelDerecho.tsx`) y a la
 * pestaña «Notas» como código muerto durante meses. El patrón, escrito una vez:
 * **una prop opcional que esconde la feature cuando falta se rompe SIN un solo
 * síntoma.**
 *
 * 🔴 **Y LA PRIMERA VERSIÓN DE ESTE CANDADO YA QUEDÓ CORTA — por eso hoy no
 * enumera sitios.** Vigilaba `PanelDerecho` y `HojaContacto`, o sea justo los
 * dos que el PR acababa de cablear, mientras `PanelContexto` montaba un segundo
 * `<BloqueLeadForm>` sin el puente: «Escribirle» aparecía en una ficha y no en
 * la otra, en verde. Una lista escrita a mano sólo cubre los montajes que
 * alguien recordó, y el que rompe es siempre el que se agrega después. Lo que
 * se fija ahora es la RELACIÓN, derivada del árbol en las dos puntas:
 *
 *   *si un componente ACEPTA el puente, todo montaje suyo en una pantalla de
 *    verdad tiene que PASÁRSELO.*
 *
 * Un test de DOM no puede ver esto: cada componente renderiza correctamente lo
 * que su código dice; lo que está mal es que un llamador se olvidó de un cable.
 *
 * ⚠️ **`import.meta.glob` y NUNCA `node:fs`**: con `fs` el test pasa en vitest y
 * **falla el typecheck** de `tsconfig.app.json`, que no lleva los tipos de node
 * (la cicatriz es `etapas.test.ts`, ADR 0049).
 */

const FUENTES = import.meta.glob('../../**/*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>;

/**
 * Las galerías montan las piezas a mano para fotografiarlas sin server, y los
 * tests las montan para probar otra cosa. Ninguno de los dos navega: exigirles
 * el puente sería pedirles que sepan de vistas.
 */
function esPantallaDeVerdad(ruta: string): boolean {
  return !ruta.includes('galeria') && !ruta.includes('.test.');
}

/**
 * 🔴 **LOS COMENTARIOS DE ESTE REPO CITAN JSX, y eso ya rompió este test.**
 * `HojaContacto` explica en su docblock que el llamador la envuelve en
 * `{ficha && <HojaContacto …/>}`, y `PanelDerecho` cuenta que
 * `grep '<FichaContacto' src/` daba cero: leídos crudos, los dos parecen
 * montajes de verdad — el primero dio un falso rojo, el segundo habría contado
 * dos fichas donde hay una. **Un candado que lee el árbol tiene que leer
 * CÓDIGO**, no la prosa que lo describe.
 */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 🔴 **MIRAR LA ETIQUETA, NO EL ARCHIVO — y esto ya falló una vez acá mismo.**
 * La primera versión preguntaba si el archivo NOMBRABA a `onMandarCorreo`, y
 * eso da verdadero por el solo hecho de declarar la prop: sacándole el cable al
 * mount de la hoja, el test seguía en verde. Un candado que no se pone rojo
 * cuando el defecto vuelve no es un candado.
 *
 * Devuelve el texto de cada `<Componente …>` abierto, cortando en el `>` que
 * cierra la etiqueta y no en el primero que aparezca: adentro de un atributo
 * hay `=>` por todos lados, así que se lleva la cuenta de las llaves.
 */
function etiquetasDe(codigo: string, componente: string): string[] {
  const etiquetas: string[] = [];
  const marca = `<${componente}`;
  let desde = codigo.indexOf(marca);
  while (desde !== -1) {
    // ⚠️ `<Panel` no puede contar como `<PanelDerecho`: el siguiente caracter
    // tiene que cerrar el nombre, o un componente nuevo cuyo nombre empieza
    // igual se llevaría los montajes del otro.
    const siguiente = codigo[desde + marca.length] ?? '';
    if (/[A-Za-z0-9_]/.test(siguiente)) {
      desde = codigo.indexOf(marca, desde + marca.length);
      continue;
    }
    let llaves = 0;
    let i = desde + marca.length;
    for (; i < codigo.length; i++) {
      const c = codigo[i];
      if (c === '{') llaves++;
      else if (c === '}') llaves--;
      else if (c === '>' && llaves === 0) break;
    }
    etiquetas.push(codigo.slice(desde, i));
    desde = codigo.indexOf(marca, i);
  }
  return etiquetas;
}

function pantallas(): { ruta: string; codigo: string }[] {
  return Object.entries(FUENTES)
    .filter(([ruta]) => esPantallaDeVerdad(ruta))
    .map(([ruta, fuente]) => ({ ruta, codigo: sinComentarios(fuente) }));
}

/**
 * QUIÉN ACEPTA EL PUENTE — se DERIVA, no se enumera.
 *
 * La punta que faltaba: la lista vieja de sitios no podía saber de un componente
 * nuevo. Acá se busca la DECLARACIÓN de la prop (`onCorreo?:`, `onMandarCorreo?:`
 * — cualquier `on…Correo` tipada) y se la atribuye al `export function` más
 * cercano hacia arriba, que es cómo se escriben todos los componentes de este
 * front.
 *
 * ⚠️ **Se busca la forma TIPADA (`nombre?:`), no el nombre suelto**: en el
 * destructurado (`{ onCorreo, … }`) y en cada uso (`onCorreo({…})`) la prop
 * aparece igual, y contarlos haría que un componente que sólo la CONSUME se
 * declare dueño de ella.
 */
function componentesQueAceptanElPuente(): { componente: string; prop: string; ruta: string }[] {
  const encontrados: { componente: string; prop: string; ruta: string }[] = [];
  for (const { ruta, codigo } of pantallas()) {
    // ⚠️ `on[A-Z][A-Za-z]*Correo` NO sirve, y falla del lado callado: en
    // `onCorreo` la `C` la consume la clase `[A-Z]` y después ya no queda un
    // «Correo» que matchear, así que enganchaba `onMandarCorreo` y **se perdía
    // justo la prop de la ficha** — el test quedaba vigilando media relación.
    for (const m of codigo.matchAll(/\b(on[A-Za-z]*Correo)\??\s*:/g)) {
      const antes = codigo.slice(0, m.index);
      const declara = [...antes.matchAll(/export function (\w+)\s*\(/g)].at(-1);
      if (!declara) continue;
      encontrados.push({ componente: declara[1]!, prop: m[1]!, ruta });
    }
  }
  return encontrados;
}

describe('el puente a Correos', () => {
  /**
   * La red contra el modo de falla más caro de un test que lee el árbol: que
   * deje de leerlo. `seleccionVisible.test.ts` aprobó meses leyendo la cadena
   * vacía porque vitest servía el CSS sin contenido. Acá, con el glob roto, no
   * habría declaraciones ni montajes y **todo pasaría**.
   */
  it('el árbol se lee: hay componentes que declaran el puente', () => {
    const aceptan = componentesQueAceptanElPuente();
    expect(pantallas().length).toBeGreaterThan(10);
    expect(aceptan.length, 'no se encontró ni una declaración de on…Correo: el glob dejó de leer el árbol').toBeGreaterThan(
      4,
    );
    // Los dos extremos de la cadena tienen que estar: el que la vendedora ve
    // (la ficha) y el que lo baja desde la vista (el panel).
    const nombres = new Set(aceptan.map((a) => a.componente));
    expect(nombres.has('FichaContacto')).toBe(true);
    expect(nombres.has('PanelDerecho')).toBe(true);
  });

  /**
   * LA RELACIÓN, y es lo único que sobrevive al próximo montaje que alguien
   * agregue: no importa dónde esté ni quién lo escriba — si el componente sabe
   * recibir el puente, el que lo monta se lo tiene que dar.
   */
  it('todo montaje de un componente que acepta el puente se lo pasa', () => {
    const aceptan = componentesQueAceptanElPuente();
    const faltantes: string[] = [];
    let montajes = 0;

    for (const { componente, prop } of aceptan) {
      for (const { ruta, codigo } of pantallas()) {
        for (const etiqueta of etiquetasDe(codigo, componente)) {
          montajes++;
          if (!new RegExp(`\\b${prop}\\s*=`).test(etiqueta)) {
            faltantes.push(`${ruta} monta <${componente}> sin pasarle ${prop}`);
          }
        }
      }
    }

    // Un componente puede no estar montado en ninguna parte (`PanelContexto` hoy
    // no lo está, medido el 17-ago-2026) y eso es otro problema, no éste; pero
    // si NINGUNO tuviera montajes, este test estaría aprobando sin mirar nada.
    expect(montajes, 'ningún montaje encontrado: el barrido dejó de ver JSX').toBeGreaterThan(5);
    expect(faltantes).toEqual([]);
  });
});
