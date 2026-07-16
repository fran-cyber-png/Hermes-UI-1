// ─────────────────────────────────────────────────────────
// CQ Engine — La cuarentena
// ─────────────────────────────────────────────────────────

import type { CompetencyQuestion } from './types.js';

/**
 * ¿Esta CQ puede salir del registro hacia afuera?
 *
 * ── Por qué existe este archivo ──
 * Las 105 CQs originales se generaron con `source: 'domain_analysis'`: se inventaron de forma
 * plausible y nunca se contrastaron contra el código. Ninguna tenía `validatedAt`. Pero todas
 * estaban marcadas `status: 'active'`, y los producers dejaban salir `active`:
 *
 *   · lora-producer     → `output: cq.expectedAnswer`  (el dataset de entrenamiento)
 *   · benchmark-producer → `expectedAnswer`            (la clave de corrección)
 *
 * O sea que una falsedad como "los estados de venta son 4=en_curso, 5=retirado, 7=anulado" —sobre
 * el mapa que decide qué ventas ve Meta— era exportable como verdad para entrenar y para evaluar.
 * Un modelo que respondiera BIEN se puntuaba MAL. Y en geógrafo ya existía `lora-ventas.jsonl`
 * con `train-ventas-lora.py` listo: lo único que impidió entrenar sobre datos falsos fue un
 * conflicto de dependencias de torch. Suerte, no diseño.
 *
 * ── La regla ──
 * `docs/04-REALITY-GAPS.md:27` ya la tenía escrita, y el registro no se la estaba aplicando a sí
 * mismo: **"El modelo solo acepta entidades en estado VERIFIED."**
 *
 * Se invierte el default. Antes: todo sale salvo que se marque mal. Ahora: nada sale salvo que
 * alguien lo haya verificado contra el código. Es la diferencia entre una lista negra —que falla
 * abierta, porque hay que acordarse de agregar cada falsedad— y una blanca, que falla cerrada.
 *
 * Cuesta que hoy no salga casi nada. Ese es el precio correcto: un harness roto que se sabe roto
 * es mejor que uno que miente.
 */
export function estaVerificada(cq: CompetencyQuestion): boolean {
  // Los dos, no uno: `status` es una etiqueta que alguien puede poner a mano; `validatedAt` es la
  // marca que deja `kos cq verify` cuando la Tool respaldó la respuesta. Exigir ambos evita que un
  // find/replace descuidado sobre el JSON reabra la puerta.
  return cq.status === 'validated' && Boolean(cq.validatedAt);
}

/** Las que pueden salir. */
export function soloVerificadas(cqs: CompetencyQuestion[]): CompetencyQuestion[] {
  return cqs.filter(estaVerificada);
}

/**
 * Lo que se dejó afuera, para poder decirlo en voz alta.
 *
 * Un producer que filtra en silencio es indistinguible de uno que no tiene datos. Esto es lo que
 * permite que el CLI diga "exporté 5 de 105 y estas son las 100 que faltan verificar" en vez de
 * devolver un archivo corto sin explicación.
 */
export function motivoDeCuarentena(cq: CompetencyQuestion): string | null {
  if (estaVerificada(cq)) return null;
  if (!cq.answeredBy) return 'sin Tool que la responda (falta answeredBy)';
  if (!cq.validatedAt) return 'nunca se verificó contra su Tool (falta validatedAt)';
  return `status "${cq.status}" — se esperaba "validated"`;
}
