/**
 * ¿ESTAMOS ADENTRO DE LA CÁSCARA? — una sola respuesta para toda la app.
 *
 * Vivía adentro de `enlacesExternos.ts`, que es sobre otra cosa (los links que
 * se van al navegador del sistema). Al aparecer el segundo consumidor —el
 * navegador de Hermes, ADR 0040— copiar el `__TAURI_INTERNALS__` habría dejado
 * dos detecciones que pueden divergir, que es la lección de #37 aplicada a
 * cuatro renglones.
 *
 * `__TAURI_INTERNALS__` y no `@tauri-apps/api`: ese paquete no es dependencia
 * del front a propósito (la UI se sirve por OTA y tiene que andar igual en un
 * navegador común, donde importar la API sería un módulo que no resuelve).
 */

interface ConTauri {
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
  };
}

/** El puente nativo, o `null` si esto corre en un navegador común. */
export function puenteTauri() {
  return (window as ConTauri).__TAURI_INTERNALS__ ?? null;
}

/** ¿La app corre dentro de la cáscara Tauri? */
export function enTauri(): boolean {
  return puenteTauri() !== null;
}
