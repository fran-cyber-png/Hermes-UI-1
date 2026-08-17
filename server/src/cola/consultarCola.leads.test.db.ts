import assert from "node:assert/strict";
import test from "node:test";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLead, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * ══ LOS LEADS DE FORMULARIO ENTRAN A «TE ESPERAN» ══════════════════════════
 *
 * Decisión del dueño del 10-ago-2026: la columna no es «te escribieron por
 * WhatsApp», es «la pelota es nuestra» — así que quien llenó un formulario y no
 * recibió un mensaje va ahí, aunque nunca haya existido una conversación.
 *
 * Esto NO se puede testear sin base: el aporte es un tercer brazo de un
 * `UNION ALL`, y lo que falla en un UNION —una columna de menos, un tipo que no
 * casa, un CTE que no existe— falla en Postgres, no en TypeScript. El typecheck
 * pasa igual con el SQL roto.
 *
 * ⚠️ Se siembra con `sembrarLead` y NO con un INSERT a mano: `leads.event_id` es
 * NOT NULL y referencia a `events`, así que un INSERT directo revienta por la FK.
 * La primera versión de este archivo lo hacía a mano y lo cazó N2b — que es
 * exactamente para lo que está.
 */

/** Un lead de landing: es la fuente que el tercer brazo mira (`fuenteLeadSql`). */
const deLanding = { platform: "web", formName: "icarus:landing" } as const;

/** La fila de la cola que corresponde a un teléfono, sea lead o conversación. */
function filaDe(r: { conversaciones: unknown[] }, telefono: string) {
  return (r.conversaciones as Array<Record<string, unknown>>).find(
    (c) => String(c.persona_id ?? "").replace(/\D/g, "") === telefono.replace(/\D/g, ""),
  );
}

test("un lead de formulario sin conversación cae en «te esperan» (interesado)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, {
    ...deLanding,
    phone: "+51987654321",
    fullName: "Rosa Quispe",
    campaignName: "Diplomado en Gestión Pública",
  });

  const fila = filaDe(await consultarCola(db, {}), "51987654321");

  assert.ok(fila, "el lead tiene que aparecer en la cola");
  // 🔴 La integración entera es esta línea: sin un solo mensaje, `hablo` y
  // `ya_le_hablamos` son false, y `etapaEfectivaSql` deriva `interesado` solo.
  assert.equal(fila.etapa_efectiva, "interesado");
  assert.equal(fila.canal, "landing");
  assert.equal(fila.persona_nombre, "Rosa Quispe");
  // Lo que pidió: es todo lo que sabemos de esta persona, y es lo que la tarjeta
  // muestra en vez de un preview de chat que no existe.
  assert.equal(fila.texto, "Diplomado en Gestión Pública");
});

test("🔴 NO cae en «sin respuesta»: esa exige que le hayamos escrito", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { ...deLanding, phone: "+51987654322" });

  const fila = filaDe(await consultarCola(db, {}), "51987654322");
  // Si alguien emitiera `ya_le_hablamos: true` por descuido, el lead caería en
  // `sin_respuesta` — que desde ADR 0050 NO es columna, así que desaparecería de
  // la pantalla sin ningún error. Es el modo de falla silencioso de este frente.
  assert.notEqual(fila?.etapa_efectiva, "sin_respuesta");
});

test("🔴 un lead que YA tiene conversación no se duplica", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { ...deLanding, phone: "+51987654323" });
  await sembrarMensaje(db, { personaId: "51987654323", direccion: "entrante", texto: "hola" });

  const r = await consultarCola(db, {});
  const filas = (r.conversaciones as Array<Record<string, unknown>>).filter(
    (c) => String(c.persona_id ?? "").replace(/\D/g, "") === "51987654323",
  );
  assert.equal(filas.length, 1, "la misma persona no puede salir dos veces");
  assert.equal(filas[0].canal, "whatsapp", "gana la conversación viva, no el lead");
});

test("fuera de la ventana de 30 días no entra: «te espera» es de esta semana", async (t) => {
  const db = await baseDePrueba(t);
  const hace90dias = new Date(Date.now() - 90 * 86_400_000);
  await sembrarLead(db, { ...deLanding, phone: "+51987654324", createdTime: hace90dias });

  assert.equal(filaDe(await consultarCola(db, {}), "51987654324"), undefined);
});

test("un lead-ad de Meta NO entra: la fila se rotula «landing» y sería falso", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { platform: "fb", phone: "+51987654328" });

  assert.equal(filaDe(await consultarCola(db, {}), "51987654328"), undefined);
});

test("con la cola recortada a un canal de chat, los leads se caen", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { ...deLanding, phone: "+51987654325" });

  // ⚠️ El brazo de los leads lee `leads`, que NO tiene columna `canal`: si se
  // dejara adentro con `?canal=whatsapp`, la consulta ni compilaría. Este test
  // fija que la decisión se tome antes de armar el SQL, no dentro del WHERE.
  assert.equal(filaDe(await consultarCola(db, { canal: "whatsapp" }), "51987654325"), undefined);
});

test("el desglose los cuenta en interesado, así la cabecera y la lista coinciden", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { ...deLanding, phone: "+51987654326" });
  await sembrarLead(db, { ...deLanding, phone: "+51987654327" });

  const r = await consultarCola(db, {});
  const enInteresado = (r.desglose ?? [])
    .filter((f) => f.etapa === "interesado")
    .reduce((n, f) => n + f.n, 0);
  // Si el desglose y la lista no salieran del mismo universo, la columna diría
  // un número y mostraría otro — el defecto que `plegarConteos` existe para que
  // sea imposible (#37).
  assert.equal(enInteresado, 2);
});

test("🔴 por el camino REAL de la columna (?etapa=interesado) el formulario de hoy sale PRIMERO", async (t) => {
  /**
   * ══ LA ENMIENDA DEL 11-ago-2026 (ADR 0051) ═══════════════════════════════
   *
   * Los tests de arriba prueban que el lead ENTRA a la columna, y todos pasaban
   * mientras el dueño reportaba que los formularios «no salían». Los dos eran
   * ciertos: entraban, y quedaban en la **página 10**.
   *
   * El motivo era el orden. `cola/urgencia.ts` ramificaba por `tipo ===
   * 'mensaje'`, así que un lead caía al **nivel 5** («el resto») mientras todas
   * las conversaciones de «Te esperan» son nivel 3 — `interesado` se deriva de
   * `NOT respondida`, que ES la condición del nivel 3. Con `ORDER BY nivel ASC`
   * y 40 por página, los 154 formularios iban después de las 377 conversaciones.
   *
   * Este test pide la columna **como la pide el Pipeline** —con `etapa`, que es
   * lo que ningún test de arriba hacía— y fija las dos mitades: el nivel y el
   * lugar. Es la lección de ADR 0049: el defecto vivía en la costura, y los
   * tests que llaman al seam sin sus parámetros reales no la tocan.
   */
  const db = await baseDePrueba(t);
  const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);

  // Las conversaciones que hoy llenan la columna: escribieron y nadie contestó.
  await sembrarMensaje(db, { personaId: "51900000021", occurredAt: hace(21 * 24) });
  await sembrarMensaje(db, { personaId: "51900000010", occurredAt: hace(10 * 24) });
  // Y el formulario que llegó hoy: la persona levantó la mano hace dos horas.
  await sembrarLead(db, { ...deLanding, phone: "+51987654328", createdTime: hace(2) });

  const r = await consultarCola(db, { etapa: "interesado" });
  const filas = r.conversaciones as Array<Record<string, unknown>>;

  assert.equal(
    String(filas[0]?.persona_id ?? "").replace(/\D/g, ""),
    "51987654328",
    "el formulario de hace 2 h tiene que encabezar «Te esperan»: velocidad = venta",
  );
  assert.equal(filaDe(r, "51987654328")?.nivel, 0, "es VIVO, no «el resto»");
  assert.ok(
    filas.every((f) => f.nivel !== 5),
    "ninguna fila de esta columna puede caer en el nivel 5: ahí van las ventanas cerradas",
  );
  // Y las tres conviven en la MISMA columna: el lead no la reemplaza ni la parte.
  assert.equal(filas.length, 3);
});

test("🔴 el reparto NO puede esconder los formularios: quien está en la rueda los sigue viendo", async (t) => {
  /**
   * ══ MEDIDO EN LOCAL CONTRA UNA COPIA DE PRODUCCIÓN (11-ago-2026) ═════════
   *
   * `esMiaSql` mira `conversacion_asignada`, que se llena en el webhook de la
   * Cloud API — o sea, cuando llega un MENSAJE. Un lead de landing no pasa por
   * ahí y **nunca puede tener una fila**: el recorte del reparto no lo filtra,
   * lo elimina.
   *
   * Con `ventas10@grupogoberna.com` «Te esperan» devolvía **1 tarjeta y CERO
   * formularios**, contra las 522 que ve alguien sin el recorte. El frente
   * entero era invisible justo para las cinco personas que venden.
   *
   * ⚠️ **Ese día el recorte se prendía SOLO** —estar en la rueda lo encendía— y
   * eso murió con la frontera por rol. Por eso este test pasa `misAsignadas`
   * EXPLÍCITO: hoy el único camino a `soloMias` es el chip «Míos». La medición
   * sigue valiendo y lo que fija el test también — el chip vive, y sin la
   * exención por fila borraría los formularios igual que en agosto.
   *
   * ⚠️ Lo que este test NO dice: que esté bien que las cinco vean la misma pila.
   * Está escrito en `consultarCola.ts` que se acepta a ojos abiertos hasta que
   * repartir leads sea un frente propio. Lo que fija es que **esconderlos es
   * peor**, y que la conversación ajena SÍ se sigue recortando.
   */
  const db = await baseDePrueba(t);
  await sembrarLead(db, { ...deLanding, phone: "+51987654329", fullName: "Ana de la landing" });
  // Una conversación de OTRA persona, sin asignar a nadie: tiene que seguir
  // cayéndose con el recorte del reparto puesto. Si no, la exención sería un
  // agujero en el reparto en vez de una exención acotada a los formularios.
  await sembrarMensaje(db, { personaId: "51900000099" });

  const r = await consultarCola(db, { etapa: "interesado", misAsignadas: true, vendedoraId: "ventas10@grupogoberna.com" });

  assert.ok(filaDe(r, "51987654329"), "el formulario tiene que seguir estando: el reparto no lo alcanza");
  assert.equal(
    filaDe(r, "51900000099"),
    undefined,
    "la conversación sin asignar SÍ se recorta: la exención es solo para los formularios",
  );
});

test("🔴 una tarjeta por PERSONA, no por envío de formulario", async (t) => {
  /**
   * Medido en producción: dentro de la ventana de 30 días son **154 envíos de
   * 145 personas**. Sin el `DISTINCT ON`, «makanaky» ocupaba cuatro tarjetas
   * seguidas de las primeras veinte de la columna — y la vendedora le abre
   * conversación dos veces creyendo que son dos leads.
   */
  const db = await baseDePrueba(t);
  const hace = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
  await sembrarLead(db, {
    ...deLanding, phone: "+51987654330", fullName: "Rita", campaignName: "Oratoria", createdTime: hace(30),
  });
  await sembrarLead(db, {
    ...deLanding, phone: "+51987654330", fullName: "Rita", campaignName: "Gestión Pública", createdTime: hace(2),
  });

  const filas = (await consultarCola(db, { etapa: "interesado" })).conversaciones as Array<Record<string, unknown>>;
  const suyas = filas.filter((f) => String(f.persona_id ?? "").endsWith("987654330"));

  assert.equal(suyas.length, 1, "dos envíos de la misma persona son UNA tarjeta");
  // Gana el más reciente: lo último que dijo que quería es lo que hay que contestarle.
  assert.equal(suyas[0]?.texto, "Gestión Pública");
});
