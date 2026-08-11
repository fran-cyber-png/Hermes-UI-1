/**
 * CUÁL ES LA LÍNEA DE CLOUD API — la única sobre la que el ruteo por campaña
 * tiene sentido.
 *
 * 🔴 **Sale del ENV y no del gestor de WhatsApp, y la diferencia importa.** El
 * primer borrador la buscaba como el webhook (`gestorWhatsappSiActivo()` → la
 * línea cuyo transporte es `TransporteCloudApi`), y eso ata la pantalla a que el
 * transporte esté ARRIBA: con el proceso caído, Routing decía «no hay línea de
 * Cloud API» —o sea, «acá no se puede decidir nada»— mientras las reglas
 * seguían guardadas y el webhook seguía aplicándolas. Un ruteo es CONFIGURACIÓN:
 * se mira y se cambia justo cuando algo anda mal.
 *
 * No son dos fuentes: `whatsapp/wiring.ts` monta esa línea leyendo **esta misma
 * variable** y le pasa el valor tal cual como `numero`, que es el
 * `numero_propio` con el que el webhook escribe en `conversacion_asignada`. Leer
 * el env es leer lo mismo, un paso antes.
 *
 * ⚠️ Las tres líneas de las vendedoras son whatsmeow y **no pueden aparecer acá**:
 * el `referral` con el anuncio lo manda Meta y solo llega por su webhook. Ofrecer
 * la pantalla para esas líneas sería ofrecer una decisión que no se puede tomar.
 */
export function lineaDeCloudApi(env: NodeJS.ProcessEnv = process.env): string | null {
  const numero = (env.WHATSAPP_CLOUD_API_NUMERO_PROPIO ?? "").trim();
  return numero || null;
}
