import { z } from "zod";
import { lazoDetalle } from "../../canales/lazoDetalle.js";
import { estadoDelLazo } from "../../canales/verdad.js";
import { HISTORICO_DIAS, VENTANA_CAPI_DIAS } from "../../lazo/evento.js";
import { registrar } from "../registro.js";

/**
 * EL LAZO — ¿Meta sabe que vendimos?
 *
 * Es la razón de ser del sistema (`docs/00-OVERVIEW.md:13`: "Goberna paga por traer gente y nunca
 * le dice a Meta quién compró"), así que es el primer dominio que se expone como Herramientas.
 */

const SIN_ENTRADA = z.object({});

registrar({
  nombre: "governa.lazo.ventanaCapi",
  descripcion:
    "Cuántos días acepta Meta un evento de conversión hacia atrás (event_time), y a partir de " +
    "cuántos días una venta deja de ser un fracaso recuperable y pasa a ser histórico.",
  entrada: SIN_ENTRADA,
  idempotente: true,
  cqIds: ["cq-lazo-004"],
  fuentes: ["lazo/evento.ts:18", "lazo/evento.ts:33"],
  ejecutar: () => ({
    ventanaCapiDias: VENTANA_CAPI_DIAS,
    historicoDias: HISTORICO_DIAS,
    /**
     * Las dos constantes juntas responden la pregunta completa, que no es solo "¿cuántos días?".
     * Sin la segunda, el contador de "fuera de ventana" mezcla una venta de hace 6 meses (que
     * nunca iba a entrar) con una de hace 10 días (que Tesorería tardó) — y ese número acusa a
     * Tesorería de algo que no hizo, y además nunca baja. Ver `lazo/evento.ts:20-32`.
     */
    porQue:
      `Meta descarta sin avisar un evento con event_time de más de ${VENTANA_CAPI_DIAS} días. ` +
      `Más allá de ${HISTORICO_DIAS} días la venta se considera histórico, no una pérdida ` +
      `recuperable: va a la audiencia de valor, que no tiene ventana de tiempo.`,
  }),
});

registrar({
  nombre: "governa.lazo.estado",
  descripcion:
    "El estado del lazo con Meta: cuántas ventas conocemos, cuántas le reportamos y cuántas se " +
    "perdieron por la ventana. Responde si Meta se está enterando de que Goberna vende.",
  entrada: SIN_ENTRADA,
  idempotente: true,
  cqIds: ["cq-lazo-002"],
  fuentes: ["canales/verdad.ts:88"],
  ejecutar: () => estadoDelLazo(),
});

registrar({
  nombre: "governa.lazo.detalle",
  descripcion:
    "El detalle del envío a Meta: por qué cada venta va o no va, si el último envío fue de " +
    "prueba o real, y las que Meta rechazó con el error a la vista.",
  entrada: SIN_ENTRADA,
  idempotente: true,
  fuentes: ["canales/lazoDetalle.ts:37"],
  ejecutar: () => lazoDetalle(),
});
