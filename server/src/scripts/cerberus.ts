import "dotenv/config";
import { ingestarDump } from "../fuentes/cerberus.js";
import { proyectarCerberus } from "../ontologia/proyectar.js";
import { proyectarHechos } from "../ontologia/proyectarHechos.js";
import { poblarIdentidad } from "../ontologia/poblarIdentidad.js";
import { correrLazo } from "../lazo/worker.js";

/**
 * Los comandos de Cerberus.
 *
 *   npm run cerberus:ingestar -- ruta/al/dump.sql   → espejo crudo + proyección + grafo + hechos
 *   npm run cerberus:proyectar                      → SOLO rehace la capa canónica y el grafo
 *   npm run cerberus:hechos                         → SOLO rehace el eje del tiempo (capa 1)
 *   npm run lazo -- --simular                        → evalúa y guarda, SIN mandarle nada a Meta
 *   npm run lazo                                     → manda de verdad
 *
 * `proyectar` existe porque la capa canónica es DERIVADA: cuando cambia la semántica del negocio
 * (una tasa nueva, un estado que pasa a contar como cobrado, un bug de conversión que se arregla)
 * hay que rehacerla, y el dump no cambió. Volver a ingerir 100 MB de SQL para eso es absurdo.
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
    const id = await poblarIdentidad();
    console.log(
      `Grafo de identidad: ${id.personas.toLocaleString("es")} personas · ${id.clientesVinculados.toLocaleString("es")} clientes vinculados`,
    );

    // El eje del tiempo (capa 1). Va acá porque el dump nuevo trae hechos nuevos, y un hecho que
    // no se deriva hoy no aparece mañana solo.
    const h = await proyectarHechos();
    console.log(
      `Hechos: ${h.hechos.toLocaleString("es")} · ${h.ventanaHechos.desde} → ${h.ventanaHechos.hasta}`,
    );
    return;
  }

  if (comando === "hechos") {
    // Rehace SOLO la capa 1 desde el espejo crudo. Es re-proyectable a propósito: si mañana
    // cambia la regla de qué es un hecho, se corre esto y listo. El dump no cambió.
    const h = await proyectarHechos();
    console.log(`\nHechos derivados — el eje del tiempo\n`);
    for (const [tipo, n] of Object.entries(h.porTipo).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${tipo.padEnd(18)} ${n.toLocaleString("es").padStart(8)}`);
    }
    console.log(`  ${"".padEnd(18)} ${"─".repeat(8)}`);
    console.log(`  ${"TOTAL".padEnd(18)} ${h.hechos.toLocaleString("es").padStart(8)}`);
    console.log(`\n  ventana: ${h.ventanaHechos.desde} → ${h.ventanaHechos.hasta}`);
    console.log(`  tardó:   ${h.segundos}s`);

    // Los descartes se DICEN. La mitad importante de una proyección es lo que no derivó y por qué
    // — misma disciplina que `lazo/worker.ts:16-23`.
    const conDescartes = Object.entries(h.descartes).filter(([, n]) => n > 0);
    if (conDescartes.length > 0) {
      console.log(`\n  ── filas que NO produjeron hecho ──`);
      for (const [motivo, n] of conDescartes) {
        console.log(`  ${motivo.padEnd(18)} ${String(n).padStart(8)}`);
      }
    }
    console.log(
      `\n  NOTA: no existen VentaAnulada ni VentaReembolsada. Cerberus no guarda CUÁNDO cambió\n` +
        `  el estado de una venta, solo el estado final. Ver dominio del hecho en db/hechos.ts.`,
    );
    return;
  }

  if (comando === "proyectar") {
    // Rehace la capa canónica desde el espejo crudo, sin volver a leer el dump. La proyección
    // corre en UNA transacción: si algo falla, la capa vieja sigue en pie. Un dato de hace una
    // hora es infinitamente mejor que un cero que parece un dato.
    const p = await proyectarCerberus();
    console.log(
      `\nProyección canónica\n` +
        `  ${p.ventas.toLocaleString("es")} ventas · ${p.clientes.toLocaleString("es")} clientes · ` +
        `${p.productos.toLocaleString("es")} productos\n` +
        `  ${p.detalles.toLocaleString("es")} líneas · ${p.cuotas.toLocaleString("es")} cuotas · ` +
        `${p.pagos.toLocaleString("es")} pagos`,
    );

    const id = await poblarIdentidad();
    console.log(
      `\nGrafo de identidad\n` +
        `  ${id.personas.toLocaleString("es")} personas · ${id.identidades.toLocaleString("es")} identidades\n` +
        `  ${id.clientesVinculados.toLocaleString("es")} clientes vinculados · ` +
        `${id.conversionesVinculadas.toLocaleString("es")} conversiones ancladas`,
    );
    if (id.vetadasDescartadas > 0) {
      console.log(`  ⚠ ${id.vetadasDescartadas} claves quedaron fuera: están en identidades_bloqueadas`);
    }
    return;
  }

  if (comando === "lazo") {
    const simular = args.includes("--simular");
    const r = await correrLazo({ soloRegistrar: simular });

    console.log(`\n${simular ? "SIMULACIÓN — no se mandó nada a Meta" : "EL LAZO"}`);
    if (r.esPrueba) console.log("Modo TEST EVENTS: no afecta la optimización de los anuncios.\n");

    console.log(`  Ventas evaluadas : ${r.evaluadas.toLocaleString("es")}`);
    // Sin esta línea, un "Listas para Meta: 0" se lee como "no hay ventas" cuando en realidad
    // significa "Meta ya las tiene todas" — que es lo contrario.
    console.log(`  Ya estaban en Meta: ${r.yaEnviadas.toLocaleString("es")}`);
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

  console.error("Comandos: ingestar <ruta> | proyectar | lazo [--simular]");
  process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
