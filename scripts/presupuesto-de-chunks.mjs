/**
 * ¿QUÉ PAGA ENTRAR A UNA VISTA? — se mide sobre el build, no se razona.
 *
 * ══ POR QUÉ ESTO EXISTE ═════════════════════════════════════════════════════
 *
 * La vista Libreta se carga perezosa, y con el tiempo se le fue metiendo todo
 * adentro del mismo chunk: BlockNote, la Ribbon, React Flow. Entrar a buscar una
 * nota y volverse costaba **377,8 KB gzip**, y quien nunca abría un diagrama
 * pagaba React Flow igual.
 *
 * 🔴 **Lo que avisó no fue una medición: fue un test de teclado.** El helper de
 * `App.test.tsx` esperaba turnos del event loop y tuvo que subir su tope de 50 a
 * 300. Ese número era un sensor accidental — avisaba tarde, en el archivo
 * equivocado, y se apagaba subiéndolo. Este script es el sensor a propósito.
 *
 * ══ 🔴 LO QUE MIDE, Y POR QUÉ NO ES EL TAMAÑO DEL ARCHIVO ═══════════════════
 *
 * El cierre de imports **ESTÁTICOS** del chunk de entrada, descontando lo que el
 * arranque ya trajo. Las tres partes importan:
 *
 *  · **Estáticos y no todos**: un `import()` dinámico es justo lo que se quiere
 *    que quede afuera. Contarlo daría siempre el total y el presupuesto no
 *    diría nada.
 *  · **El cierre y no el archivo**: la fuga original no engordaba el chunk de la
 *    Libreta, le colgaba otro al lado. Mirar un solo archivo no la habría visto.
 *  · **Descontando el arranque**: `index-*.js` ya está en la máquina cuando la
 *    vendedora toca ⌘8. Cobrárselo otra vez sería inflar el número y perderle
 *    el sentido al techo.
 *
 * Y la pregunta que de verdad importa no es cuántos KB: es **si el motor del
 * editor está en el camino de entrada**. Por eso además de los bytes se buscan
 * las huellas de las dos librerías. Un techo se puede subir con un commit; una
 * huella hay que explicarla.
 *
 * ══ FALLA SI NO VERIFICÓ NADA ═══════════════════════════════════════════════
 *
 * La cicatriz de `deploy/vps1/verificar-assets.sh`: su primera versión daba
 * «0 verificados · 0 fallos» en verde. Sin `dist/`, sin chunk de entrada o sin
 * chunk de arranque, esto es un error — nunca un ✅.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ASSETS = 'dist/assets';

/**
 * Las vistas con presupuesto. El techo NO es el valor medido: es el valor medido
 * con aire, para que un cambio honesto no ponga rojo el CI y una regresión de
 * las que motivaron esto (×19) no pase.
 */
const PRESUPUESTOS = [
  {
    vista: 'Libreta',
    entrada: /^Libreta-.*\.js$/,
    topeKb: 60,
    prohibido: [
      { que: 'BlockNote', huella: /prosemirror|bn-block-content/ },
      { que: 'React Flow', huella: /react-flow__node/ },
    ],
  },
];

function cierreEstatico(archivo, vistos = new Set()) {
  if (vistos.has(archivo)) return vistos;
  vistos.add(archivo);
  const texto = readFileSync(join(ASSETS, archivo), 'utf8');
  // `from"./x.js"` e `import"./x.js"` son estáticos; `import("./x.js")` no, y esa
  // diferencia es todo el punto de este script.
  for (const m of texto.matchAll(/(?:from|import)"(\.\/[^"]+\.js)"/g)) {
    cierreEstatico(basename(m[1]), vistos);
  }
  return vistos;
}

let assets;
try {
  assets = readdirSync(ASSETS);
} catch {
  console.error(`🔴 no hay build en ${ASSETS}. Corré \`npm run build\` antes.`);
  process.exit(1);
}

const arranque = assets.find((f) => /^index-.*\.js$/.test(f));
if (!arranque) {
  console.error('🔴 no encontré el chunk de arranque (index-*.js): no puedo descontar nada.');
  process.exit(1);
}
const yaCargado = cierreEstatico(arranque);

let fallos = 0;
let verificados = 0;

for (const p of PRESUPUESTOS) {
  const entrada = assets.find((f) => p.entrada.test(f));
  if (!entrada) {
    console.error(`🔴 ${p.vista}: no encontré su chunk de entrada (${p.entrada}). ¿Se renombró?`);
    fallos++;
    continue;
  }
  verificados++;

  const propios = [...cierreEstatico(entrada)].filter((a) => !yaCargado.has(a));
  let bytes = 0;
  const contaminados = [];
  for (const a of propios) {
    const crudo = readFileSync(join(ASSETS, a));
    bytes += gzipSync(crudo).length;
    const texto = crudo.toString('utf8');
    for (const { que, huella } of p.prohibido) {
      if (huella.test(texto)) contaminados.push(`${a} → ${que}`);
    }
  }
  const kb = bytes / 1024;
  console.log(`${p.vista}: entrar cuesta ${kb.toFixed(1)} KB gzip en ${propios.length} chunk(s) — tope ${p.topeKb} KB`);

  if (contaminados.length > 0) {
    fallos++;
    console.error(`🔴 ${p.vista}: el camino de ENTRADA arrastra lo que debería ser perezoso:`);
    for (const c of contaminados) console.error(`     · ${c}`);
    console.error('   Mirá quién importa qué: `src/features/notas/ribbon/tabs.ts` cuenta la historia.');
  }
  if (kb > p.topeKb) {
    fallos++;
    console.error(`🔴 ${p.vista}: ${kb.toFixed(1)} KB gzip pasa el tope de ${p.topeKb} KB.`);
  }
}

if (verificados === 0) {
  console.error('🔴 no verifiqué ni una vista. Un verde acá no significaría nada.');
  process.exit(1);
}
if (fallos > 0) process.exit(1);
console.log(`✅ ${verificados} vista(s) dentro de su presupuesto, y sin el editor en el camino de entrada.`);
