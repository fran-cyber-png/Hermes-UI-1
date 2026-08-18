import { useActiveStyles, useBlockNoteEditor } from '@blocknote/react';
import { useMemo } from 'react';
import { ESQUEMA_LIBRETA } from '../editor';
import { TAMANO_POR_DEFECTO } from '../estilosDeTexto';
import { FUENTES_CANDIDATAS, FUENTE_POR_DEFECTO, fuentesInstaladas, medidorDeCanvas } from '../fuentesDisponibles';
import { SelectorBuscable } from '../SelectorBuscable';
import { TAMANOS_SUGERIDOS, tamanoLibre } from './tamanos';

/**
 * LOS DOS SELECTORES PROPIOS — fuente y tamaño.
 *
 * Vienen tal cual de `BarraDeFormato.tsx`, con **un solo cambio, y es
 * obligatorio**:
 *
 * 🔴 **Ahora leen el estilo activo con `useActiveStyles()` y no con
 * `editor.getActiveStyles()` en el render.** Antes funcionaba de casualidad:
 * vivían adentro de `<FormattingToolbar>`, que los re-renderizaba en cada cambio
 * de selección. La Ribbon no usa ese componente (atrapa el foco, ver
 * `useRovingRibbon.ts`), así que sin el hook los dos se quedarían **clavados en
 * lo que decían al montarse** — un selector que afirma «Arial» sobre un texto en
 * Georgia, sin ningún síntoma más que el de estar mintiendo.
 *
 * Todo lo demás es igual, incluido lo que ya estaba resuelto:
 *
 * · **Sin estilo puesto muestran «Arial» y «16»**, que es lo que el papel ES
 *   (`index.css`), no la palabra «Predeterminada». Hay un test que cruza esos
 *   dos números con la hoja de estilos.
 * · **Las fuentes se MIDEN** contra la máquina (`fuentesDisponibles.ts`): sólo
 *   se ofrecen las instaladas, así que ninguna opción se ve igual a otra.
 * · **En tamaño vale un número escrito a mano**, acotado 6–200.
 */

export function SelectorDeFuente() {
  const editor = useBlockNoteEditor(ESQUEMA_LIBRETA);
  const activos = useActiveStyles(editor) as Record<string, unknown>;
  const actual = activos.fuente;

  // Se miden UNA vez por montaje: la lista no cambia mientras la app corre, y
  // medir treinta fuentes en cada tecla sería trabajo por nada.
  const instaladas = useMemo(() => fuentesInstaladas(FUENTES_CANDIDATAS, medidorDeCanvas()), []);
  const opciones = useMemo(() => instaladas.map((f) => ({ nombre: f.nombre, valor: f.css })), [instaladas]);

  const elegida = instaladas.find((f) => f.css === actual);

  return (
    <SelectorBuscable
      titulo="Fuente"
      ancho="9.5rem"
      opciones={opciones}
      valorActual={typeof actual === 'string' ? actual : undefined}
      etiquetaActual={elegida?.nombre ?? FUENTE_POR_DEFECTO}
      estiloDeOpcion={(o) => ({ fontFamily: o.valor })}
      alElegir={(css) => editor.addStyles({ fuente: css } as never)}
    />
  );
}

export function SelectorDeTamano() {
  const editor = useBlockNoteEditor(ESQUEMA_LIBRETA);
  const activos = useActiveStyles(editor) as Record<string, unknown>;
  const actual = activos.tamano;

  const opciones = useMemo(() => TAMANOS_SUGERIDOS.map((n) => ({ nombre: String(n), valor: `${n}px` })), []);

  return (
    <SelectorBuscable
      titulo="Tamaño"
      ancho="4.5rem"
      opciones={opciones}
      valorActual={typeof actual === 'string' ? actual : undefined}
      etiquetaActual={typeof actual === 'string' ? actual.replace('px', '') : String(TAMANO_POR_DEFECTO)}
      permiteLibre={tamanoLibre}
      alElegir={(css) => editor.addStyles({ tamano: css } as never)}
    />
  );
}
