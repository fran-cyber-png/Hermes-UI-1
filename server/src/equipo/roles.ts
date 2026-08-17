/**
 * LOS TRES ROLES DE HERMES — puro, sin base y sin entorno.
 *
 * `vendedora` atiende su cola · `supervisor` además ve el padrón entero, «El
 * negocio» y arma campañas · `admin` además administra el equipo, las líneas y
 * el ruteo. Es una ESCALERA, no tres cajones: todo lo que puede una vendedora lo
 * puede un supervisor, y todo lo de un supervisor lo puede un admin.
 *
 * ⚠️ **Que sea una escalera es una decisión y hay que poder verificarla.** Con
 * tres conjuntos independientes, cada permiso nuevo obliga a decidir tres veces
 * y la tercera se olvida — que es exactamente cómo `HERMES_SUPERVISORES` y
 * `VEN_ROUTING` terminaron siendo dos listas distintas para la misma pregunta.
 * Acá el permiso se pregunta con un `>=` contra el mínimo que exige la acción.
 */

export type Rol = "admin" | "supervisor" | "vendedora";

/** Los tres, en orden y en un solo lugar. Sirve como validador y como escalera. */
export const ROLES = ["vendedora", "supervisor", "admin"] as const satisfies readonly Rol[];

/**
 * La altura de cada peldaño. Es un `Record<Rol, number>` a propósito: agregar un
 * rol sin decirle dónde va en la escalera **no compila**.
 */
export const ORDEN: Record<Rol, number> = { vendedora: 0, supervisor: 1, admin: 2 };

/** ¿Este rol llega al mínimo que la acción exige? */
export function alcanzaRol(rol: Rol, minimo: Rol): boolean {
  return ORDEN[rol] >= ORDEN[minimo];
}

/**
 * ¿Manda sobre el trabajo de las demás? Supervisor y admin.
 *
 * Es el reemplazo directo de `esSupervisor(id, env)`: lo que antes preguntaba
 * «¿está en el CSV?» ahora pregunta «¿su rol alcanza?». El nombre no dice
 * `esSupervisor` porque un admin **no** es un supervisor y responde `true` igual.
 */
export function puedeSupervisar(rol: Rol): boolean {
  return alcanzaRol(rol, "supervisor");
}

/** ¿Administra el equipo, las líneas y el ruteo? Solo admin. */
export function puedeAdministrar(rol: Rol): boolean {
  return alcanzaRol(rol, "admin");
}

/** ¿Esta cadena es uno de los tres roles? Lo que viene de la base es `text`. */
export function esRol(crudo: unknown): crudo is Rol {
  return typeof crudo === "string" && (ROLES as readonly string[]).includes(crudo);
}

/**
 * LA CLAVE CANÓNICA DE UNA PERSONA — `lower(btrim(...))`, una sola receta.
 *
 * 🔴 En producción el mismo humano tiene dos grafías vivas (`Luz` de Cerberus,
 * `luz` del login), y comparar exacto no da error: da que la persona no ve sus
 * propias filas. Es la misma normalización que `mismaVendedora`
 * (`reparto/destino.ts`), `esMiaSql` (`cola/asignadaSql.ts`) y el CHECK
 * `equipo_id_canonico_ck` de la base. **Con dos recetas, el JOIN da cero filas
 * en silencio** — que se lee como «esta persona no existe».
 */
export function clavePersona(crudo: string): string {
  return crudo.trim().toLowerCase();
}
