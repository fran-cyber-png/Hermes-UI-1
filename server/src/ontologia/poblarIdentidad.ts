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
 * base) y recién después se persiste. Es un rebuild: el grafo derivado se rehace entero.
 *
 * ── LO QUE EL REBUILD NO PUEDE TOCAR (issue #58, ADR 0017) ──
 *
 * Este archivo decía «el día que haya des-fusiones manuales, esto pasa a incremental; hoy está
 * vacío, así que rehacerlo entero es limpio». Ese día llegó: la vendedora ya puede afirmar
 * «esta persona es la misma que aquella» desde la ficha, y esa afirmación **no es derivada** —
 * no se puede recalcular desde `leads` ni desde Cerberus. Un `DELETE FROM vinculos_identidad`
 * a secas la borraría, en silencio, en la próxima corrida de un script de mantenimiento.
 *
 * La regla queda escrita en el SQL, no en un comentario: **se rehace lo que este poblador
 * fabricó, y nada más**. Concretamente:
 *
 *   · se borran las aristas cuya `regla <> 'manual'` — las manuales sobreviven, revocadas o no;
 *   · se borran las identidades que quedaron SIN NINGUNA arista, no todas: las que sostienen
 *     un enlace manual conservan su fila y su id;
 *   · las personas sin ancla se borran solo si además nadie cuelga de ellas.
 *
 * Y hay una segunda garantía, más fuerte que la disciplina: los dos mundos usan espacios de
 * nombres DISJUNTOS. El poblador solo fabrica identidades `email`/`telefono` y personas
 * ancladas en `email:`/`telefono:`; el enlace manual solo fabrica identidades de canal
 * (`wa_id`/`ig_user`/`psid`) y personas ancladas en `wa_id:`/`ig_user:`/`psid:`
 * (`identidad/clave.ts`). No hay fila que los dos quieran escribir.
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
  /** Cuántas claves quedaron afuera por estar en `identidades_bloqueadas`. Se reporta, no se esconde. */
  vetadasDescartadas: number;
  /** Aristas manuales que el rebuild NO tocó. Se cuenta para que «no las borró» sea verificable. */
  manualesPreservados: number;
  /**
   * Aristas derivadas que NO se escribieron porque esa identidad ya tenía un vínculo activo
   * afirmado por una persona. La afirmación humana gana; que gane en silencio, no.
   */
  derivadosCedidos: number;
};

/**
 * Recibe `base` INYECTADA (patrón de la casa, ADR 0008): el script le pasa el singleton, el
 * test su base aislada. Sin esto, «el rebuild no borra los enlaces manuales» no se podía
 * probar — y una garantía que no se puede probar es una intención.
 */
export async function poblarIdentidad(base: typeof db = db): Promise<ResumenIdentidad> {
  // ── 0. LAS CLAVES BLOQUEADAS — el arma de seguridad que estaba declarada y desconectada ──
  //
  // `ontologia.identidades_bloqueadas` existía desde el día uno con su comentario y todo, y NADIE la
  // consultaba nunca. Era una promesa de protección que el código no cumplía.
  //
  // Qué protege: un `informes@goberna.pe` o un teléfono de recepción cargado en 300 fichas fusiona
  // a 300 personas distintas en UNA. Y no se rompe ruidosamente — se rompe en silencio, y todo lo
  // que cuelga del grafo (el LTV, la línea de tiempo, las audiencias que se le mandan a Meta)
  // empieza a mentir sobre un Frankenstein que nadie creó a propósito.
  //
  // Hoy los datos están limpios (ningún correo se repite en más de 2 clientes). El día que no lo
  // estén, esto es una fila insertada en una tabla, no una migración de emergencia.
  const bloqueadas = (await base.execute(sql`
    SELECT tipo, valor FROM ontologia.identidades_bloqueadas
  `)) as unknown as { tipo: string; valor: string }[];
  const vetadas = new Set(bloqueadas.map((b) => `${b.tipo}:${b.valor}`));

  // ── 1. Juntar los registros con identidad FUERTE: clientes + leads ──
  const clientes = (await base.execute(sql`
    SELECT codigo, nombre, apellido, email, telefono FROM ontologia.cliente
  `)) as unknown as { codigo: string; nombre: string | null; apellido: string | null; email: string | null; telefono: string | null }[];

  const leads = (await base.execute(sql`
    SELECT full_name, email, phone FROM leads
  `)) as unknown as { full_name: string | null; email: string | null; phone: string | null }[];

  /** Una clave vetada no entra al grafo: no fusiona, y tampoco se guarda como identidad. */
  const permitida = (tipo: "email" | "telefono", valor: string) => !vetadas.has(`${tipo}:${valor}`);

  const registros: Registro[] = [];
  let vetadasDescartadas = 0;
  for (const c of clientes) {
    const claims: Claim[] = [];
    const e = normEmail(c.email);
    const t = normTel(c.telefono);
    if (e && permitida("email", e)) claims.push({ tipo: "email", valor: e, fuerza: "fuerte" });
    else if (e) vetadasDescartadas++;
    if (t && permitida("telefono", t)) claims.push({ tipo: "telefono", valor: t, fuerza: "fuerte" });
    else if (t) vetadasDescartadas++;
    if (claims.length) {
      registros.push({ claims, nombre: [c.nombre, c.apellido].filter(Boolean).join(" ") || null, clienteCodigo: c.codigo });
    }
  }
  for (const l of leads) {
    const claims: Claim[] = [];
    const e = normEmail(l.email);
    const t = normTel(l.phone);
    if (e && permitida("email", e)) claims.push({ tipo: "email", valor: e, fuerza: "fuerte" });
    else if (e) vetadasDescartadas++;
    if (t && permitida("telefono", t)) claims.push({ tipo: "telefono", valor: t, fuerza: "fuerte" });
    else if (t) vetadasDescartadas++;
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

  // ── 3. Rebuild del grafo DERIVADO (y solo del derivado) ──
  // Los VÍNCULOS y las IDENTIDADES que este poblador fabricó se rehacen (son derivados puros).
  // Las PERSONAS **no**: se hace UPSERT sobre su `clave_raiz`, para que su id sobreviva al
  // rebuild. Si se borraran y recrearan, la misma persona tendría un id nuevo cada vez y todo
  // link guardado (/gente/7083) se rompería.
  //
  // DELETE en orden, NO truncate CASCADE: `conversiones` tiene FK a `personas` y un CASCADE se
  // llevaría puesto el lazo.
  await base.execute(sql`UPDATE ontologia.conversiones SET persona_id = NULL`);
  await base.execute(sql`UPDATE ontologia.cliente SET persona_id = NULL`);

  // LO MANUAL NO ES DERIVADO. Un enlace que hizo una vendedora («esta persona es la misma que
  // aquella», #58) no se puede recalcular desde `leads` ni desde Cerberus: si se borra, se
  // perdió. Se queda, revocado o no — el historial es append-only.
  const [{ n: manualesPreservados }] = (await base.execute(sql`
    SELECT count(*)::int AS n FROM ontologia.vinculos_identidad WHERE regla = 'manual'
  `)) as unknown as { n: number }[];
  await base.execute(sql`DELETE FROM ontologia.vinculos_identidad WHERE regla <> 'manual'`);

  // Y las identidades se borran por ORFANDAD, no por lista: la que todavía sostiene un enlace
  // manual conserva su fila y su id. Un `DELETE FROM identidades` a secas rompería su FK.
  await base.execute(sql`
    DELETE FROM ontologia.identidades i
    WHERE NOT EXISTS (SELECT 1 FROM ontologia.vinculos_identidad v WHERE v.identidad_id = i.id)
  `);
  // Limpieza única de las personas viejas sin ancla (las de antes de que existiera `clave_raiz`).
  // Con la misma cautela: solo si además no cuelga nadie de ellas.
  await base.execute(sql`
    DELETE FROM ontologia.personas p
    WHERE p.clave_raiz IS NULL
      AND NOT EXISTS (SELECT 1 FROM ontologia.vinculos_identidad v WHERE v.persona_id = p.id)
  `);

  const grupos = uf.raices();
  const personaPorRaiz = new Map<string, number>();

  // La CLAVE ANCLA de cada grupo: su identidad más chica en orden lexicográfico. Determinista —
  // no depende de en qué orden se hayan procesado los clientes ni los leads.
  const anclaDe = new Map<string, string>();
  for (const [raiz, keys] of grupos) anclaDe.set(raiz, [...keys].sort()[0]);

  const raices = [...grupos.keys()];
  for (let i = 0; i < raices.length; i += 1000) {
    const chunk = raices.slice(i, i + 1000);
    const ids = await base
      .insert(personas)
      .values(
        chunk.map((raiz) => ({
          claveRaiz: anclaDe.get(raiz)!,
          nombreDisplay: nombrePorRaiz.get(raiz) ?? null,
        })),
      )
      // Ya existe esa persona: se le refresca el nombre y se CONSERVA su id.
      .onConflictDoUpdate({
        target: personas.claveRaiz,
        set: { nombreDisplay: sql`excluded.nombre_display` },
      })
      .returning({ id: personas.id, claveRaiz: personas.claveRaiz });

    // El returning no garantiza el orden del input: se mapea por la clave, no por la posición.
    const idPorClave = new Map(ids.map((r) => [r.claveRaiz!, r.id]));
    for (const raiz of chunk) personaPorRaiz.set(raiz, idPorClave.get(anclaDe.get(raiz)!)!);
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
  // Se inserta sin pisar: una identidad que sobrevivió por sostener un enlace manual ya está.
  // Y el id se resuelve DESPUÉS, por clave — no por la posición del `returning`, que con
  // `DO NOTHING` deja de tener una fila por cada valor enviado y desalinearía todo el mapa.
  for (let i = 0; i < filasIdent.length; i += 1000) {
    await base
      .insert(identidades)
      .values(filasIdent.slice(i, i + 1000))
      .onConflictDoNothing();
  }
  const identIdPorKey = new Map<string, number>();
  const idsIdent = (await base.execute(sql`
    SELECT id, tipo, valor FROM ontologia.identidades WHERE tipo IN ('email', 'telefono')
  `)) as unknown as { id: number; tipo: string; valor: string }[];
  for (const f of idsIdent) identIdPorKey.set(`${f.tipo}:${f.valor}`, Number(f.id));

  const filasVinculo = identKeys.map((k) => ({
    identidadId: identIdPorKey.get(k)!,
    personaId: personaPorRaiz.get(uf.find(k))!,
    regla: "correo_telefono",
    evidencia: { clave: k },
    actor: "sistema",
    confianza: "alta",
  }));
  // `DO NOTHING` sobre `vinculos_identidad_activo_uq`: si una identidad ya tiene un vínculo
  // activo porque una persona lo afirmó, el derivado CEDE. Quien lo afirmó tiene un nombre;
  // la regla no. Y se cuenta, para que ceder no sea invisible.
  let vinculosEscritos = 0;
  for (let i = 0; i < filasVinculo.length; i += 1000) {
    const escritos = await base
      .insert(vinculosIdentidad)
      .values(filasVinculo.slice(i, i + 1000))
      .onConflictDoNothing()
      .returning({ id: vinculosIdentidad.id });
    vinculosEscritos += escritos.length;
  }
  const derivadosCedidos = filasVinculo.length - vinculosEscritos;

  // ── 4. Anclar los clientes a su persona ──
  let clientesVinculados = 0;
  for (const r of registros) {
    if (!r.clienteCodigo) continue;
    const pid = personaPorRaiz.get(uf.find(clave(r.claims[0])));
    if (pid) {
      await base.update(cliente).set({ personaId: pid }).where(sql`codigo = ${r.clienteCodigo}`);
      clientesVinculados++;
    }
  }

  // ── 5. Anclar las conversiones (el lazo) a la persona, vía la venta → cliente ──
  const convVinc = await base.execute(sql`
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
    vetadasDescartadas,
    manualesPreservados: Number(manualesPreservados),
    derivadosCedidos,
  };
}
