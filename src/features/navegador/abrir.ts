import { abrirExterno } from '../../lib/enlacesExternos';
import { puenteTauri } from '../../lib/tauri';

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
    // El rechazo de Rust ES el mensaje: `validar()` explica en criollo por qué
    // no («solo se abren direcciones https — esta es «file»»). Reescribirlo acá
    // dejaría dos redacciones para el mismo motivo.
    return { ok: false, motivo: typeof e === 'string' ? e : 'no se pudo abrir la ventana' };
  }
}
