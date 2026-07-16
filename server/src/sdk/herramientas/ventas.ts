import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { ESTADOS_COMPRA } from "../../dominio/estadosVenta.js";
import { registrar } from "../registro.js";

/**
 * VENTAS — el dominio donde el Capability Registry se equivocaba.
 *
 * `cq-ventas-002`, marcada crítica y con confianza 0.98, afirmaba que los estados eran
 * "1=vendido, 2=señado, 3=confirmado, 4=en_curso, 5=retirado, 6=suspendido, 7=anulado". Todos
 * los mapeos estaban mal, y esa falsedad era exportable como dataset de LoRA.
 *
 * Esta Herramienta es la que la reemplaza: la respuesta se DERIVA del código, no se escribe.
 */

registrar({
  nombre: "governa.ventas.estados",
  descripcion:
    "Los estados posibles de una venta en Cerberus: su código, su nombre, qué significan para el " +
    "negocio (cobrada / en_proceso / anulada / reembolsada / otro) y cuántas ventas tiene cada " +
    "uno ahora mismo en el espejo.",
  entrada: z.object({}),
  idempotente: true,
  cqIds: ["cq-ventas-002"],
  fuentes: ["dominio/estadosVenta.ts:79", "docs/02-CERBERUS.md:56", "lazo/evento.ts:51-55"],
  ejecutar: async () => {
    /**
     * La EVIDENCIA se cuenta en vivo, no se hornea en un comentario.
     *
     * El mapa de `dominio/estadosVenta.ts` es estable; los conteos no. Si esta Tool repitiera los
     * números del comentario, envejecería igual que la CQ que vino a reemplazar — y el problema
     * de origen no era el mapa: era afirmar sin verificar.
     */
    const filas = (await db.execute(sql`
      SELECT (payload->>'estado')::int              AS estado,
             count(*)::int                          AS ventas,
             min((payload->>'fecha_venta')::date)   AS desde,
             max((payload->>'fecha_venta')::date)   AS hasta
      FROM fuentes.registro
      WHERE fuente = 'cerberus' AND tabla = 'tb_venta'
      GROUP BY 1
    `)) as unknown as { estado: number; ventas: number; desde: string; hasta: string }[];

    const porEstado = new Map(filas.map((f) => [f.estado, f]));
    const total = filas.reduce((s, f) => s + f.ventas, 0);

    const estados = ESTADOS_COMPRA.map((e) => {
      const visto = porEstado.get(e.codigo);
      return {
        codigo: e.codigo,
        nombre: e.nombre,
        semantica: e.semantica,
        /**
         * `observado` es lo que dice el mapa; `ventas` es lo que dicen los datos hoy. Cuando
         * discrepan, el mapa está desactualizado — y eso es exactamente lo que hay que poder ver.
         */
        observadoEnElMapa: e.observado,
        ventas: visto?.ventas ?? 0,
        desde: visto?.desde ?? null,
        hasta: visto?.hasta ?? null,
      };
    });

    // Un estado que Cerberus manda y nadie modeló. Hoy no hay ninguno; si aparece uno mañana,
    // esta Tool lo grita en vez de tragárselo en el bucket "otro".
    const sinModelar = filas
      .filter((f) => !ESTADOS_COMPRA.some((e) => e.codigo === f.estado))
      .map((f) => ({ codigo: f.estado, ventas: f.ventas }));

    return {
      estados,
      total,
      sinModelar,
      /**
       * La respuesta corta, para quien pregunta "¿cuáles son los estados?" y no quiere una tabla.
       * Se arma de los datos, así que no puede mentir sobre el conteo — que es justo donde la CQ
       * fallaba: decía "los 7 estados" cuando en producción hay 8.
       */
      resumen: estados
        .filter((e) => e.ventas > 0)
        .map((e) => `${e.codigo}=${e.nombre}`)
        .join(", "),
    };
  },
});
