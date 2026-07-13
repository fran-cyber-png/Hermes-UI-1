/**
 * Lee un `mysqldump` de Cerberus como texto plano.
 *
 * ── Por qué así y no conectándonos a la MySQL ──
 * Cerberus corre el negocio. No se hacen consultas analíticas contra la base que cobra la plata.
 * El propio Cerberus ya expone un `/descargar-bd/` (admin-gated) que produce un
 * `mysqldump --single-transaction --quick --skip-lock-tables` — la opción correcta: no bloquea
 * InnoDB. Leemos ese archivo. Cero riesgo para producción, cero credenciales de base de datos.
 *
 * ── Por qué un tokenizador y no un regex ──
 * Icarus intentó las dos cosas. Su primer parser (`import-contacts.ts`) usaba un regex por fila y
 * es frágil ante escapes; el segundo (`import-erp.py`) tokeniza carácter por carácter. Vamos
 * directo al segundo, con tests, porque las trampas de MySQL son todas reales:
 *
 *   'D\'Angelo'         → comilla escapada
 *   'Lima, Perú'        → coma dentro del string
 *   'Curso (avanzado)'  → paréntesis dentro del string
 *   NULL vs 'NULL'      → ausencia de dato vs alguien que escribió la palabra
 *   observaciones con saltos de línea (la gente escribe con enters)
 *
 * Un regex que no contemple alguna de estas parte una fila por la mitad y mete basura en la base,
 * en silencio.
 */

/** Un valor de MySQL: el string ya desescapado, o `null` si venía como NULL literal. */
export type Valor = string | null;
export type FilaCruda = Valor[];

export type FilaConTabla = {
  tabla: string;
  valores: FilaCruda;
};

/** Los escapes que emite mysqldump. */
const ESCAPES: Record<string, string> = {
  "0": "\0",
  b: "\b",
  n: "\n",
  r: "\r",
  t: "\t",
  Z: "\x1a",
  "\\": "\\",
  "'": "'",
  '"': '"',
};

/**
 * Recorre el dump y va emitiendo las filas de las tablas pedidas.
 *
 * Es un generador: un dump de Cerberus puede pesar decenas de MB y no tiene sentido materializar
 * todas las filas en memoria para después descartar el 90%.
 */
export function* parsearInserts(sql: string, tablas: Set<string>): Generator<FilaConTabla> {
  // `INSERT INTO \`tabla\` VALUES` — con o sin comillas invertidas.
  const inicio = /INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?\s+(?:\([^)]*\)\s+)?VALUES\s*/gi;

  let m: RegExpExecArray | null;
  while ((m = inicio.exec(sql)) !== null) {
    const tabla = m[1];
    // Aun si no nos interesa la tabla, hay que SALTEARLA bien: si avanzáramos a ciegas, un
    // `INSERT INTO` que aparezca adentro de un string de otra fila nos desincronizaría.
    const [filas, fin] = leerFilas(sql, inicio.lastIndex);
    inicio.lastIndex = fin;

    if (!tablas.has(tabla)) continue;
    for (const valores of filas) yield { tabla, valores };
  }
}

/** Lee `(...),(...),(...);` desde `i`. Devuelve las filas y dónde terminó. */
function leerFilas(sql: string, i: number): [FilaCruda[], number] {
  const filas: FilaCruda[] = [];

  while (i < sql.length) {
    while (i < sql.length && /\s/.test(sql[i])) i++;
    if (sql[i] !== "(") break;

    const [fila, fin] = leerFila(sql, i + 1);
    filas.push(fila);
    i = fin;

    while (i < sql.length && /\s/.test(sql[i])) i++;
    if (sql[i] === ",") {
      i++; // otra fila
      continue;
    }
    if (sql[i] === ";") i++;
    break;
  }

  return [filas, i];
}

/** Lee UNA fila desde el carácter siguiente al `(`. Devuelve los valores y dónde cerró el `)`. */
function leerFila(sql: string, i: number): [FilaCruda, number] {
  const valores: FilaCruda = [];
  let actual = "";
  let enString = false;
  let vacio = true; // ¿el valor actual no tiene ningún carácter todavía?
  // ¿este valor vino ENTRE COMILLAS? Es lo que distingue `NULL` (ausencia) de `'NULL'` (la
  // palabra). Sin esto, un cliente apellidado NULL desaparecería de la base.
  let fueString = false;

  while (i < sql.length) {
    const c = sql[i];

    if (enString) {
      if (c === "\\") {
        // El escape se resuelve acá: por eso `'D\'Angelo'` no parte el string.
        const sig = sql[i + 1];
        actual += ESCAPES[sig] ?? sig;
        i += 2;
        continue;
      }
      if (c === "'") {
        // MySQL también escapa la comilla duplicándola: '' dentro de un string.
        if (sql[i + 1] === "'") {
          actual += "'";
          i += 2;
          continue;
        }
        enString = false;
        i++;
        continue;
      }
      actual += c;
      i++;
      continue;
    }

    if (c === "'") {
      enString = true;
      fueString = true;
      vacio = false;
      i++;
      continue;
    }

    // Fuera de un string, estos dos SÍ son estructura.
    if (c === "," || c === ")") {
      valores.push(terminar(actual, vacio, fueString));
      actual = "";
      vacio = true;
      fueString = false;
      i++;
      if (c === ")") return [valores, i];
      continue;
    }

    actual += c;
    if (!/\s/.test(c)) vacio = false;
    i++;
  }

  // Dump truncado: devolvemos lo que haya en vez de colgarnos.
  if (!vacio) valores.push(terminar(actual, vacio, fueString));
  return [valores, i];
}

/**
 * `NULL` sin comillas es ausencia de dato. `'NULL'` entre comillas es alguien que escribió la
 * palabra — y `fueString` es lo único que los distingue.
 *
 * Sin esa distinción, un cliente apellidado NULL desaparecería de la base, en silencio. Suena
 * absurdo hasta que pasa: es el bug clásico de los parsers de CSV con el apellido "Null".
 */
function terminar(bruto: string, vacio: boolean, fueString: boolean): Valor {
  if (fueString) return bruto; // vino entrecomillado: es un string, siempre.
  const t = bruto.trim();
  if (vacio && t === "") return null;
  if (t === "NULL") return null;
  return bruto;
}
