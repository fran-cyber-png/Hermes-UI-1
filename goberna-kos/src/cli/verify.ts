// ─────────────────────────────────────────────────────────
// CQ Engine — verify: confronta cada CQ contra la Tool que la responde
// ─────────────────────────────────────────────────────────

import { loadCapabilities, loadCatalog, saveCatalog, recalculateAllCoverages } from '../catalog.js';
import { motivoDeCuarentena } from '../verificada.js';
import type { CompetencyQuestion, CQDomain } from '../types.js';

/**
 * EL VERIFICADOR — el eslabón que faltaba entre el registro y el código.
 *
 * El CQ Engine dice QUÉ hay que poder responder. El SDK Governa dice CÓMO se responde. Hasta hoy
 * no se hablaban, y por eso el registro pudo llenarse de respuestas plausibles y falsas sin que
 * nada lo notara.
 *
 * ── Qué hace y qué NO hace ──
 * Ejecuta la Tool ligada (`answeredBy`) contra el SDK vivo y le muestra al humano las dos
 * versiones: la que el registro afirma y la que el código devuelve. **No decide quién tiene
 * razón.** El código también puede estar mal — de hecho, verificar `cq-ventas-002` fue lo que
 * destapó que `docs/02-CERBERUS.md` omitía el estado 8, y que `proyectar.ts` manejaba un estado 9
 * que no existe en los datos. La CQ estaba mal, pero el código tampoco estaba del todo bien.
 *
 * Por eso `--aprobar` es explícito y por CQ: marcar `validated` es un acto humano, con nombre y
 * fecha. Automatizarlo sería repetir el error de origen — dar por verdad algo que nadie miró.
 *
 * Sin LLM, a propósito: es la decisión DT-004 del RFC ("determinístico primero"). Un juez modelo
 * acá agregaría exactamente la clase de incertidumbre que este comando existe para eliminar.
 */

const SDK = process.env.GOBERNA_SDK ?? 'http://localhost:4100/api/sdk';

type Catalogo = { nombre: string; descripcion: string; cqIds: string[]; fuentes: string[] }[];

async function pedir(url: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(url, init);
  if (!r.ok && r.status !== 400 && r.status !== 404 && r.status !== 500) {
    throw new Error(`${url} → HTTP ${r.status}`);
  }
  return r.json();
}

/** El catálogo del SDK. Si el server no está, se dice — no se finge que las Tools no existen. */
async function traerCatalogo(): Promise<Catalogo> {
  try {
    return (await pedir(`${SDK}/catalogo`)) as Catalogo;
  } catch (e) {
    console.error(`\n  ✗ No se pudo leer el catálogo del SDK en ${SDK}`);
    console.error(`    ${e instanceof Error ? e.message : String(e)}`);
    console.error(`\n    ¿Está corriendo el server?  cd server && npm run dev`);
    console.error(`    O apuntá a otro con GOBERNA_SDK=http://host:puerto/api/sdk\n`);
    process.exit(1);
  }
}

async function invocar(nombre: string): Promise<{ ok: boolean; salida?: unknown; detalle?: string }> {
  const r = (await pedir(`${SDK}/invocar/${nombre}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })) as { ok: boolean; salida?: unknown; detalle?: string };
  return r;
}

/**
 * La salida de la Tool, en texto plano, para poder mirarla al lado de `expectedAnswer`.
 *
 * `resumen` es la convención: una Tool que responde una CQ de enumeración devuelve la respuesta
 * corta ahí. Si no la tiene, se muestra el JSON entero — feo, pero honesto.
 */
function comoTexto(salida: unknown): string {
  if (salida && typeof salida === 'object') {
    const o = salida as Record<string, unknown>;
    if (typeof o.resumen === 'string') return o.resumen;
    if (typeof o.porQue === 'string') return o.porQue;
  }
  return JSON.stringify(salida, null, 2);
}

function cqsDelDominio(dominio?: CQDomain): CompetencyQuestion[] {
  const cqs = loadCatalog();
  if (!dominio) return cqs;
  const caps = new Set(loadCapabilities().filter((c) => c.domain === dominio).map((c) => c.id));
  return cqs.filter((q) => caps.has(q.capabilityId));
}

export async function verify(options: {
  domain?: CQDomain;
  cq?: string;
  aprobar?: string;
  quien?: string;
}): Promise<void> {
  const catalogo = await traerCatalogo();
  const toolsVivas = new Set(catalogo.map((t) => t.nombre));

  // ── Aprobar: el acto humano ──
  if (options.aprobar) {
    const cqs = loadCatalog();
    const idx = cqs.findIndex((q) => q.id === options.aprobar);
    if (idx === -1) {
      console.error(`\n  ✗ No existe la CQ "${options.aprobar}"\n`);
      process.exit(1);
    }
    const cq = cqs[idx];
    if (!cq.answeredBy) {
      console.error(`\n  ✗ ${cq.id} no tiene answeredBy: no hay Tool contra la cual verificarla.\n`);
      process.exit(1);
    }
    const r = await invocar(cq.answeredBy);
    if (!r.ok) {
      console.error(`\n  ✗ ${cq.answeredBy} falló: ${r.detalle}\n`);
      process.exit(1);
    }
    cqs[idx] = {
      ...cq,
      status: 'validated',
      validatedAt: new Date().toISOString(),
      validatedBy: options.quien ?? 'humano',
      version: cq.version + 1,
    };
    saveCatalog(cqs);
    recalculateAllCoverages();
    console.log(`\n  ✓ ${cq.id} marcada validated por ${cqs[idx].validatedBy}`);
    console.log(`    respaldada por ${cq.answeredBy}`);
    console.log(`    ahora es exportable a LoRA y benchmarks.\n`);
    return;
  }

  // ── Verificar: mostrar las dos versiones, no decidir ──
  const cqs = options.cq
    ? loadCatalog().filter((q) => q.id === options.cq)
    : cqsDelDominio(options.domain);

  const ligadas = cqs.filter((q) => q.answeredBy);
  const sueltas = cqs.filter((q) => !q.answeredBy);

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  CQ ENGINE — VERIFY');
  console.log(`  SDK: ${SDK}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  for (const cq of ligadas) {
    const tool = cq.answeredBy!;
    console.log(`  ── ${cq.id} ${'─'.repeat(Math.max(0, 44 - cq.id.length))}`);
    console.log(`  ${cq.text}`);
    console.log('');

    if (!toolsVivas.has(tool)) {
      console.log(`  ✗ answeredBy apunta a "${tool}", que no está en el catálogo del SDK.`);
      console.log('');
      continue;
    }

    const r = await invocar(tool);
    if (!r.ok) {
      console.log(`  ✗ ${tool} falló: ${r.detalle}`);
      console.log('');
      continue;
    }

    const delCodigo = comoTexto(r.salida);
    console.log(`  EL REGISTRO DICE (expectedAnswer):`);
    console.log(`    ${cq.expectedAnswer.replace(/\n/g, '\n    ')}`);
    console.log('');
    console.log(`  EL CÓDIGO DICE (${tool}):`);
    console.log(`    ${delCodigo.replace(/\n/g, '\n    ')}`);
    console.log('');
    if (cq.verifiedAgainst?.length) {
      console.log(`  Dónde mirar para decidir: ${cq.verifiedAgainst.join(', ')}`);
    }
    const estado = motivoDeCuarentena(cq);
    console.log(`  Estado: ${estado ? `EN CUARENTENA — ${estado}` : 'verificada'}`);
    if (estado) {
      console.log(`  Si la respuesta del registro coincide con la del código:`);
      console.log(`    npx tsx src/cli/index.ts cq verify --aprobar=${cq.id} --quien=tu-nombre`);
    }
    console.log('');
  }

  // ── El resumen: lo que NO se exporta se dice en voz alta ──
  const verificadas = cqs.filter((q) => !motivoDeCuarentena(q)).length;
  console.log('───────────────────────────────────────────────────');
  console.log(`  CQs miradas:         ${cqs.length}`);
  console.log(`  ligadas a una Tool:  ${ligadas.length}`);
  console.log(`  sin Tool todavía:    ${sueltas.length}  ← en cuarentena: no salen a LoRA ni a benchmarks`);
  console.log(`  verificadas:         ${verificadas}`);
  console.log('');
  if (sueltas.length > 0) {
    console.log(`  Un registro sin verificar no es un registro vacío: es uno que puede mentir.`);
    console.log(`  Ver docs/04-REALITY-GAPS.md:27 — "El modelo solo acepta entidades VERIFIED".`);
    console.log('');
  }
}
