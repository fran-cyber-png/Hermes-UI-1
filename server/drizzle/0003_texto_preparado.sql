ALTER TABLE "auto_respuestas_pendientes" ADD COLUMN "texto_preparado" text;--> statement-breakpoint
-- ── BACKFILL (#186): solo lo que se puede afirmar, y nada más ────────────────
--
-- OJO — esto matiza lo que decía el issue. Ahí escribí «no rellenar con `texto`,
-- eso afirmaría que no hubo edición, que es justo lo que no sabemos». Es cierto
-- EN GENERAL, pero no cuando `editada = false`: ahí sí sabemos que nadie la tocó,
-- y `texto` ES, por definición, el texto que se preparó. Copiarlo no inventa nada;
-- lo deriva de un hecho que la propia tabla ya registra.
--
-- Donde `editada = true` NO se toca: el original se pisó y no está en ningún lado.
-- Esas filas quedan NULL = «no se registró», que es la verdad. Rellenarlas con
-- `texto` diría que la máquina propuso exactamente lo que la vendedora reescribió
-- — la afirmación más equivocada posible, y justo la que arruinaría el promedio de
-- «cuánto se edita cada plantilla» hacia el lado optimista.
--
-- Al 2026-07-27 hay 40 filas en la tabla y las 40 tienen `editada = false`, así que
-- esto las recupera todas. La condición igual queda escrita: es lo que hace que la
-- migración siga siendo correcta si alguien la corre más tarde, con ediciones ya
-- hechas.
UPDATE "auto_respuestas_pendientes"
   SET "texto_preparado" = "texto"
 WHERE "texto_preparado" IS NULL
   AND "editada" = false;
