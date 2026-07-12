/**
 * Meta devuelve `results` y `cost_per_result` como un arreglo anidado, no como un número:
 *
 *   results: [{ indicator: "actions:onsite_conversion.messaging_conversation_started_7d",
 *               values: [{ value: "945" }] }]
 *
 * El indicador cambia según el objetivo de la campaña. Cuando el resultado es una conversión
 * personalizada de Events Manager, llega como `offsite_conversion.custom.<ID larguísimo>`.
 * Por eso no se puede leer un campo fijo: hay que bajar por la estructura.
 */
export function indicatorValue(arr: unknown): number | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const raw = (arr[0] as any)?.values?.[0]?.value;
  return raw != null ? Number(raw) : null;
}
