import "dotenv/config";
import { ingestarDump } from "../fuentes/cerberus.js";
import { proyectarCerberus } from "../ontologia/proyectar.js";
import { correrLazo } from "../lazo/worker.js";

/**
 * Los dos comandos del lazo.
 *
 *   npm run cerberus:ingestar -- ruta/al/dump.sql   → espejo crudo
 *   npm run lazo -- --simular                        → evalúa y guarda, SIN mandarle nada a Meta
 *   npm run lazo                                     → manda de verdad
 *
 * SEGURIDAD: si `META_TEST_EVENT_CODE` está seteado, TODO va a la pestaña Test Events de Events
 * Manager y NO afecta la optimización de los anuncios. Es el modo con el que hay que probar
 * primero, siempre. Sin ese código, cada evento es real y entra al modelo de Meta.
 */

const [comando, ...args] = process.argv.slice(2);

async function main() {
  if (comando === "ingestar") {
    const ruta = args[0];
    if (!ruta) {
      console.error("Falta la ruta del dump.\n  npm run cerberus:ingestar -- /ruta/dump.sql");
      process.exit(1);
    }

    console.log(`Leyendo ${ruta}...`);
    const r = await ingestarDump(ruta);

    console.log(`\n${r.total.toLocaleString("es")} filas en ${(r.duracionMs / 1000).toFixed(1)}s\n`);
    for (const [tabla, n] of Object.entries(r.porTabla).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${tabla.padEnd(20)} ${n.toLocaleString("es").padStart(8)}`);
    }
    if (r.faltantes.length) {
      console.log(`\n⚠ No se encontraron en el dump: ${r.faltantes.join(", ")}`);
    }

    // El espejo crudo cambió: se rehace la capa canónica (venta/pago/cuota/cliente/producto) para
    // que todos los análisis vean el dato nuevo, con la semántica resuelta en un solo lugar.
    const p = await proyectarCerberus();
    console.log(
      `\nProyección canónica: ${p.ventas.toLocaleString("es")} ventas · ${p.clientes.toLocaleString("es")} clientes · ${p.pagos.toLocaleString("es")} pagos`,
    );
    return;
  }

  if (comando === "lazo") {
    const simular = args.includes("--simular");
    const r = await correrLazo({ soloRegistrar: simular });

    console.log(`\n${simular ? "SIMULACIÓN — no se mandó nada a Meta" : "EL LAZO"}`);
    if (r.esPrueba) console.log("Modo TEST EVENTS: no afecta la optimización de los anuncios.\n");

    console.log(`  Ventas evaluadas : ${r.evaluadas.toLocaleString("es")}`);
    console.log(`  Listas para Meta : ${r.aEnviar.toLocaleString("es")}`);
    if (!simular) console.log(`  Enviadas         : ${r.enviadas.toLocaleString("es")}`);

    console.log(`\n  POR QUÉ LAS DEMÁS NO VAN:`);
    const etiquetas: Record<string, string> = {
      historico: "confirmada hace +30 días — es historia, va a la audiencia de valor",
      venta_no_valida: "anulada o cotización (nunca fue compra)",
      estado_no_pagado: "retirada o reembolsada (se arrepintió)",
      sin_confirmacion: "Tesorería todavía no confirmó el voucher",
      fuera_de_ventana: "⚠ Tesorería confirmó tarde — Meta la RECHAZA",
      sin_identidad: "sin correo ni teléfono válidos",
      valor_invalido: "monto cero o negativo",
    };
    for (const [motivo, n] of Object.entries(r.descartes)) {
      if (n === 0) continue;
      const pct = ((100 * n) / r.evaluadas).toFixed(1);
      console.log(`    ${String(n).padStart(6)}  (${pct.padStart(4)}%)  ${etiquetas[motivo]}`);
    }

    const perdidas = r.descartes.fuera_de_ventana;
    if (perdidas > 0) {
      console.log(
        `\n  ⚠ ${perdidas.toLocaleString("es")} ventas reales que Meta NUNCA va a ver, porque el` +
          `\n    voucher se confirmó después de los 7 días que acepta.` +
          `\n    Eso no se arregla con código: se arregla confirmando más rápido.`,
      );
    }

    if (r.errores.length) {
      console.log(`\n  ERRORES DE META:`);
      for (const e of [...new Set(r.errores)]) console.log(`    ${e}`);
    }
    return;
  }

  console.error("Comandos: ingestar <ruta> | lazo [--simular]");
  process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
