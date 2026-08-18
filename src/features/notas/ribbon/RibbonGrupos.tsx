import { useBlockNoteEditor, useEditorState } from '@blocknote/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { acomodar, modoPara } from './acomodar';
import type { Grupo } from './catalogo';
import { RibbonComando, type ModoRibbon } from './RibbonBoton';
import { RibbonAviso, RibbonFila, RibbonGrupo } from './RibbonGrupo';
import { RibbonOverflow } from './RibbonOverflow';

/**
 * DIBUJA LOS GRUPOS DE UNA PESTAÑA DERECHO DEL CATÁLOGO, Y LOS ACOMODA.
 *
 * ══ EL REGISTRO DE CONTROLES ═══════════════════════════════════════════════
 *
 * Cada comando busca su control en dos lugares y en este orden:
 *
 *  1. `piezas[id]` — un control propio ya armado (el selector de fuente, un
 *     botón del paquete de BlockNote con su estado y su tooltip).
 *  2. `acciones[id]` — un handler, y el botón lo dibuja `RibbonComando`.
 *
 * Y si no está en ninguno, `RibbonComando` lo apaga solo. Esa es la propiedad
 * que importa: **la pantalla no puede inventar un comando que el catálogo no
 * declaró, ni encender uno que nadie cableó.** Un id mal escrito no dibuja un
 * botón roto: dibuja uno apagado que el test encuentra.
 *
 * ══ Y ACÁ VIVE LA MEDICIÓN ═════════════════════════════════════════════════
 *
 * Acomodarse es responsabilidad de este componente y no de las pestañas: es el
 * único que tiene la lista de grupos y su propia caja. Las cinco pestañas no
 * saben que existe el «Más», y por eso ninguna puede olvidarse de tenerlo.
 *
 * 🔴 **La DECISIÓN vive afuera y pura** (`acomodar.ts`). Acá queda sólo el
 * `offsetWidth` y el `ResizeObserver`, que es lo que jsdom no puede ejecutar.
 */
export function RibbonGrupos({
  grupos,
  piezas,
  acciones,
  activos,
  edita = true,
  bloqueados,
}: {
  grupos: Grupo[];
  piezas?: Record<string, ReactNode>;
  acciones?: Record<string, (() => void) | undefined>;
  activos?: Record<string, boolean | undefined>;
  /**
   * 🔴 EL MODO LECTURA APAGA LOS COMANDOS QUE EDITAN, Y NO LO DECIDE LA PESTAÑA.
   *
   * Los botones del PAQUETE ya se esconden solos cuando el editor no es editable
   * (lo preguntan en su `useEditorState`). **Los nuestros no se enteran**:
   * `updateBlock` y `addStyles` siguen funcionando sobre un editor en solo
   * lectura, así que sin esto «Viñetas» editaría una página que la pantalla dice
   * que no se edita.
   *
   * ⚠️ **Se pregunta acá adentro y no en cada pestaña, a propósito**: un `Record`
   * que cada tab tiene que acordarse de pasar es un `Record` que alguna se va a
   * olvidar, y el síntoma sería justamente el silencioso. Lo que las pestañas
   * declaran es lo único que sólo ellas saben: **si editan el documento**.
   * «Vista» no —hay que poder salir del modo lectura—, «Revisar» tampoco (mira y
   * cuenta), y «Dibujar» está entera apagada de todos modos.
   */
  edita?: boolean;
  /**
   * Lo mismo pero de a uno, con su propio motivo: «Acercar» cuando el zoom ya
   * está al máximo. ⚠️ **No se resuelve dejando la acción en `undefined`**: eso
   * lo dibujaría como «Todavía no cableado», que es una mentira distinta.
   */
  bloqueados?: Record<string, string | undefined>;
}) {
  const fila = useRef<HTMLDivElement>(null);
  const { modo, visibles, enOverflow } = useAcomodar(fila, grupos);
  const [masAbierto, setMasAbierto] = useState(false);

  const editor = useBlockNoteEditor();
  const enLectura = useEditorState({ editor, selector: ({ editor }) => !editor.isEditable });
  const bloqueado = edita && enLectura ? 'En modo lectura no se edita' : undefined;

  // ⚠️ Se cierra solo cuando ya no hay nada adentro — al ensanchar la ventana
  // los grupos vuelven a la fila y el panel quedaría abierto y VACÍO, con su
  // línea separadora y todo.
  useEffect(() => {
    if (enOverflow.length === 0 && masAbierto) setMasAbierto(false);
  }, [enOverflow.length, masAbierto]);

  // Los avisos se juntan y se dibujan UNA vez al final: colgados de su grupo,
  // un texto que habla de toda la pestaña le daría 16 rem de ancho a un grupo de
  // cuatro botones.
  const avisos = [...new Set(grupos.map((g) => g.aviso).filter((a): a is string => Boolean(a)))];

  const dibujar = (g: Grupo) => (
    <RibbonGrupo key={g.id} id={g.id} etiqueta={g.etiqueta} compacto={modo === 'compacto'}>
      {filasDe(g).map((comandos, i) => (
        <RibbonFila key={i}>
          {comandos.map((c) => {
            const propia = piezas?.[c.id];
            // Las piezas del paquete NO se envuelven en el bloqueo: ellas
            // mismas se esconden cuando el editor no es editable, que es más
            // honesto que dejarlas grises diciendo lo mismo.
            if (propia !== undefined) return <span key={c.id}>{propia}</span>;
            return (
              <RibbonComando
                key={c.id}
                comando={c}
                onClick={acciones?.[c.id]}
                activo={activos?.[c.id]}
                modo={modo}
                bloqueado={bloqueados?.[c.id] ?? bloqueado}
              />
            );
          })}
        </RibbonFila>
      ))}
    </RibbonGrupo>
  );

  const ocultos = grupos.filter((g) => enOverflow.includes(g.id));

  return (
    <div className="flex w-full min-w-0 flex-col">
      {/* ⚠️ El ref va en la fila y NO en el contenedor: la fila es la que tiene
          el ancho disponible como `clientWidth`, y la que crece de más cuando
          no entra. Midiendo el contenedor, la segunda fila del «Más» le sumaría
          alto y no cambiaría nada del ancho — pero el día que alguien le ponga
          padding lateral al contenedor, la cuenta se iría por ahí. */}
      <div ref={fila} data-ribbon-fila className="flex items-stretch">
        {grupos.filter((g) => visibles.includes(g.id)).map(dibujar)}
        {ocultos.length > 0 && (
          <RibbonOverflow
            cuantos={ocultos.length}
            abierto={masAbierto}
            onAlternar={() => setMasAbierto((a) => !a)}
            idPanel={ID_PANEL_MAS}
            compacto={modo === 'compacto'}
          />
        )}
        {avisos.map((a) => (
          <RibbonAviso key={a} texto={a} />
        ))}
      </div>

      {masAbierto && ocultos.length > 0 && (
        <div
          id={ID_PANEL_MAS}
          data-ribbon-overflow-panel
          className="mt-1.5 flex items-stretch border-t border-border/60 pt-1.5"
        >
          {ocultos.map(dibujar)}
        </div>
      )}
    </div>
  );
}

const ID_PANEL_MAS = 'ribbon-mas';

/** Las dos filas del grupo. Ver `corte` en `catalogo.ts`. */
function filasDe(g: Grupo) {
  const corte = g.corte ?? g.comandos.length;
  return [g.comandos.slice(0, corte), g.comandos.slice(corte)].filter((f) => f.length > 0);
}

/**
 * LA MEDICIÓN — lo único de este frente que no se puede testear sin navegador.
 *
 * ⚠️ **Los anchos se guardan por `modo:id` y NO se borran.** Un grupo que se fue
 * al «Más» ya no está en la fila, así que no se lo puede volver a medir; sin el
 * recuerdo, la pasada siguiente lo trataría como «sin medir», lo mostraría, y
 * ahí sí habría parpadeo. El recuerdo es lo que hace estable la entrada de
 * `acomodar()` — el resto de la propiedad está escrito en su docblock.
 *
 * ⚠️ **El estado se pisa sólo si cambió.** El efecto corre después de CADA
 * render (no lleva lista de dependencias, a propósito: los controles del paquete
 * aparecen y desaparecen con la selección y eso cambia los anchos). Sin la
 * comparación sería un bucle infinito de render.
 */
function useAcomodar(fila: React.RefObject<HTMLDivElement | null>, grupos: Grupo[]) {
  const [estado, setEstado] = useState<{ modo: ModoRibbon; visibles: string[]; enOverflow: string[] }>(
    () => ({ modo: 'completo', visibles: grupos.map((g) => g.id), enOverflow: [] }),
  );
  const naturales = useRef(new Map<string, number>());
  const medirRef = useRef<() => void>(() => {});
  /**
   * 🔴 EL ESPEJO DEL ESTADO, Y NO ES UN LUJO. El efecto que mide corre después
   * de CADA render, así que si llamara a `setEstado` siempre —aunque el updater
   * devuelva el objeto anterior— React puede volver a renderizar una vez antes
   * de abandonar, y ese render dispara el efecto de nuevo: un bucle que no se
   * ve como bucle, se ve como la barra parpadeando. Con el espejo, **cuando no
   * cambió nada no se llama a `setEstado` en absoluto**.
   */
  const espejo = useRef(estado);

  function medir() {
    const el = fila.current;
    if (!el) return;
    const disponible = el.clientWidth;
    const modo = modoPara(disponible);

    for (const nodo of el.querySelectorAll<HTMLElement>('[data-ribbon-grupo-id]')) {
      // Los que están adentro del desplegable miden otra cosa (van apilados):
      // guardarlos pisaría el ancho bueno con uno que no sirve para decidir.
      if (nodo.closest('[data-ribbon-overflow-panel]')) continue;
      const id = nodo.getAttribute('data-ribbon-grupo-id');
      if (id && id !== 'mas') naturales.current.set(`${modo}:${id}`, nodo.offsetWidth);
    }

    const r = acomodar(
      disponible,
      grupos.map((g) => ({
        id: g.id,
        prioridad: g.prioridad,
        ancho: naturales.current.get(`${modo}:${g.id}`),
      })),
    );

    const previo = espejo.current;
    if (
      previo.modo === modo &&
      previo.visibles.join() === r.visibles.join() &&
      previo.enOverflow.join() === r.enOverflow.join()
    ) {
      return;
    }
    espejo.current = { modo, ...r };
    setEstado(espejo.current);
  }

  useEffect(() => {
    medirRef.current = medir;
    medir();
  });

  useEffect(() => {
    const el = fila.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => medirRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fila]);

  return estado;
}
