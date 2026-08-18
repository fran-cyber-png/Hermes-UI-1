#!/usr/bin/env bash
# Copia la base de PRODUCCIÓN de Hermes sobre la de PRUEBAS. Dry-run por default.
#
#   sudo -u deploy /srv/hermes-staging/app/deploy/vps1/refrescar-datos-pruebas.sh
#   ... --aplicar
#
# 🔴 La dirección es UNA SOLA: prod → pruebas. Hay dos guardas y las dos son por el
#    mismo motivo — un dedazo acá restaura sobre la base de las vendedoras.
# ⚠️ A pedido, nunca por cron: pisaría lo que alguien esté probando.
#
# El orden importa y es lo que hace útil al refresco:
#   1. se restaura el estado de PRODUCCIÓN (schema + datos)
#   2. se corren las migraciones de `desarrollo` ENCIMA
# O sea que además de traer datos, ensaya la migración pendiente contra datos reales
# — que es exactamente lo que una base sembrada no puede hacer.
set -euo pipefail

ORIGEN="${ORIGEN:-hermes_db}"                 # contenedor de producción (5438)
DESTINO="${DESTINO:-hermes_staging_db}"       # contenedor de pruebas   (5440)
DB_PRUEBAS="${DB_PRUEBAS:-hermes_staging}"
SRV_PRUEBAS="${SRV_PRUEBAS:-/srv/hermes-staging}"
APLICAR=0
[ "${1:-}" = "--aplicar" ] && APLICAR=1

# ── Las guardas ───────────────────────────────────────────────────────────────
if [ "$DESTINO" = "$ORIGEN" ] || [ "$DESTINO" = "hermes_db" ]; then
  echo "ERROR: el destino es producción ($DESTINO). Este script solo escribe en pruebas." >&2
  exit 1
fi
case "$DESTINO" in
  *staging*|*pruebas*) : ;;
  *) echo "ERROR: el destino ($DESTINO) no dice 'staging' ni 'pruebas'. Me niego." >&2; exit 1 ;;
esac
for c in "$ORIGEN" "$DESTINO"; do
  docker inspect "$c" >/dev/null 2>&1 || { echo "ERROR: no existe el contenedor $c" >&2; exit 1; }
done

TAMANO=$(docker exec "$ORIGEN" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT pg_size_pretty(pg_database_size(current_database()))"' 2>/dev/null || echo "?")

echo "origen : $ORIGEN (producción, solo lectura) — $TAMANO"
echo "destino: $DESTINO / $DB_PRUEBAS"

if [ "$APLICAR" -ne 1 ]; then
  echo
  echo "DRY-RUN. Haría: pg_dump de producción → DROP/CREATE de $DB_PRUEBAS → restore → db:migrate."
  echo "Para hacerlo de verdad: $0 --aplicar"
  exit 0
fi

VOLCADO="/tmp/hermes-pruebas-$(date +%Y%m%d-%H%M%S).sql.gz"
echo "--- Volcando producción ---"
docker exec "$ORIGEN" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" --no-owner --no-privileges "$POSTGRES_DB"' \
  | gzip > "$VOLCADO"
echo "    $(du -h "$VOLCADO" | cut -f1)"

# El servicio se para: restaurar bajo un server que está escribiendo deja la base a medias.
echo "--- Parando hermes-staging ---"
sudo systemctl stop hermes-staging

echo "--- Recreando $DB_PRUEBAS ---"
docker exec "$DESTINO" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
     -c "DROP DATABASE IF EXISTS '"$DB_PRUEBAS"'_tmp" \
     -c "CREATE DATABASE '"$DB_PRUEBAS"'_tmp"'

echo "--- Restaurando ---"
gunzip -c "$VOLCADO" | docker exec -i "$DESTINO" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -q -U "$POSTGRES_USER" -d '"$DB_PRUEBAS"'_tmp' >/dev/null

# El swap va al final: si algo de arriba falló, la base vieja de pruebas sigue entera.
echo "--- Cambiando la base nueva por la vieja ---"
docker exec "$DESTINO" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
     -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE '"'"''"$DB_PRUEBAS"'%'"'"'" \
     -c "DROP DATABASE IF EXISTS '"$DB_PRUEBAS"'_viejo" \
     -c "ALTER DATABASE '"$DB_PRUEBAS"' RENAME TO '"$DB_PRUEBAS"'_viejo" \
     -c "ALTER DATABASE '"$DB_PRUEBAS"'_tmp RENAME TO '"$DB_PRUEBAS"'" \
     -c "DROP DATABASE '"$DB_PRUEBAS"'_viejo"'

echo "--- Migraciones de la rama de pruebas sobre los datos de producción ---"
(cd "$SRV_PRUEBAS/server" && npm run db:migrate)

sudo systemctl start hermes-staging
rm -f "$VOLCADO"

echo "OK. Pruebas tiene una copia de producción de $(date '+%d-%m-%Y %H:%M')."
echo
echo "🔴 Esa copia trae teléfonos y conversaciones de leads reales. Lo único que evita"
echo "   que les llegue un mensaje es WHATSAPP_TRANSPORTE=falso en el .env de pruebas."
echo "   Verificalo:  grep WHATSAPP_TRANSPORTE $SRV_PRUEBAS/server/.env"
