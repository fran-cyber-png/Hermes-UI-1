import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verificarSesion } from "../auth/sesion.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { moduloDe, type Modulo } from "./modulo.js";

/**
 * EL CANDADO DE MÓDULO — «esta superficie es de `ventas`» / «es de `campana`».
 *
 * Generaliza `numeros/soloEscuela.ts` (ADR 0061), que sabía decir una sola de las
 * dos frases porque la campaña era la excepción. Ahora los dos módulos son
 * simétricos y el mismo middleware sirve a los dos lados: lo que cambia es el
 * módulo que se le pasa al construirlo.
 *
 * ══ 🔴 POR QUÉ ES UN CANDADO Y NO SÓLO SACARLO DEL RIEL ═════════════════════
 *
 * `App.tsx` esconde las vistas con `soloPara`, y eso **esconde, no protege**: la
 * URL sigue existiendo y el token del otro módulo sigue siendo un token válido.
 * Las superficies declaradas tienen datos propios —la ficha de Cerberus con su
 * documento y sus compras, el padrón de 73.091 contactos, el playbook de venta
 * del equipo—, así que el corte tiene que estar del lado del server. Es la
 * lección de ADR 0035/0036: un recorte dibujado en el navegador no existe, los
 * datos ya viajaron.
 *
 * ══ SE MONTA POR SUPERFICIE, NO GLOBAL, Y ESO ES EL COSTO ═══════════════════
 *
 * Saber de qué módulo es alguien cuesta una consulta a `numero_vendedora`.
 * Montado en `index.ts` delante de toda la API, esa consulta la pagarían las
 * ~40 rutas del motor que no la necesitan, en cada request. Montado por
 * superficie, la paga quien entra a una declarada — y quien sólo trabaja la cola
 * no paga nada.
 *
 * ══ 🔴 FAIL-CLOSED, Y EL PRECIO SE DICE EN VOZ ALTA ═════════════════════════
 *
 * Si la consulta falla, esto responde **500 y no deja pasar**. El precio es real:
 * un parpadeo de Postgres le corta la ficha a las vendedoras, que son casi todos
 * los pedidos. Se elige igual por lo mismo que `vedadasDe`
 * (`numeros/cargarLineasVedadas.ts`): **un recorte que no se pudo evaluar no se
 * adivina hacia el lado cómodo**. La alternativa —dejar pasar ante la duda—
 * convierte cada hipo de la base en una fuga del padrón de la Escuela hacia el
 * comando de un candidato, y esa fuga no deja ningún síntoma.
 *
 * Y por eso el error se atrapa ACÁ y no adentro de `moduloDe`: esa función tiene
 * un default (`ventas`) que existe para la vendedora sin líneas, no para una
 * lectura que no se pudo hacer. Confundir los dos casos es exactamente cómo un
 * fail-closed se vuelve fail-open sin que cambie una línea de este archivo.
 *
 * ⚠️ **Nunca rechaza la promesa**: Express 4 no atrapa el rechazo de un
 * middleware `async` —se vuelve `unhandledRejection` y el proceso se cae, la
 * cicatriz de `lib/ruta.ts`—, así que acá se encadena con `.then/.catch` y el
 * error se contesta, no se tira.
 *
 * ⚠️ **Sin sesión de vendedora deja pasar.** No es laxitud: la puerta es el
 * perímetro (`auth/perimetro.ts`), que ya rechazó a cualquiera sin token antes
 * de llegar acá. Este middleware responde una pregunta distinta —«¿de qué lado
 * del negocio trabaja esta persona?»— y sin identidad no hay lado que juzgar.
 */

/** El seam: quién lee las líneas de esta persona, con su propósito. */
export type LectorDeLineasConProposito = (
  vendedoraId: string,
) => Promise<{ proposito: string }[]>;

/** El código del 403, en un solo lugar: lo lee el front para explicarlo. */
export const CODIGO_OTRO_MODULO = "otro_modulo_del_crm";

/**
 * Qué se le dice a la persona. **Nombra el módulo al que SÍ pertenece la
 * superficie, nunca el suyo**: «esto es de ventas» le dice dónde está parada;
 * «vos sos de campaña» le informa algo que ya sabe y no explica el 403.
 */
export function mensajeDeOtroModulo(modulo: Modulo): string {
  return modulo === "ventas"
    ? "esta parte de Hermes es del módulo de ventas"
    : "esta parte de Hermes es del módulo de campañas";
}

export function deEsteModulo(
  modulo: Modulo,
  leer: LectorDeLineasConProposito,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const id = token ? verificarSesion(token) : null;
    if (!id) {
      next();
      return;
    }
    leer(id)
      .then((lineas) => {
        if (moduloDe(lineas) !== modulo) {
          res.status(403).json({
            ok: false,
            codigo: CODIGO_OTRO_MODULO,
            modulo,
            message: mensajeDeOtroModulo(modulo),
          });
          return;
        }
        next();
      })
      .catch((e: unknown) => {
        console.error(
          `[módulos] no se pudo resolver de qué lado trabaja «${id}» — ${porQueFallo(e)}`,
        );
        res.status(500).json({ ok: false, message: "no se pudo resolver qué parte de Hermes te toca" });
      });
  };
}
