/**
 * ¿ESTA CÁSCARA SABE ABRIR EL NAVEGADOR? — puro, y existe por un defecto REAL.
 *
 * ── Lo que pasó (7-ago-2026, reportado por el dueño) ──────────────────────
 * Al tocar un destino en la vista Navegador saltó:
 *
 *     Command abrir_navegador not allowed by ACL
 *
 * No era la configuración: los 9 tests de `src-tauri/src/lib.rs` pasan, incluido
 * el que invoca por el IPC real con la URL de producción. El permiso está
 * declarado y referenciado en las DOS capabilities, como manda ADR 0040 §5.3.
 *
 * ── El motivo verdadero: la UI y la CÁSCARA se despliegan por caminos distintos ──
 * Hermes sirve su UI por **OTA**: un deploy la pone en la máquina de las cuatro
 * vendedoras en el acto. La cáscara, no — es un `.dmg`/`.exe` que se compila
 * aparte (`tauri-windows.yml` es `workflow_dispatch`) y hay que **reinstalar a
 * mano**. Así que existe una franja —hoy, TODAS— donde el front trae una vista
 * que la cáscara instalada no sabe atender.
 *
 * Es la misma forma que el front ya maneja con el server (`ventana_cierra` se
 * lee opcional porque N4 va solo y N5 es un botón), pero con la cáscara la
 * distancia es MAYOR: allá el desfase dura lo que tarda un click en Actions;
 * acá dura hasta que alguien reinstala la app en cada máquina.
 *
 * ── Por qué NO alcanzaba con «¿estoy en Tauri?» ───────────────────────────
 * `abrir.ts` decidía el fallback con `puenteTauri()`: adentro de la cáscara
 * asumía que el comando estaba. En una cáscara vieja el puente existe, el
 * `invoke` rebota y la vendedora se queda con un botón muerto y un mensaje en
 * inglés que no le dice nada. La pregunta correcta no es dónde corre, es **si el
 * comando respondió**.
 */

/**
 * Los rechazos que significan «esta cáscara no tiene el comando», en las
 * redacciones que usa Tauri. Van en minúsculas: se compara normalizado.
 *
 * 🔴 **Nuestros propios rechazos están en castellano** y salen de `validar()` en
 * `lib.rs` («solo se abren direcciones https…»). Esa diferencia es lo que hace
 * seguro el reconocimiento por texto, y por eso se fija con un test: si algún
 * día `validar()` contestara en inglés, un URL inválido se leería como cáscara
 * vieja y **se abriría en Chrome lo que Rust quiso frenar**.
 */
const RECHAZOS_DE_CASCARA_VIEJA = [
  'not allowed by acl', // el ACL rechazó el comando (cáscara sin el permiso)
  'not found', // `command X not found`
  'unknown command', // el handler no lo tiene registrado
  'not registered',
] as const;

/**
 * ¿El rechazo es «esta cáscara no sabe», y no «Rust dijo que no»?
 *
 * La distinción decide dos comportamientos opuestos y ninguno puede robarle el
 * caso al otro:
 *   · cáscara vieja → se cae al navegador del sistema, y la vendedora trabaja;
 *   · Rust dijo que no → se muestra SU mensaje, porque `validar()` ya explica el
 *     porqué en criollo y abrir igual sería saltarse la guarda.
 */
export function esCascaraSinElComando(motivo: unknown): boolean {
  if (typeof motivo !== 'string') return false;
  const m = motivo.toLowerCase();
  return RECHAZOS_DE_CASCARA_VIEJA.some((r) => m.includes(r));
}
