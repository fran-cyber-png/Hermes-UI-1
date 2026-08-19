import type { Router } from "express";
import { db } from "../db/client.js";
import { vinculador } from "../whatsapp/vinculador.js";
import { agregarLineaWhatsmeow, gestorWhatsappSiActivo } from "../whatsapp/wiring.js";
import { miLineaRouter } from "./miLinea.js";
import { sesionDeNumero } from "../numeros/estadoSesion.js";
import { lineasDeVendedoraConDuenas, marcarVinculado, obtenerNumero, upsertNumero } from "../numeros/repositorio.js";

/**
 * EL CABLEADO REAL DE «MI LÍNEA» — el único lugar que ata el router a la base,
 * al vinculador global y al gestor de WhatsApp.
 *
 * Vive aparte de `routes/miLinea.ts` a propósito, y no es estilo: importar
 * `db/client.js` **lanza al importar** si falta `DATABASE_URL`, y `wiring.js`
 * arrastra el binario Go de whatsmeow. Con esos imports adentro del router, un
 * test que sólo quisiera preguntarle «¿de quién es este pareo?» tenía que
 * levantar Postgres y whatsmeow — o sea que no se escribía. Acá se paga ese
 * costo una sola vez, en el arranque, que es donde corresponde.
 */
export function miLineaDeProduccion(): Router {
  return miLineaRouter({
    repositorio: {
      lineasDeVendedora: (vendedoraId) => lineasDeVendedoraConDuenas(db, vendedoraId),
      obtenerNumero: (numero) => obtenerNumero(db, numero),
      upsertNumero: (numero, datos) => upsertNumero(db, numero, datos),
      marcarVinculado: (numero) => marcarVinculado(db, numero),
    },
    vinculador,
    montarLinea: (numero) => {
      agregarLineaWhatsmeow(numero);
    },
    // `gestorWhatsappSiActivo()` y no `gestorWhatsapp()`: preguntar «¿esa línea
    // ya corre?» no puede tirar el request si WhatsApp todavía no arrancó. Sin
    // gestor, no corre nada — que es la respuesta correcta, no un error.
    lineaMontada: (numero) => Boolean(gestorWhatsappSiActivo()?.de(numero)),
    sesionDe: sesionDeNumero,
  });
}
