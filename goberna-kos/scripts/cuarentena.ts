/**
 * MIGRACIÓN — poner el Capability Registry en cuarentena y ligarlo al SDK.
 *
 * Se corre UNA vez (2026-07-16). Queda versionado como registro de qué se cambió y por qué, no
 * como una herramienta de uso corriente.
 *
 *   1. Las 105 CQs pasan de `active` a `draft`. Ninguna se había contrastado contra el código:
 *      todas tienen `source: 'domain_analysis'`, `contentHash: ''` y ningún `validatedAt`.
 *      Mientras estuvieran `active` eran exportables como dataset de LoRA y como clave de
 *      corrección de benchmarks.
 *   2. Se corrigen las falsedades PROBADAS contra el código y los datos.
 *   3. Se liga cada CQ del slice (lazo/ventas/tesorería) a la Tool del SDK que la responde.
 *
 * Nada se marca `validated` acá: eso lo hace `kos cq verify` ejecutando la Tool. Marcar a mano
 * sería repetir el error de origen — afirmar sin verificar.
 */

import { loadCatalog, saveCatalog, generateContentHash, recalculateAllCoverages } from '../src/catalog.js';
import type { CompetencyQuestion } from '../src/types.js';

/** Las CQs que se ligan a una Tool, con las rutas que sustentan la respuesta. */
const LIGADAS: Record<string, { answeredBy: string; verifiedAgainst: string[] }> = {
  'cq-ventas-002': {
    answeredBy: 'governa.ventas.estados',
    verifiedAgainst: [
      'server/src/dominio/estadosVenta.ts:79',
      'docs/02-CERBERUS.md:56',
      'server/src/ontologia/proyectar.ts:53',
      'server/src/lazo/evento.ts:51',
    ],
  },
  'cq-lazo-004': {
    answeredBy: 'governa.lazo.ventanaCapi',
    verifiedAgainst: ['server/src/lazo/evento.ts:18', 'server/src/lazo/evento.ts:33'],
  },
  'cq-lazo-002': {
    answeredBy: 'governa.lazo.estado',
    verifiedAgainst: ['server/src/canales/verdad.ts:88', 'docs/00-OVERVIEW.md:15'],
  },
  'cq-tesoreria-010': {
    answeredBy: 'governa.tesoreria.latencia',
    verifiedAgainst: ['server/src/analisis/comercial.ts:121', 'server/src/canales/tesoreria.ts:15'],
  },
};

/**
 * Las correcciones. Cada una lleva la evidencia de por qué la versión vieja era falsa.
 *
 * Solo se corrige lo que se PROBÓ, no lo que parece dudoso. Una CQ sospechosa pero no verificada
 * se queda en `draft` con su texto original: inventar una corrección sería cambiar una invención
 * por otra.
 */
const CORRECCIONES: Record<string, { text?: string; expectedAnswer: string; porQue: string }> = {
  'cq-ventas-002': {
    /**
     * La PREGUNTA también estaba mal, no solo la respuesta: "¿Cuáles son los 7 estados...?"
     * lleva la falsedad en la premisa. Y este texto es literalmente el prompt del benchmark y el
     * `instruction` del dataset de LoRA: preguntando así, se induce al modelo a contestar 7.
     * Una pregunta con presuposición falsa no se puede responder bien.
     */
    text: '¿Cuáles son los estados posibles de una venta en Cerberus?',
    expectedAnswer:
      'En los datos hay 8 estados (no 7): 1=Pagado, 2=Pendiente, 3=No Validado, 4=Anulado, ' +
      '5=Cotización, 6=Preventa, 7=Retirado, 8=Reembolsado. Para el negocio se agrupan en: ' +
      'cobrada (1, y 9 si apareciera), en_proceso (2), anulada (4 y 5), reembolsada (7 y 8), ' +
      'otro (3 y 6). El estado 9 (Pagado por crédito) está en el código pero no se observó ' +
      'ninguna venta con ese estado.',
    porQue:
      'Decía "1=vendido, 2=señado, 3=confirmado, 4=en_curso, 5=retirado, 6=suspendido, ' +
      '7=anulado" con confianza 0.98. Todos los mapeos estaban mal, y el conteo también: en ' +
      'producción hay 8 estados, no 7. Verificado contra 6.727 ventas del espejo de Cerberus, y ' +
      'contra docs/02-CERBERUS.md:56, ontologia/proyectar.ts:53 y lazo/evento.ts:51, que ' +
      'coinciden entre sí. Este mapa decide qué ventas ve Meta.',
  },
  'cq-tesoreria-010': {
    expectedAnswer:
      'No existe ningún plazo definido: Cerberus no tiene columna de antigüedad, ni alerta, ni ' +
      'SLA para confirmar un voucher (verificado por grep en todo el repo: dias_pendiente, SLA, ' +
      'antiguedad → cero resultados). El único plazo real es externo: los 7 días que Meta acepta ' +
      'como event_time. Lo que se puede medir es lo que TARDA, no lo que debería tardar: ver ' +
      'governa.tesoreria.latencia para el p50/p90 vigentes.',
    porQue:
      'Decía "Tesorería tiene un máximo de 7 días hábiles para confirmar" con confianza 0.97. No ' +
      'existe tal SLA — su ausencia es literalmente la tesis de canales/tesoreria.ts:15-17, que ' +
      'lo dejó probado por grep. Lo más probable es que la CQ se contaminó con la ventana de 7 ' +
      'días de META y la convirtió en una regla interna de Cerberus. Son cosas distintas: una es ' +
      'el límite de un tercero, la otra sería una política que nadie escribió.',
  },
};

function main(): void {
  const cqs = loadCatalog();
  const antes = { active: 0, otros: 0 };
  let cuarentenadas = 0;
  let corregidas = 0;
  let ligadas = 0;

  const salida: CompetencyQuestion[] = cqs.map((cq) => {
    if (cq.status === 'active') antes.active++;
    else antes.otros++;

    const nueva: CompetencyQuestion = { ...cq };

    // 1. Cuarentena. Nada sale hasta que una Tool lo respalde.
    if (nueva.status === 'active') {
      nueva.status = 'draft';
      cuarentenadas++;
    }

    // 2. Corrección de lo probado.
    const fix = CORRECCIONES[cq.id];
    if (fix) {
      if (fix.text) nueva.text = fix.text;
      nueva.expectedAnswer = fix.expectedAnswer;
      // El contentHash estaba vacío en las 105. Ahora se puebla: es lo que permite detectar que
      // una respuesta cambió sin que nadie la volviera a verificar.
      nueva.contentHash = generateContentHash(nueva.text, nueva.expectedAnswer);
      nueva.version += 1;
      corregidas++;
      console.log(`  corregida  ${cq.id}`);
      console.log(`    antes: ${cq.expectedAnswer.slice(0, 100)}...`);
      console.log(`    por qué: ${fix.porQue.slice(0, 100)}...`);
    }

    // 3. Ligado al SDK.
    const liga = LIGADAS[cq.id];
    if (liga) {
      nueva.answeredBy = liga.answeredBy;
      nueva.verifiedAgainst = liga.verifiedAgainst;
      ligadas++;
    }

    // El hash faltaba en las 105. Sin él no hay forma de saber si una respuesta cambió.
    if (!nueva.contentHash) {
      nueva.contentHash = generateContentHash(nueva.text, nueva.expectedAnswer);
    }

    return nueva;
  });

  saveCatalog(salida);
  recalculateAllCoverages();

  console.log('');
  console.log(`  CQs totales:        ${cqs.length}`);
  console.log(`  estaban 'active':   ${antes.active}  (ninguna verificada contra el código)`);
  console.log(`  → a cuarentena:     ${cuarentenadas}`);
  console.log(`  corregidas:         ${corregidas}`);
  console.log(`  ligadas a una Tool: ${ligadas}`);
  console.log(`  marcadas validated: 0  ← eso lo hace 'kos cq verify', no este script`);
}

main();
