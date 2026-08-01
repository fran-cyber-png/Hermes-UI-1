/**
 * Traza del pipeline — utilidad ligera para medir cada paso.
 * Hoy es un contenedor de tramos con timestamps. En Fase 5 se persiste en
 * `bot_trazas` con métricas completas.
 *
 * Cada paso abre un tramo con su nombre, hace lo suyo, y lo cierra con un
 * resumen de una línea. La traza acumula todos los tramos en orden.
 */

export interface Tramo {
  paso: string;
  inicio: string; // ISO timestamp
  fin: string | null;
  duracionMs: number | null;
  resultado: string | null;
}

export interface Traza {
  trazaId: string;
  clave: string;
  inicio: string;
  tramos: Tramo[];
}

let contador = 0;

export function iniciarTraza(clave: string): Traza {
  contador++;
  return {
    trazaId: `bot-${Date.now()}-${contador}`,
    clave,
    inicio: new Date().toISOString(),
    tramos: [],
  };
}

export function tramoDePipeline(paso: string, traza: Traza) {
  const inicio = Date.now();
  const inicioISO = new Date(inicio).toISOString();
  let cerrado = false;

  return {
    cerrar(resultado: string) {
      if (cerrado) return;
      cerrado = true;
      const fin = Date.now();
      traza.tramos.push({
        paso,
        inicio: inicioISO,
        fin: new Date(fin).toISOString(),
        duracionMs: fin - inicio,
        resultado,
      });
    },
  };
}

/**
 * Convierte una traza a una sola línea legible para logs.
 * "clave | paso1:ok(12ms) → paso2:error(340ms) → paso3:stub(0ms)"
 */
export function resumirTraza(traza: Traza): string {
  const partes = traza.tramos.map(
    (t) => `${t.paso}:${t.resultado ?? "?"}(${t.duracionMs ?? 0}ms)`,
  );
  return `${traza.clave} | ${partes.join(" → ")}`;
}
