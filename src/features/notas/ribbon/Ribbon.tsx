import { useBlockNoteEditor } from '@blocknote/react';
import { useRef, useState } from 'react';
import { cn } from '../../../lib/utils';
import { ACCESO_RAPIDO } from './catalogo';
import { TABS, type TabRibbon } from './tabs';
import { RibbonBoton } from './RibbonBoton';
import { RibbonTabs } from './RibbonTabs';
import { useRovingRibbon } from './useRovingRibbon';
import { TabDibujar } from './tabs/TabDibujar';
import { TabInicio } from './tabs/TabInicio';
import { TabInsertar } from './tabs/TabInsertar';
import { TabRevisar } from './tabs/TabRevisar';
import { TabVista } from './tabs/TabVista';

/**
 * LA RIBBON DE LA LIBRETA — cinco pestañas, grupos rotulados, una sola barra.
 *
 * ══ QUÉ CAMBIA RESPECTO DE LA BARRA QUE REEMPLAZA ═══════════════════════════
 *
 * La barra anterior (17-ago-2026) resolvió lo mismo un escalón más abajo: los
 * comandos ya existían y no se veían, así que se los puso a la vista. Lo que
 * quedó fue **una fila de dieciocho íconos sin un rótulo**, que sigue pidiendo
 * que alguien los pruebe de a uno para saber qué hacen.
 *
 * Acá los mismos comandos quedan **nombrados y agrupados** —Portapapeles,
 * Fuente, Párrafo, Estilos— y, sobre todo, aparece **lugar declarado para lo que
 * todavía no existe**: Insertar, Dibujar, Revisar y Vista tienen sus cajas, y
 * las que no andan se ven apagadas con su motivo en vez de no estar.
 *
 * ⚠️ **Sigue siendo una apuesta sobre descubribilidad, y se mide igual**: si a
 * las dos semanas las páginas siguen siendo texto plano, lo que faltaba no era
 * la barra ni la Ribbon (la consulta está en ADR 0046 §8).
 *
 * ══ 🔴 NO SE USA `FormattingToolbar`, Y NO ES UN CAPRICHO ═══════════════════
 *
 * Su `Root` de `@blocknote/mantine` instala un **`useFocusTrap`**: el `Tab`
 * cicla adentro de la barra y no vuelve al papel. Ver `useRovingRibbon.ts`, que
 * documenta el reemplazo. Los botones del paquete se montan igual, derecho
 * adentro de los grupos, con toda su lógica: se verificó leyendo su fuente que
 * ninguno necesita ese contexto.
 *
 * ══ EL ESTADO ES UNO SOLO, Y VIVE AFUERA ════════════════════════════════════
 *
 * `tab` llega por prop desde `Libreta.tsx`. Adentro no puede vivir: el editor se
 * **remonta con `key`** al cambiar de página, así que cambiar de nota te
 * devolvería a «Inicio» cada vez.
 *
 * Sólo se monta la pestaña activa. Las otras cuatro no se renderizan.
 */

const ID_PANEL = 'ribbon-panel';

/**
 * LO QUE LA RIBBON NO PUEDE SABER SOLA: el estado del layout de alrededor.
 *
 * La lista de páginas es de `Libreta.tsx` y contraer es de esta cáscara. Llegan
 * como acciones para que `TabVista` no tenga que saber nada de layout — que es
 * lo que separar comandos de presentación compra.
 */
export interface VistaDeLaLibreta {
  listaVisible: boolean;
  alternarLista: () => void;
}

function contenidoDe(
  tab: TabRibbon,
  vista: VistaDeLaLibreta & { contraida: boolean; alternarContraer: () => void },
) {
  switch (tab) {
    case 'inicio':
      return <TabInicio />;
    case 'insertar':
      return <TabInsertar />;
    case 'dibujar':
      return <TabDibujar />;
    case 'revisar':
      return <TabRevisar />;
    case 'vista':
      return <TabVista {...vista} />;
  }
}

/**
 * DESHACER Y REHACER, EN LA FILA DE LAS PESTAÑAS.
 *
 * Es la barra de acceso rápido de Office, y acá el motivo es concreto: metidos
 * adentro de «Inicio» desaparecen al pasar a «Insertar», y deshacer es
 * exactamente lo que se busca después de insertar algo que no era.
 *
 * ⚠️ **Siempre habilitados**: BlockNote no publica un `canUndo`/`canRedo`, y
 * `undo()` devuelve `false` sin hacer nada cuando no hay qué deshacer. Apagarlos
 * pidiendo el estado a ProseMirror sería adivinar una API interna; que el botón
 * no haga nada cuando no hay historia es lo que ya pasa con `Mod+Z`.
 */
function AccesoRapido() {
  const editor = useBlockNoteEditor();
  return (
    <div className="flex items-center gap-0.5">
      {ACCESO_RAPIDO.map((c) => (
        <RibbonBoton
          key={c.id}
          icono={c.icono}
          etiqueta={c.etiqueta}
          atajo={c.atajo}
          data-comando={c.id}
          onClick={() => {
            if (c.id === 'deshacer') editor.undo();
            else editor.redo();
          }}
        />
      ))}
    </div>
  );
}

export function Ribbon({
  tab,
  onTab,
  vista,
}: {
  tab: TabRibbon;
  onTab: (tab: TabRibbon) => void;
  vista: VistaDeLaLibreta;
}) {
  const editor = useBlockNoteEditor();
  const panel = useRef<HTMLDivElement>(null);
  /**
   * ⚠️ CONTRAER ENTRA DESDE EL PRIMER DÍA, NO AL FINAL. La Ribbon mide ~3× lo
   * que medía la barra (~96 px contra ~34), y a 1280×720 eso se le come al papel
   * una franja que se nota. Es el escape que Office ya enseñó: el chevron de la
   * derecha, y deja sólo la fila de pestañas.
   */
  const [contraida, setContraida] = useState(false);

  const { alTeclear, alEnfocar } = useRovingRibbon(panel, { alSalir: () => editor.focus() });

  const etiquetaTab = TABS.find((t) => t.id === tab)?.etiqueta ?? '';

  return (
    // Una BARRA, no una cápsula: ancho completo y una sola línea que la separa
    // del papel. El `data-libreta-barra` es la identidad de esta zona para el
    // CSS (`order: -1`, sin el cual BlockNote la deja 60vh más abajo) y para los
    // tests: no se renombra.
    <div className="sticky top-0 z-10 mb-3 border-b border-border bg-card" data-libreta-barra>
      <div className="flex items-center gap-2 px-2">
        <AccesoRapido />
        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        <RibbonTabs activa={tab} onElegir={onTab} idPanel={ID_PANEL} />
        <div className="ml-auto">
          <RibbonBoton
            icono="contraer"
            etiqueta={contraida ? 'Mostrar las herramientas' : 'Contraer las herramientas'}
            activo={contraida}
            onClick={() => setContraida((c) => !c)}
            data-comando="contraerRibbon"
          />
        </div>
      </div>

      {!contraida && (
        <div
          role="tabpanel"
          id={ID_PANEL}
          aria-labelledby={`ribbon-tab-${tab}`}
          className="border-t border-border/60"
        >
          <div
            ref={panel}
            role="toolbar"
            aria-label={`Comandos de ${etiquetaTab}`}
            onKeyDown={alTeclear}
            onFocus={alEnfocar}
            data-ribbon-comandos
            className={cn(
              // 🔴 SIN `flex-wrap`, y el scroll sólo como ÚLTIMO RECURSO.
              //
              // Envolver en una segunda fila haría que la barra crezca hacia
              // abajo justo cuando la pantalla es chica, que es cuando menos
              // alto hay. Y el scroll horizontal esconde sin decirlo: no se ve
              // cuántos grupos quedaron a la derecha ni cómo se llaman.
              //
              // Lo que resuelve el caso normal es el acomodo de `acomodar.ts`
              // (achicar el aire → sacar los rótulos de los botones → mandar los
              // grupos secundarios al «Más»). Esto es lo que queda para el ancho
              // donde ni los primarios entran, y ahí un corte en seco sería peor.
              'sin-riel flex items-stretch overflow-x-auto py-1.5',
            )}
          >
            {contenidoDe(tab, { ...vista, contraida, alternarContraer: () => setContraida((c) => !c) })}
          </div>
        </div>
      )}
    </div>
  );
}
