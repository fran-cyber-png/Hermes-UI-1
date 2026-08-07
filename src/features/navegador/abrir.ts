import { abrirExterno } from '../../lib/enlacesExternos';
import { puenteTauri } from '../../lib/tauri';
import { esCascaraSinElComando } from './cascara';

/**
 * ABRIR EL NAVEGADOR — la costura con la cáscara.
 *
 * Adentro de Tauri invoca `abrir_navegador`, que abre (o reusa) UNA ventana de
 * Hermes. Fuera de Tauri —`npm run dev` en el navegador, o la app servida
 * suelta— cae al navegador del sistema con `abrirExterno`, que ya existía.
 *
 * 🔴 El fallback NO es un detalle: sin él la vista sería un botón muerto para
 * quien desarrolla, y el defecto se descubriría recién al empaquetar.
 *
 * ⚠️ Y no se colapsan los dos casos en «se abrió»: son ventanas distintas, en
 * apps distintas, y la pantalla lo dice. La ventaja entera del frente es la
 * sesión separada; anunciarla cuando en realidad se abrió Chrome sería vender
 * lo que no pasó.
 */
export type Apertura =
  | { ok: true; donde: 'hermes' | 'sistema' }
  | { ok: false; motivo: string };

export async function abrirNavegador(url: string): Promise<Apertura> {
  const tauri = puenteTauri();

  if (!tauri) {
    abrirExterno(url);
    return { ok: true, donde: 'sistema' };
  }

  try {
    await tauri.invoke('abrir_navegador', { url });
    return { ok: true, donde: 'hermes' };
  } catch (e) {
    /**
     * 🔴 UNA CÁSCARA VIEJA NO ES UN ERROR: ES UN CAMINO MÁS LARGO.
     *
     * La UI se despliega por OTA y llega a las cuatro máquinas en el acto; la
     * cáscara es un `.dmg`/`.exe` que se reinstala a mano. Al desplegar esta
     * vista (7-ago-2026) NINGUNA cáscara instalada tenía el comando, y el
     * `invoke` rebotaba con «Command abrir_navegador not allowed by ACL» — un
     * botón muerto con un mensaje en inglés.
     *
     * Se cae al navegador del sistema, exactamente igual que fuera de Tauri: se
     * pierde la sesión separada —que es la ventaja del frente— pero la vendedora
     * llega a Cerberus, que es lo que fue a hacer. Y la pantalla lo DICE
     * (`donde: 'sistema'`), porque anunciar la sesión de trabajo cuando en
     * realidad se abrió Chrome sería vender lo que no pasó.
     *
     * Lo que NO se toca: si el rechazo vino de `validar()` —Rust frenó la URL—
     * se muestra su mensaje y no se abre nada. Abrir igual sería saltarse la
     * única guarda del frente.
     */
    if (esCascaraSinElComando(e)) {
      abrirExterno(url);
      return { ok: true, donde: 'sistema' };
    }
    // El rechazo de Rust ES el mensaje: `validar()` explica en criollo por qué
    // no («solo se abren direcciones https — esta es «file»»). Reescribirlo acá
    // dejaría dos redacciones para el mismo motivo.
    return { ok: false, motivo: typeof e === 'string' ? e : 'no se pudo abrir la ventana' };
  }
}
