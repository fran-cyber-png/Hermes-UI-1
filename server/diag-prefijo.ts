import { config } from "dotenv";
config();
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { db } from "./src/db/client.js";
import { hiloDe } from "./src/whatsapp/hilo.js";
import { crearAgente } from "./src/bot/agente.js";
import { armarSystemPrompt } from "./src/bot/prompt.js";
import { CATALOGO_POR_DEFECTO } from "./src/hechos/catalogo.js";
import { piezasParaElBot } from "./src/bot/recuperador.js";
import { recolectarContextoContacto, aBloqueDePrompt } from "./src/bot/contexto.js";

const CLAVE = "conv:whatsapp:5215543219876:51984429504";
const NUMERO_PROPIO = "51984429504";

async function main() {
  const cliente = new AnthropicBedrock({
    awsAccessKey: process.env.AWS_ACCESS_KEY_ID,
    awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
    awsRegion: process.env.AWS_REGION || "us-east-1",
  });

  const telefono = CLAVE.split(":")[2]!;
  const hilo = (await hiloDe(db, telefono, NUMERO_PROPIO).catch(() => [])) as {
    direccion: string; texto: string | null;
  }[];
  const historial = hilo.slice(-20).filter((m) => m.texto).map((m) => ({
    rol: (m.direccion === "saliente" ? "nosotros" : "lead") as "lead" | "nosotros",
    texto: m.texto ?? "",
  }));

  const c = await recolectarContextoContacto(CLAVE, NUMERO_PROPIO);
  console.log("== contacto resuelto ==");
  console.log(JSON.stringify({ nombre: c.nombre, procedenciaNombre: c.procedenciaNombre, pais: c.pais, procedenciaPais: c.procedenciaPais }, null, 2));
  console.log("== bloque <contacto> ==");
  console.log(aBloqueDePrompt(c));
  console.log("== historial ==");
  console.log(JSON.stringify(historial, null, 2));

  const piezas = await piezasParaElBot(CLAVE);
  const system = armarSystemPrompt({ hechos: [...CATALOGO_POR_DEFECTO], piezas, lecciones: [] });

  const agente = crearAgente(cliente as never);
  const r = await agente.responder({
    historial,
    contactoCtx: aBloqueDePrompt(c),
    hechos: [...CATALOGO_POR_DEFECTO],
    piezas,
    lecciones: [],
    modelo: process.env.BOT_MODELO || "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  });

  console.log("== respuesta agente ==");
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
