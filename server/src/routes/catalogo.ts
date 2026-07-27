import { Router, type Response } from "express";
import { requiereServicioDeCatalogo } from "../auth/servicio.js";
import { leerPiezas } from "../catalogo/repositorio.js";
import { CLASES_DE_PIEZA, type ClasePieza, type Pieza } from "../catalogo/pieza.js";
import { vocabularioPublicado } from "../catalogo/vocabulario.js";

/**
 * EL CATÁLOGO DE PIEZAS — `GET /api/catalogo/piezas` (H8) y
 * `GET /api/catalogo/vocabulario` (H9). Solo lectura, y para una MÁQUINA.
 *
 * ══ QUIÉN ENTRA, Y POR QUÉ NO ES `requiereVendedora` ════════════════════════
 *
 * Lo consume Ivi, que es un proceso: indexa el catálogo de noche, sin nadie
 * sentado adelante. No hay vendedora que haya hecho login, así que exigir su
 * HMAC obligaría a fabricarle una sesión eterna a un servicio — una credencial
 * de persona en manos de una máquina, que después nadie sabe a quién echar.
 * Va detrás de la credencial de SERVICIO, la misma familia que usa Cerberus
 * (`auth/servicio.ts`), con su propio secreto.
 *
 * ══ LA REGLA QUE ORDENA TODO ESTE ARCHIVO ═══════════════════════════════════
 *
 * > **Si el catálogo no se puede servir, error. NUNCA una lista vacía.**
 *
 * Sale de una cicatriz de Ivi (su ADR 0002): un `{"ok": true}` con ceros les
 * costó semanas, porque un 200 con contenido vacío es indistinguible de «no hay
 * nada» y se cachea como catálogo bueno. Acá eso son dos guardas:
 *
 *   · el lector explota (base caída, tabla que falta) → **503** y sin `piezas`;
 *   · el lector devuelve cero piezas → **500**. Las piezas de código
 *     (acuses + ganchos) no dependen de la base: si no hay NI UNA, no es un
 *     catálogo pobre, es un bug de este server. Decir «no hay nada» sería
 *     mentir con más confianza.
 *
 * El único vacío legítimo es el de un FILTRO, y va marcado con `filtrado: true`
 * para que del otro lado no se confunda con el catálogo.
 */

export type LeerPiezas = () => Promise<Pieza[]>;

function error(res: Response, status: number, motivo: string, mensaje: string): void {
  res.status(status).json({ error: { motivo, mensaje } });
}

function esClase(v: string): v is ClasePieza {
  return (CLASES_DE_PIEZA as readonly string[]).includes(v);
}

/**
 * El singleton de `db/client.ts` se importa TARDE, dentro de la función, y no
 * arriba: ese módulo exige `DATABASE_URL` al cargarse, y los tests puros del
 * server corren sin base (CI no les da la variable). Importarlo arriba haría
 * que este archivo no se pueda ni abrir en un test.
 */
async function leerDelSingleton(): Promise<Pieza[]> {
  const { db } = await import("../db/client.js");
  return leerPiezas(db);
}

/**
 * El lector va INYECTADO (patrón de `iviRouter`): producción le pasa el
 * singleton, el test le pasa uno que explota — que es la única forma honesta de
 * probar «con la base caída» sin apagar una base.
 */
export function catalogoRouter(leer: LeerPiezas = leerDelSingleton): Router {
  const router = Router();
  router.use(requiereServicioDeCatalogo);

  /** El vocabulario compartido. NO toca la base: es código, y no puede fallar por Postgres. */
  router.get("/vocabulario", (_req, res) => {
    res.json(vocabularioPublicado());
  });

  router.get("/piezas", async (req, res) => {
    const claseCruda = typeof req.query.clase === "string" ? req.query.clase : "";
    if (claseCruda && !esClase(claseCruda)) {
      // Una clase que no existe se dice, no se devuelve vacía: un filtro con un
      // typo que responde `[]` es otra forma de la misma mentira.
      error(
        res,
        400,
        "clase_desconocida",
        `«${claseCruda}» no es una clase de pieza. Las que hay: ${CLASES_DE_PIEZA.join(", ")}`,
      );
      return;
    }
    const vendedora = typeof req.query.vendedora === "string" ? req.query.vendedora : "";

    let piezas: Pieza[];
    try {
      piezas = await leer();
    } catch (err) {
      // Ruidoso de los dos lados: 503 para quien preguntó, y el motivo real en
      // los logs de este server (nunca en la respuesta: no se filtra plomería).
      console.error("[catalogo] no se pudo leer el catálogo de piezas:", err);
      error(
        res,
        503,
        "catalogo_indisponible",
        "el catálogo no se pudo leer. Es un fallo, NO un catálogo vacío: no lo caches.",
      );
      return;
    }

    if (piezas.length === 0) {
      console.error("[catalogo] el catálogo salió VACÍO — ni las piezas de código están");
      error(
        res,
        500,
        "catalogo_vacio",
        "el catálogo salió vacío, y eso no puede pasar: las piezas de código existen siempre. Es un bug de Hermes.",
      );
      return;
    }

    const filtradas = piezas.filter(
      (p) =>
        (!claseCruda || p.clase === claseCruda) &&
        // Lo del negocio siempre entra: filtrar por vendedora acota lo PERSONAL
        // (sus plantillas), no le esconde los hechos ni los acuses.
        (!vendedora || p.alcance === "negocio" || p.propietario === vendedora),
    );

    res.json({
      generadoEn: new Date().toISOString(),
      vocabulario: vocabularioPublicado(),
      /** `true` = la lista pasó por un filtro de quien preguntó, no es el catálogo entero. */
      filtrado: Boolean(claseCruda || vendedora),
      total: filtradas.length,
      piezas: filtradas,
    });
  });

  return router;
}
