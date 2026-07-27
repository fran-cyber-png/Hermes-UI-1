import "dotenv/config";
import { firmarSesion } from "../auth/sesion.js";

/**
 * SMOKE TEST FUNCIONAL — «¿la app que acabo de desplegar SIRVE?».
 *
 * Los tests del repo prueban el código; esto prueba el DESPLIEGUE: que el proceso
 * levantó, que habla con su base, que el perímetro de auth está puesto, que el front
 * se sirve y que las pantallas que usa la vendedora contestan. Es la diferencia entre
 * «compila» y «anda», que es exactamente donde fallaba el CD viejo: verificaba
 * `/health` y nada más, y `/health` contesta aunque la cola esté rota.
 *
 * ES READ-ONLY POR DISEÑO. No escribe una sola fila: los únicos POST son un login que
 * TIENE que fallar y un envío que TIENE que ser rechazado. Correrlo contra producción
 * es seguro — y por eso se corre contra producción.
 *
 *     BASE_URL=http://127.0.0.1:4111 npm run humo              # sin sesión
 *     BASE_URL=http://127.0.0.1:4111 npm run humo -- --sesion  # además, autenticado
 *
 * `--sesion` firma un token con el HERMES_SESSION_SECRET del entorno que se está
 * probando. Sirve para llegar a las rutas de verdad (la cola, el radar, la agenda):
 * sin eso, todo contesta 401 y no se prueba nada más que el portero.
 */

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:4110").replace(/\/$/, "");
const CON_SESION = process.argv.includes("--sesion");
const TIMEOUT_MS = 15_000;

type Resultado = { nombre: string; ok: boolean; detalle: string };
const resultados: Resultado[] = [];

async function pedir(
  ruta: string,
  opciones: RequestInit = {},
): Promise<{ status: number; texto: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}${ruta}`, { ...opciones, signal: ctrl.signal });
    return { status: r.status, texto: (await r.text()).slice(0, 400) };
  } finally {
    clearTimeout(t);
  }
}

async function revisar(
  nombre: string,
  fn: () => Promise<{ ok: boolean; detalle: string }>,
): Promise<void> {
  try {
    const { ok, detalle } = await fn();
    resultados.push({ nombre, ok, detalle });
    console.log(`${ok ? "✅" : "❌"} ${nombre} — ${detalle}`);
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    resultados.push({ nombre, ok: false, detalle });
    console.log(`❌ ${nombre} — ${detalle}`);
  }
}

/** Espera un status exacto. La mayoría de las verificaciones son esto. */
function esperaStatus(ruta: string, esperado: number, opciones: RequestInit = {}) {
  return async () => {
    const { status } = await pedir(ruta, opciones);
    return { ok: status === esperado, detalle: `${ruta} → ${status} (esperaba ${esperado})` };
  };
}

async function main(): Promise<void> {
  console.log(`\n── smoke contra ${BASE} ${CON_SESION ? "(con sesión)" : "(sin sesión)"} ──\n`);

  // ── 1. El proceso está vivo y habla con su base ────────────────────────────
  await revisar("el server responde /health", async () => {
    const { status, texto } = await pedir("/health");
    return { ok: status === 200 && texto.includes('"ok":true'), detalle: `${status} ${texto}` };
  });

  // ── 2. El front se sirve (OTA: la app de escritorio abre ESTO) ─────────────
  await revisar("el front se sirve con su bundle", async () => {
    const { status, texto } = await pedir("/");
    const bundle = texto.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    return {
      ok: status === 200 && Boolean(bundle),
      detalle: bundle ? `${status} · ${bundle}` : `${status} · SIN bundle en el HTML`,
    };
  });

  // ── 3. El perímetro de auth (ADR 0011): todo /api/* cerrado por defecto ────
  // Esto no es una formalidad: la API es pública en internet. Si alguna de estas
  // deja de dar 401, hay datos de las vendedoras al aire.
  for (const ruta of [
    "/api/conversaciones",
    "/api/dashboard",
    "/api/agenda",
    "/api/notas",
    "/api/categorias",
    "/api/gestiones",
    "/api/auth/yo",
    "/api/ivi/preguntar",
  ]) {
    await revisar(`sin token, ${ruta} da 401`, esperaStatus(ruta, 401));
  }

  // El API de administración es OTRA familia de credencial (#50/#95): el token de
  // vendedora no sirve ahí, y por eso se prueba aparte.
  await revisar("sin credencial de servicio, /api/admin da 401", esperaStatus("/api/admin/numeros", 401));

  // ── 4. Las rutas de desarrollo no existen en producción ───────────────────
  await revisar(
    "las rutas de simulación no están abiertas",
    esperaStatus("/api/whatsapp/_sim", 401, { method: "POST" }),
  );

  // ── 5. Cerberus sigue del otro lado ───────────────────────────────────────
  // Credenciales deliberadamente inválidas: prueba que el handshake CSRF + POST a
  // /ingresar/ sigue funcionando (si Cerberus cambió el formulario, esto deja de dar
  // 401 y empieza a dar 500). NO registra nada, NO crea sesión.
  await revisar("el login contra Cerberus rechaza credenciales inválidas", async () => {
    const { status, texto } = await pedir("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `username`/`password`, los nombres que espera el router: con otros nombres da
      // 400 por validación y no se llega a tocar Cerberus — o sea, no probaría nada.
      body: JSON.stringify({ username: "smoke-no-existe", password: "smoke-no-existe" }),
    });
    // 401 = Cerberus contestó y rechazó: es lo que queremos. 503 = el router detectó a
    // Cerberus caído, y eso significa que NINGUNA vendedora puede entrar ahora mismo.
    const detalle =
      status === 503
        ? `503 · CERBERUS CAÍDO — nadie puede loguearse: ${texto}`
        : `${status} ${status >= 500 ? texto : ""}`.trim();
    return { ok: status === 401, detalle };
  });

  // ── 6. Con sesión: las pantallas que usa la vendedora contestan de verdad ──
  if (CON_SESION) {
    const token = firmarSesion("smoke-test");
    const auth = { headers: { authorization: `Bearer ${token}` } };

    await revisar("con token, /api/auth/yo reconoce la sesión", async () => {
      const { status, texto } = await pedir("/api/auth/yo", auth);
      return { ok: status === 200 && texto.includes("smoke-test"), detalle: `${status} ${texto}` };
    });

    // El corazón del CRM: la cola. Consulta SQL de verdad contra la base de verdad.
    // Si la base no está migrada o una proyección se rompió, ACÁ se ve — no en /health.
    await revisar("la cola de conversaciones responde", async () => {
      const { status, texto } = await pedir("/api/conversaciones", auth);
      let n = "?";
      try {
        const j = JSON.parse(texto.length < 400 ? texto : "[]");
        n = Array.isArray(j) ? String(j.length) : String(Object.keys(j).length);
      } catch {
        /* la respuesta vino truncada por el slice: alcanza con el status */
      }
      return { ok: status === 200, detalle: `${status} · ${n} elementos (truncado a 400 chars)` };
    });

    for (const [nombre, ruta] of [
      ["el radar del dashboard", "/api/dashboard"],
      ["la agenda", "/api/agenda"],
      ["las categorías", "/api/categorias"],
      // `?q=` a propósito, no `?clave=`: esa rama es la búsqueda GIN sobre
      // to_tsvector, o sea que ejercita el índice `notas_texto_gin_idx`. Si la
      // migración no lo creó, esto sigue dando 200 pero por seq scan — no lo
      // detecta; lo que sí detecta es que la ruta de búsqueda no reviente.
      ["la búsqueda de notas", "/api/notas?q=smoke"],
    ] as const) {
      await revisar(`${nombre} responde`, esperaStatus(ruta, 200, auth));
    }

    // WhatsApp: el estado de la sesión. No manda nada — solo pregunta cómo está.
    await revisar("el estado de la sesión de WhatsApp se puede consultar", async () => {
      const { status, texto } = await pedir("/api/whatsapp/sesion", auth);
      return { ok: status === 200, detalle: `${status} ${texto.slice(0, 120)}` };
    });

    // SSE: la conexión de tiempo real. Se abre y se corta enseguida — si no abriera,
    // las pantallas de las vendedoras se quedarían congeladas sin avisar.
    await revisar("el stream SSE acepta la conexión", async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      try {
        const r = await fetch(`${BASE}/api/stream`, { ...auth, signal: ctrl.signal });
        const tipo = r.headers.get("content-type") ?? "";
        return {
          ok: r.status === 200 && tipo.includes("event-stream"),
          detalle: `${r.status} · ${tipo}`,
        };
      } finally {
        clearTimeout(t);
        ctrl.abort();
      }
    });
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  const fallaron = resultados.filter((r) => !r.ok);
  console.log(`\n── ${resultados.length - fallaron.length}/${resultados.length} pasaron ──`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    const lineas = [
      `### Smoke contra \`${BASE}\``,
      "",
      `**${resultados.length - fallaron.length}/${resultados.length}** verificaciones pasaron.`,
      "",
      "| | Verificación | Detalle |",
      "|---|---|---|",
      ...resultados.map((r) => `| ${r.ok ? "✅" : "❌"} | ${r.nombre} | \`${r.detalle}\` |`),
      "",
    ];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lineas.join("\n"));
  }

  if (fallaron.length > 0) {
    console.error(`\n${fallaron.length} verificación(es) fallaron:`);
    for (const f of fallaron) console.error(`  · ${f.nombre}: ${f.detalle}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("el smoke no pudo correr:", err);
  process.exit(1);
});
