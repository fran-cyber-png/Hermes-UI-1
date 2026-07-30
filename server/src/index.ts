import "dotenv/config";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { perimetroApi } from "./auth/perimetro.js";
import { adsRouter } from "./routes/ads.js";
import { audiencesRouter } from "./routes/audiences.js";
import { adsetsRouter } from "./routes/adsets.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { configRouter } from "./routes/config.js";
import { decisionsRouter } from "./routes/decisions.js";
import { interactionsRouter } from "./routes/interactions.js";
import { conversacionesRouter } from "./routes/conversaciones.js";
import { authRouter } from "./routes/auth.js";
import { contactosRouter } from "./routes/contactos.js";
import { agendaRouter } from "./routes/agenda.js";
import { gestionesRouter } from "./routes/gestiones.js";
import { categoriasRouter } from "./routes/categorias.js";
import { senalesRouter } from "./routes/senales.js";
import { resultadosRouter } from "./routes/resultados.js";
import { plantillasRouter } from "./routes/plantillas.js";
import { sugerenciasRouter } from "./routes/sugerencias.js";
import { hechosRouter } from "./routes/hechos.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { capturarCuerpoCrudo } from "./webhook/firma.js";
import { landingRouter } from "./webhook/landing.js";
import { correosRouter } from "./routes/correos.js";
import { notasRouter } from "./routes/notas.js";
import { ventaRouter } from "./routes/venta.js";
import { leadsRouter } from "./routes/leads.js";
import { metaAssetsRouter } from "./routes/metaAssets.js";
import { overviewRouter } from "./routes/overview.js";
import { personaRouter } from "./routes/persona.js";
import { genteRouter } from "./routes/gente.js";
import { enlacesRouter } from "./routes/enlaces.js";
import { responderRouter } from "./routes/responder.js";
import { sdkRouter } from "./routes/sdk.js";
import { structureRouter } from "./routes/structure.js";
import { arrancarReloj } from "./pauta/reloj.js";
import { arrancarRelojDelLazo } from "./lazo/reloj.js";
import { arrancarAutoRespuesta } from "./autorespuesta/reloj.js";
import { autorespuestaRouter } from "./routes/autorespuesta.js";
import { webhookRouter } from "./webhook/ruta.js";
import { arrancarWhatsapp } from "./whatsapp/wiring.js";
import { rutaDevWhatsapp } from "./whatsapp/rutaDev.js";
import { whatsappRouter } from "./routes/whatsapp.js";
import { streamRouter } from "./routes/stream.js";
import { vincularRouter } from "./routes/vincular.js";
import { simularRouter } from "./routes/simular.js";
import { iviRouter } from "./routes/ivi.js";
import { catalogoRouter } from "./routes/catalogo.js";
import { adminRouter } from "./routes/admin.js";
import { requiereServicio } from "./auth/servicio.js";
import { db } from "./db/client.js";
import { sembrarAliasCurso } from "./cursos/repositorio.js";
import { arrancarDespachador } from "./bot/despachador.js";
import { configDesdeEnv, anunciarConfig } from "./bot/config.js";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4100;

app.use(cors());

// EL PERÍMETRO (issue #36): la API es pública por HTTPS, así que TODO /api/*
// exige el token de una vendedora — cerrado por defecto, las excepciones viven
// enumeradas con su porqué en auth/perimetro.ts. Va ANTES de montar cualquier
// router Y antes del parser de body: un request anónimo se rebota con 401 sin
// gastarle un parseo de JSON (el perímetro decide por path + header, jamás lee
// el body — hay un test que lo fija).
app.use(perimetroApi);
// El `verify` guarda el body CRUDO de /webhook/*: la firma HMAC del webhook de
// la Cloud API se calcula sobre los bytes exactos, no sobre el JSON re-serializado.
app.use(express.json({ verify: capturarCuerpoCrudo }));

// EL BFF: una sola llamada con todo lo que la home necesita. Solo Postgres, cero Meta.
// Reemplaza las 4 llamadas que la pantalla hacía al montar — una de ellas de 4 minutos.
app.use("/api/overview", overviewRouter);
app.use("/api/config", configRouter); // cuentas de pauta: en la base, no en localStorage
app.use("/webhook", webhookRouter);   // Cerberus manda cada venta acá → ontología → Meta, en vivo

// Las tres etapas de Meta, una por nivel.
app.use("/api/campaigns", campaignsRouter); // 1. campaña
app.use("/api/adsets", adsetsRouter); //      2. conjunto de anuncios
app.use("/api/ads", adsRouter); //            3. anuncio

app.use("/api/leads", leadsRouter);
app.use("/api/auth", authRouter); // login de vendedoras contra Cerberus
app.use("/api/contactos", contactosRouter); // la ficha del contacto contra Cerberus
app.use("/api/agenda", agendaRouter); // los seguimientos agendados de cada vendedora
app.use("/api/gestiones", gestionesRouter); // bitácora comercial: etapas, próximas acciones, etiquetas
app.use("/api/categorias", categoriasRouter); // catálogo de categorías con color, por vendedora (#48)
app.use("/api/senales", senalesRouter); // cotizado / se enfrió: etiquetas derivadas, no guardadas (ADR 0016)
app.use("/api/resultados", resultadosRouter); // el lazo: qué pieza cierra ventas y cuál solo gasta mensajes (#169)
app.use("/api/plantillas", plantillasRouter); // secuencias de venta: un paso por llamada, nunca un bucle en el server
app.use("/api/sugerencias", sugerenciasRouter); // las dos respuestas listas del panel derecho
app.use("/api/hechos", hechosRouter); // los datos recomendados: la munición de una línea (#153)
app.use("/api/dashboard", dashboardRouter); // el radar: leads cayendo + números por vendedora
app.use("/webhook/landing", landingRouter); // los leads de las landings, reenviados por Bravo
app.use("/api/correos", correosRouter); // email 1-a-1, auditado — sin listas, sin campañas
app.use("/api/notas", notasRouter); // el «Notion» a una tecla — editable, por autora, no deriva nada
app.use("/api/venta", ventaRouter); // el formulario de venta dentro de Hermes
app.use("/api/interactions", interactionsRouter);
app.use("/api/conversaciones", conversacionesRouter); // la cola unificada: una fila por conversación
app.use("/api/responder", responderRouter);
app.use("/api/persona", personaRouter);
app.use("/api/gente", genteRouter); // la persona canónica del grafo: su 360 y la búsqueda
app.use("/api/enlaces", enlacesRouter); // «es la misma persona que…»: el enlace manual, reversible (#58)
app.use("/api/meta", metaAssetsRouter);
app.use("/api/audiences", audiencesRouter);
app.use("/api/decisions", decisionsRouter); // el feed: qué requiere atención
app.use("/api/structure", structureRouter); // las 3 etapas anidadas, con la plata en cada nivel

// EL SDK: lo mismo, pero con la forma de la PREGUNTA en vez de la de la pantalla. Se autodescribe
// en /api/sdk/catalogo. Lo consumen el verificador de CQs hoy, Ivi y MCP después.
app.use("/api/sdk", sdkRouter);

app.use("/api/ivi", iviRouter()); // el proxy al cerebro RAG en geografo (issue #61)

// EL CATÁLOGO DE PIEZAS, para que Ivi pueda ELEGIR sin inventar (H8/H9, ADR 0023).
// Solo lectura, detrás de su propia credencial de servicio: lo consume una máquina,
// no una vendedora. Si no se puede servir devuelve 5xx — nunca una lista vacía.
app.use("/api/catalogo", catalogoRouter());

app.get("/health", (_req, res) => res.json({ ok: true }));

// WhatsApp: engancha el transporte (hoy el falso) a la ingesta, que persiste cada
// mensaje en el mismo event store que Facebook/Instagram. La ruta de dev para
// inyectar mensajes solo existe si corre el falso.
// Desde #50 esto monta N líneas y devuelve el gestor. La ruta de dev que inyecta
// mensajes recibe el GESTOR y no una línea: elegirle la línea a mano es lo que
// se quiere poder hacer desde ella, y sin eso el escenario de dos líneas —lo
// único que #50 agregó— no se puede reproducir en dev.
const gestor = arrancarWhatsapp();
const hayFalso = gestor.todos().some((l) => l.falso);
app.use("/api/stream", streamRouter);     // tiempo real: push de cambios (SSE)
app.use("/api/whatsapp", whatsappRouter); // conversación nativa: hilo + enviar
app.use("/api/autorespuesta", autorespuestaRouter); // el interruptor sin deploy de la auto-respuesta (#125)
// ⚠ /vincular queda FUERA del perímetro /api y sigue abierto: la consola del
// operador no tiene auth propia todavía (su HTML no manda Bearer). Contenerlo
// es decisión aparte (auth de operador, o bloquear /vincular en nginx) — ver #36.
app.use("/vincular", vincularRouter);     // consola de operador: enlazar un número (D13)
app.use("/api/admin", requiereServicio, adminRouter); // administración de números desde Cerberus (#50/#95)
// Las dos rutas de dev solo se montan fuera de producción; y su exención en el
// perímetro (auth/perimetro.ts) también es solo-dev — en prod no hay agujero
// que recordar, aunque alguien las montara igual.
if (process.env.NODE_ENV !== "production") {
  app.use("/api/whatsapp/_sim", simularRouter); // simular detección de origen (dev)
  if (hayFalso) app.use("/api/whatsapp/_dev", rutaDevWhatsapp(gestor));
}

// LA UI SERVIDA DESDE ACÁ (actualización "over the air", estilo EAS Update):
// si el build del front existe (dist/ en la raíz del repo), el server lo sirve.
// La app de escritorio empaquetada CARGA esta URL — actualizar Hermes para
// todas las vendedoras es `git pull + build + restart` en el server, sin
// reinstalar nada en ninguna máquina. La cáscara de Electron casi no cambia.
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
if (existsSync(join(DIST, "index.html"))) {
  app.use(express.static(DIST));
  // SPA fallback: cualquier ruta que no sea API/webhook devuelve la app.
  app.get(/^\/(?!api\/|webhook\/|vincular).*/, (_req, res) => {
    res.sendFile(join(DIST, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`hermes server listening on http://localhost:${port}`);
  // Lo único que LEE de Meta sin que nadie lo pida. Las pantallas leen Postgres.
  arrancarReloj();
  // Lo único que le ESCRIBE a Meta sin que nadie lo pida — y por eso arranca apagado.
  // Sin esto, Meta no se entera de una venta hasta que alguien corre `npm run lazo` a mano.
  // Costaba 273 ventas / $32.926 confirmadas y nunca reportadas. Ver lazo/reloj.ts.
  arrancarRelojDelLazo();
  // Lo único que le escribe a un CLIENTE sin que nadie apriete enviar (#125, ADR 0015).
  // Por eso son dos llaves y las dos arrancan apagadas: `AUTO_RESPUESTA=on` acá, y el
  // interruptor de la base que se apaga sin deploy. Ver autorespuesta/reloj.ts.
  arrancarAutoRespuesta();
  // El diccionario campaña → curso (#102) nace sembrado: sin filas, la propuesta
  // «vino por INTELIGENCIA» no existe y el deploy parecería no haber hecho nada.
  // Es idempotente y NO pisa lo editado a mano (`cursos/repositorio.ts`); si la
  // tabla todavía no está (falta `db:push`), avisa y sigue.
  sembrarAliasCurso(db)
    .then((n) => n > 0 && console.log(`[cursos] ${n} alias de curso sembrados`))
    .catch((err) =>
      console.error(
        `[cursos] no se pudo sembrar la tabla de alias (¿falta \`npm run db:push\`?): ${(err as Error).message}`,
      ),
    );

  // EL BOT ASESOR COMERCIAL — loop de despacho con debounce, modo sombra.
  // Sin credenciales de AWS, el despachador arranca pero sin LLM:
  // los claims se procesan igual y guardan bot_respuestas(estado: 'error').
  const cfgBot = configDesdeEnv();
  anunciarConfig(cfgBot);
  let clienteLLM: any = null;
  if (cfgBot.lineas.length > 0) {
    try {
      const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
      const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
      const region = process.env.AWS_REGION || "us-east-1";
      if (awsAccessKey && awsSecretKey && process.env.AWS_SESSION_TOKEN === undefined) {
        clienteLLM = new AnthropicBedrock({
          awsAccessKey,
          awsSecretKey,
          awsRegion: region,
        }) as any;
        arrancarDespachador(cfgBot, clienteLLM);
      } else {
        console.warn("[bot] AWS credenciales no configuradas o detectado AWS_SESSION_TOKEN: despachador no arranca");
      }
    } catch (err) {
      console.error("[bot] no se pudo crear cliente Bedrock:", (err as Error).message);
    }
  }
});
