/**
 * Parte un texto en 1 a 3 burbujas.
 * Corta primero por párrafos (doble salto de línea), después por oraciones
 * (punto, signo de exclamación/interrogación + espacio + mayúscula).
 * Si el texto es muy corto (< 300 chars) va en una sola burbuja.
 */
export function trocear(texto: string, maxBurbujas = 3): string[] {
  const trimado = texto.trim();
  if (!trimado) return [];

  if (trimado.length < 300) return [trimado];

  const parrafos = trimado
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parrafos.length > 1 && parrafos.length <= maxBurbujas) {
    return parrafos;
  }

  if (parrafos.length > maxBurbujas) {
    const resultado = parrafos.slice(0, maxBurbujas - 1);
    resultado.push(parrafos.slice(maxBurbujas - 1).join("\n\n"));
    return resultado;
  }

  const oraciones = trimado
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/)
    .filter(Boolean);

  if (oraciones.length <= 1) return [trimado];

  const tamanoBurbuja = Math.ceil(oraciones.length / maxBurbujas);
  const resultado: string[] = [];
  for (let i = 0; i < oraciones.length; i += tamanoBurbuja) {
    resultado.push(oraciones.slice(i, i + tamanoBurbuja).join(" "));
  }
  return resultado.slice(0, maxBurbujas);
}
