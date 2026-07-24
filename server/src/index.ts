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
import { dashboardRouter } from "./routes/dashboard.js";
import { landingRouter } from "./webhook/landing.js";
import { correosRouter } from "./routes/correos.js";
import { notasRouter } from "./routes/notas.js";
import { ventaRouter } from "./routes/venta.js";
import { leadsRouter } from "./routes/leads.js";
import { metaAssetsRouter } from "./routes/metaAssets.js";
import { overviewRouter } from "./routes/overview.js";
import { personaRouter } from "./routes/persona.js";
import { genteRouter } from "./routes/gente.js";
import { responderRouter } from "./routes/responder.js";
import { sdkRouter } from "./routes/sdk.js";
import { structureRouter } from "./routes/structure.js";
import { arrancarReloj } from "./pauta/reloj.js";
import { arrancarRelojDelLazo } from "./lazo/reloj.js";
import { webhookRouter } from "./webhook/ruta.js";
import { arrancarWhatsapp } from "./whatsapp/wiring.js";
import { rutaDevWhatsapp } from "./whatsapp/rutaDev.js";
import { whatsappRouter } from "./routes/whatsapp.js";
import { streamRouter } from "./routes/stream.js";
import { vincularRouter } from "./routes/vincular.js";
import { simularRouter } from "./routes/simular.js";
import { iviRouter } from "./routes/ivi.js";
import { adminRouter } from "./routes/admin.js";
import { requiereServicio } from "./auth/servicio.js";

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
app.use("/api/auth", authRouter); // login de vendedoras contra Cerberus
app.use("/api/contactos", contactosRouter); // la ficha del contacto contra Cerberus
app.use("/api/agenda", agendaRouter); // los seguimientos agendados de cada vendedora
app.use("/api/gestiones", gestionesRouter); // bitácora comercial: etapas, próximas acciones, etiquetas
app.use("/api/categorias", categoriasRouter); // catálogo de categorías con color, por vendedora (#48)
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
app.use("/api/meta", metaAssetsRouter);
app.use("/api/audiences", audiencesRouter);
app.use("/api/decisions", decisionsRouter); // el feed: qué requiere atención
app.use("/api/structure", structureRouter); // las 3 etapas anidadas, con la plata en cada nivel

// EL SDK: lo mismo, pero con la forma de la PREGUNTA en vez de la de la pantalla. Se autodescribe
// en /api/sdk/catalogo. Lo consumen el verificador de CQs hoy, Ivi y MCP después.
app.use("/api/sdk", sdkRouter);

app.use("/api/ivi", iviRouter()); // el proxy al cerebro RAG en geografo (issue #61)

app.get("/health", (_req, res) => res.json({ ok: true }));

// WhatsApp: engancha el transporte (hoy el falso) a la ingesta, que persiste cada
// mensaje en el mismo event store que Facebook/Instagram. La ruta de dev para
// inyectar mensajes solo existe si corre el falso.
const { falso } = arrancarWhatsapp();
app.use("/api/stream", streamRouter);     // tiempo real: push de cambios (SSE)
app.use("/api/whatsapp", whatsappRouter); // conversación nativa: hilo + enviar
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
  if (falso) app.use("/api/whatsapp/_dev", rutaDevWhatsapp(falso));
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
});
