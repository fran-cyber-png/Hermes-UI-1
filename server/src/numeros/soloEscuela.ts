import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verificarSesion } from "../auth/sesion.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { atiendeUnaCampana } from "./campana.js";

/**
 * ESTA SUPERFICIE ES DE LA ESCUELA — el candado de las cuatro vistas que un
 * operador de campaña no tiene (Libreta, Correos, Entrenar bot; el Navegador es
 * de la cáscara y no pasa por acá). Ver `numeros/campana.ts
 * §PREFIJOS_VEDADOS_A_CAMPANA` para el porqué de cada una.
 *
 * ══ 🔴 POR QUÉ ES UN CANDADO Y NO SÓLO SACARLAS DEL RIEL ═════════════════════
 *
 * `App.tsx` las va a esconder con `soloPara`, y eso **esconde, no protege**: la
 * URL sigue existiendo y el token de campaña sigue siendo un token válido. Las
 * cuatro tienen datos propios —el playbook de venta del equipo, los correos
 * salidos del remitente de Goberna, el entrenamiento del bot de la Escuela—, así
 * que el corte tiene que estar del lado del server. Es exactamente la lección de
 * ADR 0035/0036, y la que la décima vista se podía saltear sólo porque estaba
 * vacía.
 *
 * ══ SE MONTA EN LAS CUATRO, NO GLOBAL, Y ESO ES EL COSTO ════════════════════
 *
 * Saber si alguien es de campaña cuesta una consulta a `numero_vendedora`.
 * Montado en `index.ts` delante de toda la API, esa consulta la pagarían las
 * ~40 rutas que no la necesitan, en cada request. Montado en las cuatro, la paga
 * quien entra a una de ellas — y quien nunca abre la Libreta no paga nada.
 *
 * ══ 🔴 FAIL-CLOSED, Y EL PRECIO SE DICE EN VOZ ALTA ═════════════════════════
 *
 * Si la consulta falla, esto responde **500 y no deja pasar**. El precio es real
 * y hay que reconocerlo: un parpadeo de Postgres le corta la Libreta a las
 * vendedoras de la Escuela, que son casi todos los pedidos. Se elige igual por lo
 * mismo que `vedadasDe` (`cargarLineasVedadas.ts`): **un recorte que no se pudo
 * evaluar no se adivina hacia el lado cómodo**. La alternativa —dejar pasar ante
 * la duda— convierte cada hipo de la base en una fuga del playbook de la Escuela
 * hacia el comando de un candidato, y esa fuga no deja ningún síntoma.
 *
 * ⚠️ **Nunca rechaza la promesa**: Express 4 no atrapa el rechazo de un
 * middleware `async` —se vuelve `unhandledRejection` y el proceso se cae, la
 * cicatriz de `lib/ruta.ts`—, así que acá se encadena con `.then/.catch` y el
 * error se contesta, no se tira.
 *
 * ⚠️ **Sin sesión de vendedora deja pasar.** No es laxitud: la puerta es el
 * perímetro (`auth/perimetro.ts`), que ya rechazó a cualquiera sin token antes de
 * llegar acá. Este middleware responde una pregunta distinta —«¿de qué lado
 * trabaja esta persona?»— y sin identidad no hay lado que juzgar.
 */

/** El seam: quién lee las líneas de esta persona, con su propósito. */
export type LectorDeLineasConProposito = (
  vendedoraId: string,
) => Promise<{ proposito: string }[]>;

/** El código del 403, en un solo lugar: lo lee el front para explicarlo. */
export const CODIGO_SOLO_ESCUELA = "superficie_de_la_escuela";

export const MENSAJE_SOLO_ESCUELA =
  "esta parte de Hermes es del equipo de la Escuela";

export function soloEscuela(leer: LectorDeLineasConProposito): RequestHandler {
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
        if (atiendeUnaCampana(lineas)) {
          res.status(403).json({ ok: false, codigo: CODIGO_SOLO_ESCUELA, message: MENSAJE_SOLO_ESCUELA });
          return;
        }
        next();
      })
      .catch((e: unknown) => {
        console.error(`[campaña] no se pudo resolver de qué lado trabaja «${id}» — ${porQueFallo(e)}`);
        res.status(500).json({ ok: false, message: "no se pudo resolver qué parte de Hermes te toca" });
      });
  };
}
