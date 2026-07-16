import { z } from "zod";
import { latenciaTesoreria } from "../../analisis/comercial.js";
import { relojDeTesoreria } from "../../canales/tesoreria.js";
import { VENTANA_CAPI_DIAS } from "../../lazo/evento.js";
import { registrar } from "../registro.js";

/**
 * TESORERÍA — donde el Capability Registry inventó una regla que no existe.
 *
 * `cq-tesoreria-010`, crítica y con confianza 0.97, afirmaba que "Tesorería tiene un máximo de 7
 * días hábiles para confirmar". No existe tal SLA: `canales/tesoreria.ts:15-17` lo dejó probado
 * por grep (`dias_pendiente`, `SLA`, `antiguedad` → cero resultados en todo el repo). La ausencia
 * de SLA no es un detalle: es la tesis de esa pantalla.
 *
 * Lo más probable es que la CQ se contaminó con la ventana de 7 días de META y la convirtió en
 * una regla de Cerberus. Son cosas distintas: una es el límite de un tercero, la otra sería una
 * política interna. Confundirlas hace creer que hay un proceso donde solo hay un vacío.
 */

const SIN_ENTRADA = z.object({});

registrar({
  nombre: "governa.tesoreria.latencia",
  descripcion:
    "Cuánto tarda Tesorería en confirmar un voucher: p50, p90, cuántos pasan la ventana de Meta " +
    "y cuántos pagos nunca se confirmaron. NO existe un SLA — esto es lo observado, no una regla.",
  entrada: SIN_ENTRADA,
  idempotente: true,
  cqIds: ["cq-tesoreria-010"],
  fuentes: ["analisis/comercial.ts:121", "canales/tesoreria.ts:15-17"],
  ejecutar: async () => {
    const l = await latenciaTesoreria();
    return {
      ...l,
      /**
       * La respuesta honesta a "¿cuánto tiempo tiene Tesorería?" es "ninguno, y ese es el
       * problema". Va en la salida, no en una nota al pie: es lo que la CQ tenía mal.
       */
      slaDefinido: false,
      ventanaDeMetaDias: VENTANA_CAPI_DIAS,
      porQue:
        "Cerberus no define ningún plazo para confirmar un voucher: no hay columna de antigüedad, " +
        "ni alerta, ni SLA (verificado por grep en todo el repo). El único plazo real es externo: " +
        `los ${VENTANA_CAPI_DIAS} días de Meta. Los percentiles de acá son lo que TARDA, no lo ` +
        "que debería tardar.",
      /**
       * `sinConfirmar` no es un dato de color: sin él, decir "el p90 es 10 días" es cierto y
       * engañoso al mismo tiempo, porque los pagos que nunca se confirmaron son, por definición,
       * los peores — y no están en ningún percentil. Ver `analisis/comercial.ts:114-119`.
       */
      advertencia:
        l.sinConfirmar > 0
          ? `Los percentiles se calculan sobre ${l.total} pagos con fecha de confirmación. Hay ` +
            `${l.sinConfirmar} pagos válidos SIN esa fecha, que no entran en ningún percentil. ` +
            "El p90 puede ser optimista justamente por eso."
          : null,
    };
  },
});

registrar({
  nombre: "governa.tesoreria.reloj",
  descripcion:
    "Los vouchers esperando confirmación, del más viejo al más nuevo, con las horas que le " +
    "quedan a cada uno antes de que Meta ya no acepte el evento. Es la lista accionable de hoy.",
  entrada: SIN_ENTRADA,
  idempotente: true,
  fuentes: ["canales/tesoreria.ts:87"],
  ejecutar: () => relojDeTesoreria(),
});
