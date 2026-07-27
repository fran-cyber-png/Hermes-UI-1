ALTER TABLE "interactions" ADD COLUMN "numero_propio" text;--> statement-breakpoint
CREATE INDEX "interactions_numero_propio_idx" ON "interactions" USING btree ("numero_propio","occurred_at");--> statement-breakpoint
-- ── BACKFILL (#185): el dato nunca se perdió, solo no estaba materializado ──
--
-- `proyectar.ts` ya declaraba que "lo que hoy no proyectamos (desde qué número)
-- tiene que poder reconstruirse desde acá": el crudo del evento SIEMPRE guardó
-- `numeroPropio`. Esto es exactamente esa reconstrucción, hecha una vez.
--
-- Va en la migración y no en un script aparte para que las filas históricas y las
-- nuevas signifiquen lo mismo desde el primer deploy. Si quedara para "después",
-- habría una ventana en la que la columna existe, está medio llena, y cualquier
-- consulta que agrupe por línea daría un resultado incompleto sin decirlo.
--
-- Idempotente por el `IS NULL`: correrlo dos veces no pisa nada.
--
-- Lo que NO hace, a propósito: no rellena las que no se puedan derivar. Una fila
-- sin `numeroPropio` en su crudo queda NULL = "no se sabe". Asignarle la línea más
-- probable convertiría una laguna en un dato falso, justo en la columna que existe
-- para separar a una vendedora de otra.
UPDATE "interactions" i
   SET "numero_propio" = e."payload"->>'numeroPropio'
  FROM "events" e
 WHERE e."id" = i."event_id"
   AND i."canal" = 'whatsapp'
   AND i."numero_propio" IS NULL
   AND e."payload"->>'numeroPropio' IS NOT NULL;
