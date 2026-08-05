import { Router } from "express";
import { esSupervisor, supervisoresConfigurados } from "../padron/supervisor.js";
import { ErrorDeMeta, traerPlantillasDeMeta } from "../campana/metaPlantillas.js";

/**
 * LAS PLANTILLAS DE WHATSAPP — solo lectura, y solo para el supervisor.
 *
 * ══ POR QUÉ DETRÁS DE LA MISMA PUERTA QUE EL PADRÓN ═════════════════════════
 *
 * Una campaña le escribe a mil personas desde el número del negocio. Quién puede
 * armar una es la misma clase de decisión que quién ve los 72.923 contactos, y
 * por eso reusa `esSupervisor` en vez de inventar un segundo rol: dos listas de
 * permisos divergen, y la que se olvide de actualizar es la que abre el agujero.
 *
 * **Fail-closed**, igual que el padrón: sin `HERMES_SUPERVISORES` nadie entra, y
 * la respuesta lo DICE (`sinSupervisores`) en vez de devolver una lista vacía.
 * Una pantalla en blanco se lee «no hay plantillas», no «falta configurar esto».
 *
 * ══ POR QUÉ NO HAY UNA TABLA DE PLANTILLAS ══════════════════════════════════
 *
 * Porque Meta ya es esa tabla, y es la única que sabe la verdad: aprueba,
 * rechaza, pausa por calidad y deshabilita — todo sin avisarnos. Una copia
 * nuestra sería un caché que puede decir «aprobada» sobre algo que Meta pausó
 * hace dos horas, y actuar sobre eso cuesta un `132015` por destinatario.
 *
 * Lo que sí guardamos es el CUERPO en el momento del envío (`envios_wa.texto`) y
 * la versión de la pieza (ADR 0022): eso es historia, no estado, y por eso no
 * envejece.
 *
 * ══ LO QUE ESTA RUTA NO HACE, A PROPÓSITO ═══════════════════════════════════
 *
 * **No manda nada.** Es la contracara de la frase del padrón («repartir NO manda
 * nada»): acá se mira el catálogo y su salud, y el envío es otro frente con sus
 * propios frenos. Un `GET` que además pudiera disparar sería la puerta por la
 * que la excepción a «un envío = una acción humana» se estira sola.
 */
export const campanaRouter: Router = Router();

/** Meta no responde al instante y la pantalla no puede quedarse colgada. */
function seRindio(res: Parameters<Parameters<Router["get"]>[1]>[1], e: unknown) {
  const codigo = e instanceof ErrorDeMeta ? e.codigo : "desconocido";
  /**
   * ⚠️ **Un fallo NUNCA se muestra como «no hay plantillas».**
   *
   * Es la cicatriz de ADR 0023 en su forma más cara: si esta ruta devolviera
   * `{plantillas: []}` cuando Meta no contesta, la pantalla diría que no hay
   * ninguna aprobada — y la reacción razonable a eso es ir a crear una que ya
   * existe. El estado 502 con su código es lo que hace que se lea «no se pudo
   * preguntar».
   */
  res.status(502).json({
    ok: false,
    motivo: "meta_indisponible",
    codigo,
    message:
      codigo === "sin_permiso"
        ? "El token no tiene permiso para leer las plantillas (falta el scope whatsapp_business_management)."
        : codigo === "falta_config"
          ? "Falta META_WABA_ID o META_ACCESS_TOKEN en el entorno."
          : "No se le pudo preguntar a Meta por las plantillas.",
  });
}

/**
 * EL CATÁLOGO CON SU SALUD.
 *
 * Devuelve cada plantilla con su estado leído en criollo, si se puede mandar, y
 * su calidad. Los tres datos que decide una persona antes de armar una campaña:
 * ¿existe? ¿la puedo usar? ¿está sana?
 */
campanaRouter.get("/plantillas", async (req, res) => {
  if (!esSupervisor(req.vendedoraId ?? "", process.env)) {
    res.status(403).json({
      ok: false,
      motivo: "no_es_supervisor",
      sinSupervisores: supervisoresConfigurados(process.env).length === 0,
      message: "las campañas las arma un supervisor",
    });
    return;
  }
  try {
    const plantillas = await traerPlantillasDeMeta();
    res.json({
      plantillas,
      /**
       * Los conteos van servidos y no se recalculan en el navegador: son la
       * misma clase de dato que el `vistaPrevia` de los hechos — si la pantalla
       * los derivara por su cuenta, dos cabezas podrían divergir sobre qué
       * cuenta como «usable» (#37).
       */
      resumen: {
        total: plantillas.length,
        enviables: plantillas.filter((p) => p.enviable).length,
        conProblema: plantillas.filter((p) => p.lectura.tono === "problema").length,
      },
    });
  } catch (e) {
    seRindio(res, e);
  }
});
