import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { cliente } from "../db/canonico.js";
import { conversiones, identidades, personas, vinculosIdentidad } from "../db/ontologia.js";

/**
 * POBLAR EL GRAFO DE IDENTIDAD — darle carne al esqueleto.
 *
 * El grafo (personas/identidades/vínculos) estaba declarado pero VACÍO. Sin él, "la matriz" es una
 * pila de tablas que no se hablan. Acá se conecta: un cliente de Cerberus y un lead de Meta que
 * comparten correo o teléfono SON la misma persona — y sus compras se agrupan bajo una sola cabeza.
 *
 * La regla de fuerza que evita el desastre (teléfono compartido en familia, cabina de internet):
 *   FUERTE  → correo/teléfono de una compra o un formulario (la persona lo dio). Puede unir personas.
 *   DÉBIL   → psid / usuario de IG (un comentario). Vincula, pero NUNCA une dos personas.
 *
 * La unión de identidades FUERTES se hace con union-find en memoria (rápido, sin miles de idas a la
 * base) y recién después se persiste. Es un rebuild: el grafo es derivado. El día que haya
 * des-fusiones manuales, esto pasa a incremental; hoy está vacío, así que rehacerlo entero es limpio.
 */

// ── Normalización: la clave del grafo es el valor NORMALIZADO, nunca el crudo ──
function normEmail(v: any): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return s.includes("@") && s.length <= 254 ? s : null;
}
function normTel(v: any): string | null {
  const s = String(v ?? "").replace(/[^\d]/g, "");
  // Teléfonos de menos de 8 dígitos no identifican a nadie (extensiones, basura).
  return s.length >= 8 && s.length <= 15 ? s : null;
}

/** Union-find sobre claves de identidad "tipo:valor". */
class UnionFind {
  private padre = new Map<string, string>();
  find(x: string): string {
    if (!this.padre.has(x)) this.padre.set(x, x);
    let r = x;
    while (this.padre.get(r) !== r) r = this.padre.get(r)!;
    this.padre.set(x, r);
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.padre.set(ra, rb);
  }
  raices(): Map<string, string[]> {
    const grupos = new Map<string, string[]>();
    for (const k of this.padre.keys()) {
      const r = this.find(k);
      (grupos.get(r) ?? grupos.set(r, []).get(r)!).push(k);
    }
    return grupos;
  }
}

type Claim = { tipo: "email" | "telefono"; valor: string; fuerza: "fuerte" };
type Registro = { claims: Claim[]; nombre: string | null; clienteCodigo?: string };

export type ResumenIdentidad = {
  personas: number;
  identidades: number;
  clientesVinculados: number;
  conversionesVinculadas: number;
};

export async function poblarIdentidad(): Promise<ResumenIdentidad> {
  // ── 1. Juntar los registros con identidad FUERTE: clientes + leads ──
  const clientes = (await db.execute(sql`
    SELECT codigo, nombre, apellido, email, telefono FROM ontologia.cliente
  `)) as unknown as { codigo: string; nombre: string | null; apellido: string | null; email: string | null; telefono: string | null }[];

  const leads = (await db.execute(sql`
    SELECT full_name, email, phone FROM leads
  `)) as unknown as { full_name: string | null; email: string | null; phone: string | null }[];

  const registros: Registro[] = [];
  for (const c of clientes) {
    const claims: Claim[] = [];
    const e = normEmail(c.email);
    const t = normTel(c.telefono);
    if (e) claims.push({ tipo: "email", valor: e, fuerza: "fuerte" });
    if (t) claims.push({ tipo: "telefono", valor: t, fuerza: "fuerte" });
    if (claims.length) {
      registros.push({ claims, nombre: [c.nombre, c.apellido].filter(Boolean).join(" ") || null, clienteCodigo: c.codigo });
    }
  }
  for (const l of leads) {
    const claims: Claim[] = [];
    const e = normEmail(l.email);
    const t = normTel(l.phone);
    if (e) claims.push({ tipo: "email", valor: e, fuerza: "fuerte" });
    if (t) claims.push({ tipo: "telefono", valor: t, fuerza: "fuerte" });
    if (claims.length) registros.push({ claims, nombre: l.full_name || null });
  }

  // ── 2. Union-find: dos registros que comparten un correo/teléfono son la misma persona ──
  const uf = new UnionFind();
  const clave = (c: Claim) => `${c.tipo}:${c.valor}`;
  for (const r of registros) {
    const ks = r.claims.map(clave);
    for (let i = 1; i < ks.length; i++) uf.union(ks[0], ks[i]);
  }

  // Nombre sugerido por grupo (el primero no vacío).
  const nombrePorRaiz = new Map<string, string>();
  for (const r of registros) {
    if (!r.nombre) continue;
    const raiz = uf.find(clave(r.claims[0]));
    if (!nombrePorRaiz.has(raiz)) nombrePorRaiz.set(raiz, r.nombre);
  }

  // ── 3. Rebuild del grafo (está vacío hoy; el día que haya des-fusiones, esto es incremental) ──
  // DELETE en orden, NO truncate CASCADE: `conversiones` tiene FK a `personas` y un CASCADE se
  // llevaría puesto el lazo. Primero se sueltan las referencias, después se borra de hoja a raíz.
  await db.execute(sql`UPDATE ontologia.conversiones SET persona_id = NULL`);
  await db.execute(sql`UPDATE ontologia.cliente SET persona_id = NULL`);
  await db.execute(sql`DELETE FROM ontologia.vinculos_identidad`);
  await db.execute(sql`DELETE FROM ontologia.identidades`);
  await db.execute(sql`DELETE FROM ontologia.personas`);

  const grupos = uf.raices();
  const personaPorRaiz = new Map<string, number>();
  // Insert personas en lote y recuperar ids en orden.
  const raices = [...grupos.keys()];
  for (let i = 0; i < raices.length; i += 1000) {
    const chunk = raices.slice(i, i + 1000);
    const ids = await db
      .insert(personas)
      .values(chunk.map((raiz) => ({ nombreDisplay: nombrePorRaiz.get(raiz) ?? null })))
      .returning({ id: personas.id });
    chunk.forEach((raiz, j) => personaPorRaiz.set(raiz, ids[j].id));
  }

  // identidades + vínculos
  const filasIdent: { tipo: string; valor: string; fuerza: string }[] = [];
  const identKeys: string[] = [];
  for (const [raiz, keys] of grupos) {
    for (const k of keys) {
      const [tipo, ...rest] = k.split(":");
      filasIdent.push({ tipo, valor: rest.join(":"), fuerza: "fuerte" });
      identKeys.push(k);
    }
  }
  const identIdPorKey = new Map<string, number>();
  for (let i = 0; i < filasIdent.length; i += 1000) {
    const chunk = filasIdent.slice(i, i + 1000);
    const ids = await db.insert(identidades).values(chunk).returning({ id: identidades.id });
    chunk.forEach((_f, j) => identIdPorKey.set(identKeys[i + j], ids[j].id));
  }

  const filasVinculo = identKeys.map((k) => ({
    identidadId: identIdPorKey.get(k)!,
    personaId: personaPorRaiz.get(uf.find(k))!,
    regla: "correo_telefono",
    evidencia: { clave: k },
    actor: "sistema",
    confianza: "alta",
  }));
  for (let i = 0; i < filasVinculo.length; i += 1000) {
    await db.insert(vinculosIdentidad).values(filasVinculo.slice(i, i + 1000));
  }

  // ── 4. Anclar los clientes a su persona ──
  let clientesVinculados = 0;
  for (const r of registros) {
    if (!r.clienteCodigo) continue;
    const pid = personaPorRaiz.get(uf.find(clave(r.claims[0])));
    if (pid) {
      await db.update(cliente).set({ personaId: pid }).where(sql`codigo = ${r.clienteCodigo}`);
      clientesVinculados++;
    }
  }

  // ── 5. Anclar las conversiones (el lazo) a la persona, vía la venta → cliente ──
  const convVinc = await db.execute(sql`
    UPDATE ontologia.conversiones cv
    SET persona_id = v.cliente_persona
    FROM (
      SELECT ve.folio_humano, cl.persona_id AS cliente_persona
      FROM ontologia.venta ve JOIN ontologia.cliente cl ON cl.codigo = ve.cliente_codigo
      WHERE cl.persona_id IS NOT NULL AND ve.folio_humano IS NOT NULL
    ) v
    WHERE cv.origen_clave = v.folio_humano
    RETURNING cv.id
  `);

  return {
    personas: raices.length,
    identidades: filasIdent.length,
    clientesVinculados,
    conversionesVinculadas: (convVinc as unknown as unknown[]).length,
  };
}
