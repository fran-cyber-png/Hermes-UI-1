import "dotenv/config";
import cors from "cors";
import express from "express";
import { adsRouter } from "./routes/ads.js";
import { audiencesRouter } from "./routes/audiences.js";
import { adsetsRouter } from "./routes/adsets.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { configRouter } from "./routes/config.js";
import { decisionsRouter } from "./routes/decisions.js";
import { interactionsRouter } from "./routes/interactions.js";
import { leadsRouter } from "./routes/leads.js";
import { metaAssetsRouter } from "./routes/metaAssets.js";
import { overviewRouter } from "./routes/overview.js";
import { personaRouter } from "./routes/persona.js";
import { genteRouter } from "./routes/gente.js";
import { responderRouter } from "./routes/responder.js";
import { sdkRouter } from "./routes/sdk.js";
import { structureRouter } from "./routes/structure.js";
import { pautaMaestroRouter } from "./routes/pautaMaestro.js";
import { arrancarReloj } from "./pauta/reloj.js";
import { arrancarRelojDelLazo } from "./lazo/reloj.js";
import { webhookRouter } from "./webhook/ruta.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4100;

app.use(cors());
app.use(express.json());

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
app.use("/api/interactions", interactionsRouter);
app.use("/api/responder", responderRouter);
app.use("/api/persona", personaRouter);
app.use("/api/gente", genteRouter); // la persona canónica del grafo: su 360 y la búsqueda
app.use("/api/meta", metaAssetsRouter);
app.use("/api/audiences", audiencesRouter);
app.use("/api/decisions", decisionsRouter); // el feed: qué requiere atención
app.use("/api/structure", structureRouter); // las 3 etapas anidadas, con la plata en cada nivel
app.use("/api/pauta-maestro", pautaMaestroRouter); // el maestro: todas las pautas por país y curso

// EL SDK: lo mismo, pero con la forma de la PREGUNTA en vez de la de la pantalla. Se autodescribe
// en /api/sdk/catalogo. Lo consumen el verificador de CQs hoy, Ivi y MCP después.
app.use("/api/sdk", sdkRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(port, () => {
  console.log(`meta-escuela server listening on http://localhost:${port}`);
  // Lo único que LEE de Meta sin que nadie lo pida. Las pantallas leen Postgres.
  arrancarReloj();
  // Lo único que le ESCRIBE a Meta sin que nadie lo pida — y por eso arranca apagado.
  // Sin esto, Meta no se entera de una venta hasta que alguien corre `npm run lazo` a mano.
  // Costaba 273 ventas / $32.926 confirmadas y nunca reportadas. Ver lazo/reloj.ts.
  arrancarRelojDelLazo();
});
