import { supervisoresConfigurados } from "../padron/supervisor.js";
import { clavePersona, type Rol } from "./roles.js";

/**
 * DE DÓNDE SALE EL ROL DE QUIEN ESTÁ PIDIENDO — la cascada, pura.
 *
 * ══ POR QUÉ UNA CASCADA Y NO «leé la tabla» ══════════════════════════════════
 *
 * La tabla `equipo` nace vacía y llega a producción por N5 (un botón), mientras
 * que el código del front viaja por N4 (automático, sin restart). O sea que
 * existe de verdad una ventana en la que el código nuevo corre contra una base
 * sin la migración — y otra en la que la migración está pero la siembra todavía
 * no corrió. En las dos, «leé la tabla» significa «nadie tiene rol», que con
 * fail-closed es «nadie ve nada»: sin 403 raro, sin log, sin nada que
 * investigar. Por eso los CSV del `.env` siguen valiendo como respaldo mientras
 * dure la mudanza, y apagarlos es un paso posterior y explícito.
 *
 * ══ 🔴 LOS DOS MODOS DE FALLA NO SON EL MISMO, Y COLAPSARLOS ABRE LA COLA ═════
 *
 * | Situación                          | Rol                        | Frontera  |
 * |------------------------------------|----------------------------|-----------|
 * | `HERMES_ADMINS` tiene el id        | `admin`, `porBreakGlass`   | sin recorte |
 * | Hay fila activa                    | su `rol`                   | según el rol |
 * | Sin fila, pero está en el CSV      | `supervisor` (transitorio) | sin recorte |
 * | Sin fila y sin CSV                 | `vendedora`                | recortada |
 * | **Tabla ausente** (falta migrar)   | cascada al `.env`, `sinTablaDeEquipo` | **APAGADA** |
 * | **Consulta fallida** (blip)        | `vendedora`, `rolNoResuelto`          | **ENCENDIDA** |
 *
 * Las dos últimas filas se parecen y son opuestas. Si un blip de Postgres se
 * tratara como «falta la migración», la frontera de la cola se APAGARÍA en cada
 * hipo de la base: el día que los CSV ya no estén, eso significa **la cola
 * entera de Luz —2.591 conversaciones— servida a cualquier token** por unos
 * segundos, sin un solo error visible. Y al revés, tratar la falta de migración
 * como un blip dejaría a todo el mundo recortado a sus asignadas justo en el
 * despliegue en que la tabla todavía no existe.
 *
 * Por eso son dos banderas distintas con dos nombres distintos, y hay un test
 * que se pone rojo si alguien las unifica.
 *
 * ══ EL BREAK-GLASS VA PRIMERO, INCLUSO CON LA BASE CAÍDA ═════════════════════
 *
 * `HERMES_ADMINS` es el martillo detrás del vidrio: la puerta que queda cuando
 * la tabla dice que nadie es admin —porque no se sembró, porque alguien se
 * degradó a sí mismo, o porque la base no contesta—. Justamente por eso se
 * resuelve ANTES de mirar la lectura: una emergencia que depende de que la base
 * conteste no es una salida de emergencia. El precio es que quien esté en esa
 * variable manda siempre, y por eso la resolución lo DICE (`porBreakGlass`) para
 * que se pueda anotar en `equipo_bitacora` en vez de pasar desapercibido.
 */

/**
 * El nombre de la variable del break-glass, en un solo lugar (regla dura #1).
 *
 * ⚠️ La de supervisores **no se redeclara acá**: se importa de
 * `padron/supervisor.ts` junto con su parser. Dos constantes con el mismo valor
 * son dos cosas que hay que acordarse de borrar el día que los CSV se apaguen, y
 * la que sobreviva va a seguir dando permisos que la pantalla ya no muestra.
 */
export const ENV_ADMINS = "HERMES_ADMINS";

/** Qué pudo leerse de la tabla `equipo` para esta persona. */
export type EstadoDeLectura = "ok" | "sin_tabla" | "fallo";

export interface FilaDeEquipo {
  personaId: string;
  nombre: string;
  rol: Rol;
  activa: boolean;
}

export interface LecturaDeEquipo {
  estado: EstadoDeLectura;
  /** La fila de esta persona, o `null` si no está. Siempre `null` si no es `ok`. */
  fila: FilaDeEquipo | null;
}

/** De dónde salió el rol. Es para el log y para la pantalla, no para decidir. */
export type FuenteDelRol = "break-glass" | "tabla" | "env-supervisores" | "default" | "fallo";

export interface RolResuelto {
  /** La forma canónica del id de quien pide (`lower(btrim(...))`). */
  personaId: string;
  rol: Rol;
  fuente: FuenteDelRol;
  /** Entró por `HERMES_ADMINS`, no por la tabla. Se anota, no se esconde. */
  porBreakGlass: boolean;
  /** La tabla `equipo` no existe todavía: la migración no está aplicada. */
  sinTablaDeEquipo: boolean;
  /** La consulta falló por otra cosa (un blip). NO es lo mismo que lo de arriba. */
  rolNoResuelto: boolean;
  /** Hay fila y está dada de baja. Distinto de «no hay fila». */
  desactivada: boolean;
}

/**
 * Quién puede entrar rompiendo el vidrio. Vacío = nadie (fail-closed).
 *
 * Mismo parseo que la lista de supervisores —de hecho es la misma función, con
 * otra variable— porque las dos son «un CSV de ids tal como se escribieron»: la
 * grafía se conserva y la comparación normaliza los dos lados.
 */
export function adminsConfigurados(env: NodeJS.ProcessEnv): string[] {
  return supervisoresConfigurados(env, ENV_ADMINS);
}

/** ¿Este id (ya canónico) está en un CSV del entorno? Normaliza los DOS lados. */
function estaEn(lista: readonly string[], canonico: string): boolean {
  if (!canonico) return false;
  return lista.some((s) => clavePersona(s) === canonico);
}

/**
 * EL ROL DE QUIEN PIDE, resuelto una vez por request.
 *
 * Puro: recibe el entorno y lo que se pudo leer de la base; no consulta nada ni
 * lee `process.env` por su cuenta. Eso es lo que permite testear las seis ramas
 * —incluidas las dos de falla— sin levantar Postgres.
 */
export function resolverRol(
  idCrudo: string,
  lectura: LecturaDeEquipo,
  env: NodeJS.ProcessEnv,
): RolResuelto {
  const personaId = clavePersona(idCrudo);
  const base = {
    personaId,
    porBreakGlass: false,
    sinTablaDeEquipo: false,
    rolNoResuelto: false,
    desactivada: false,
  };

  // 1. El martillo detrás del vidrio, ANTES de mirar la base: una salida de
  //    emergencia que depende de que la base conteste no es una salida.
  if (estaEn(adminsConfigurados(env), personaId)) {
    return { ...base, rol: "admin", fuente: "break-glass", porBreakGlass: true };
  }

  // 2. Un blip de la base NO es «falta la migración». Se degrada a lo más
  //    estricto y se dice cuál de las dos cosas pasó — ver el docblock.
  if (lectura.estado === "fallo") {
    return { ...base, rol: "vendedora", fuente: "fallo", rolNoResuelto: true };
  }

  // 3. La tabla existe y esta persona tiene fila: manda la fila.
  if (lectura.estado === "ok" && lectura.fila) {
    if (!lectura.fila.activa) {
      // Dada de baja: `vendedora` y NO se cae al CSV. Una baja tiene que poder
      // sacar poder; si el CSV la resucitara, dar de baja sería decorativo.
      return { ...base, rol: "vendedora", fuente: "tabla", desactivada: true };
    }
    return { ...base, rol: lectura.fila.rol, fuente: "tabla" };
  }

  // 4. Sin fila (o sin tabla): el CSV transitorio. `sinTablaDeEquipo` viaja para
  //    que la frontera de la cola sepa que todavía no hay de dónde sacar el rol.
  const sinTablaDeEquipo = lectura.estado === "sin_tabla";
  if (estaEn(supervisoresConfigurados(env), personaId)) {
    return { ...base, rol: "supervisor", fuente: "env-supervisores", sinTablaDeEquipo };
  }
  return { ...base, rol: "vendedora", fuente: "default", sinTablaDeEquipo };
}

/**
 * EL ROL DE UN PEDIDO SIN IDENTIDAD — fail-closed y explícito.
 *
 * No es «cualquiera»: es el valor con el que un consumidor puede razonar sin
 * ramas cuando `cargarRol` no anotó nada (un token de servicio, un test que
 * monta un router suelto). `vendedora` con `rolNoResuelto` porque eso es
 * exactamente lo que pasó: no se pudo resolver.
 */
export const SIN_IDENTIDAD: RolResuelto = {
  personaId: "",
  rol: "vendedora",
  fuente: "fallo",
  porBreakGlass: false,
  sinTablaDeEquipo: false,
  rolNoResuelto: true,
  desactivada: false,
};

/**
 * ¿LA FRONTERA DE LA COLA SE APLICA EN ESTE PEDIDO?
 *
 * Es la traducción de las dos últimas filas de la tabla del docblock, y la razón
 * por la que las dos banderas existen separadas. **Nadie la consume todavía**:
 * el predicado de la cola se gobierna por el rol en un paso posterior (la
 * frontera con cláusula de línea vive hoy en `cola/consultarCola.ts` y se está
 * reescribiendo en paralelo). Está acá —con su test— para que ese paso encuentre
 * la decisión ya tomada y no la vuelva a tomar en un `if` adentro del SQL.
 */
export function laFronteraSeAplica(r: RolResuelto): boolean {
  // Sin tabla no hay de dónde sacar el rol de nadie: la cola se comporta como
  // antes de este frente. Un blip, en cambio, deja la frontera PUESTA.
  return !r.sinTablaDeEquipo;
}
