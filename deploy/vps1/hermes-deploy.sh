#!/usr/bin/env bash
# hermes-deploy — promueve un commit a producción en VPS1. LA ÚNICA implementación.
#
# La usan las dos vías, y por eso son la misma cosa:
#   · el workflow «Desplegar server (con restart)» (Actions, con confirmación)
#   · una persona por SSH, cuando Actions no está disponible
#
# Que exista una sola implementación no es prolijidad: cuando «desplegar a mano» y
# «desplegar por pipeline» son dos códigos distintos, divergen, y la que se usa a las
# 2 AM es siempre la que nadie probó.
#
# Se instala desde el repo, no se edita en el servidor:
#   sudo install -m 0755 deploy/vps1/hermes-deploy.sh /usr/local/bin/hermes-deploy
#
#   sudo hermes-deploy                 # promueve origin/main
#   sudo hermes-deploy <sha|tag|rama>  # promueve un commit concreto
#   sudo hermes-deploy --rollback      # vuelve al último SHA que estuvo sano
#   sudo hermes-deploy --dry-run       # dice qué haría y qué migraciones traería
#   sudo hermes-deploy --sin-migrar    # NO aplica migraciones (para desenredar a mano)
#
# Qué hace, en orden: respalda la base si hay migraciones · cambia el código · instala
# dependencias si cambiaron · migra · construye el front aparte y lo cambia de lugar ·
# reinicia · espera /health · corre el smoke funcional. Si algo de eso falla DESPUÉS de
# haber tocado el código, revierte solo y verifica que lo revertido esté sano.
#
# Por qué el rollback de código no necesita rollback de base: las migraciones son
# expand-only (solo agregar), regla que CI hace cumplir. El código viejo sigue
# funcionando contra el schema nuevo. Un DROP o un RENAME rompen esa propiedad y por
# eso van en un deploy posterior, nunca junto al código que los estrena.

set -euo pipefail

RAIZ=/srv/hermes
USUARIO=deploy
SERVICIO=hermes
API_PUBLICA=https://hermes-api.goberna.us
SALUD=http://127.0.0.1:4110/health
CONTENEDOR_DB=hermes_db
DIR_RESPALDOS=/srv/respaldos-hermes
BITACORA=/var/log/hermes-deploy.log
# Fuera del checkout, para no ensuciarlo. Es el MISMO archivo que usa ci.yml: el SHA
# del server que está corriendo no es el del checkout (el proceso se quedó con el
# código que había al último restart).
ESTADO="/home/$USUARIO/.hermes-despliegue"

REF=origin/main
ROLLBACK=0
DRY=0
MIGRAR=1

for arg in "$@"; do
  case "$arg" in
    --rollback)   ROLLBACK=1 ;;
    --dry-run)    DRY=1 ;;
    --sin-migrar) MIGRAR=0 ;;
    -h | --help)  sed -n '2,30p' "$0"; exit 0 ;;
    -*)           echo "opción desconocida: $arg" >&2; exit 2 ;;
    *)            REF="$arg" ;;
  esac
done

decir() {
  printf '\033[1;34m▸ %s\033[0m\n' "$*"
  printf '%s  %s\n' "$(date -Is)" "$*" >> "$BITACORA" 2>/dev/null || true
}
fallar() {
  printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2
  printf '%s  ERROR %s\n' "$(date -Is)" "$*" >> "$BITACORA" 2>/dev/null || true
  exit 1
}
como_deploy() { runuser -u "$USUARIO" -- "$@"; }

[ "$(id -u)" -eq 0 ] || fallar "corré con sudo (necesita systemctl y runuser)"
touch "$BITACORA" 2>/dev/null || true
mkdir -p "$ESTADO" && chown "$USUARIO": "$ESTADO"

decir "deploy pedido por ${SUDO_USER:-root} · ref=$REF migrar=$MIGRAR rollback=$ROLLBACK"

# ── Regla dura #6: ante drift prod≠git, avisar antes de tocar ────────────────────
# `-uno` a propósito: dist.anterior y compañía son artefactos, no drift.
if [ -n "$(como_deploy git -C "$RAIZ" status --porcelain -uno)" ]; then
  como_deploy git -C "$RAIZ" status --short -uno >&2
  fallar "$RAIZ tiene cambios sin commitear. Miralos antes de descartarlos: puede ser un parche de emergencia que nadie subió."
fi

como_deploy git -C "$RAIZ" fetch --quiet --all --prune --tags

# El SHA del server CORRIENDO sale del archivo de estado, no del checkout.
if [ -f "$ESTADO/server" ]; then
  VIEJO="$(cat "$ESTADO/server")"
else
  VIEJO="$(como_deploy git -C "$RAIZ" rev-parse HEAD)"
fi

if [ "$ROLLBACK" -eq 1 ]; then
  [ -f "$ESTADO/ultimo-sano" ] || fallar "no hay $ESTADO/ultimo-sano — no sé a qué volver"
  REF="$(cat "$ESTADO/ultimo-sano")"
  decir "rollback pedido: volviendo a ${REF:0:8}"
fi

NUEVO="$(como_deploy git -C "$RAIZ" rev-parse "$REF")"

# ¿El rango trae migraciones? Decide si hace falta respaldar la base.
TOCADOS="$(como_deploy git -C "$RAIZ" diff --name-only "$VIEJO..$NUEVO" 2>/dev/null || true)"
TRAE_MIGRACION="$(printf '%s\n' "$TOCADOS" | grep -E '^server/drizzle/' || true)"
CAMBIO_DEPS_RAIZ="$(printf '%s\n' "$TOCADOS" | grep -E '^(package\.json|package-lock\.json)$' || true)"
CAMBIO_DEPS_SERVER="$(printf '%s\n' "$TOCADOS" | grep -E '^server/(package\.json|package-lock\.json)$' || true)"

if [ "$DRY" -eq 1 ]; then
  decir "DRY-RUN — ${VIEJO:0:8} → ${NUEVO:0:8}"
  como_deploy git -C "$RAIZ" --no-pager log --oneline "$VIEJO..$NUEVO" || true
  if [ -n "$TRAE_MIGRACION" ]; then
    echo; decir "trae migraciones:"; printf '%s\n' "$TRAE_MIGRACION"
  fi
  exit 0
fi

if [ "$VIEJO" = "$NUEVO" ] && [ "$ROLLBACK" -eq 0 ]; then
  decir "producción ya está en ${NUEVO:0:8} — nada que hacer"
  exit 0
fi

# ── Respaldo de la base, ANTES de migrar ────────────────────────────────────────
# Solo si el rango trae migraciones: un dump por cada deploy de código sería ruido.
if [ -n "$TRAE_MIGRACION" ] && [ "$MIGRAR" -eq 1 ]; then
  # Usuario y base salen del DATABASE_URL, que es la única fuente de verdad de a qué
  # base le habla el server. La contraseña de esa URL no se toca: `docker exec` entra
  # al contenedor, donde la autenticación local ya está resuelta.
  DBU="$(sed -n 's|^DATABASE_URL=||p' "$RAIZ/server/.env")"
  DBUSER="$(printf '%s' "$DBU" | sed -E 's|postgresql://([^:]+):.*|\1|')"
  DBNAME="$(printf '%s' "$DBU" | sed -E 's|.*/([^/?]+)$|\1|')"
  [ -n "$DBUSER" ] && [ -n "$DBNAME" ] || fallar "no pude leer usuario/base del DATABASE_URL de $RAIZ/server/.env"

  mkdir -p "$DIR_RESPALDOS"
  chown "$USUARIO":hermes "$DIR_RESPALDOS" 2>/dev/null || true
  ARCHIVO="$DIR_RESPALDOS/hermes_db-$(date +%Y%m%d-%H%M%S)-pre-${NUEVO:0:8}.sql.gz"
  decir "trae migraciones → respaldando la base en $ARCHIVO"
  docker exec "$CONTENEDOR_DB" pg_dump -U "$DBUSER" -d "$DBNAME" | gzip > "$ARCHIVO" \
    || fallar "el respaldo falló — NO sigo con una migración sin red"
  chown "$USUARIO":hermes "$ARCHIVO" 2>/dev/null || true
  decir "respaldo listo ($(du -h "$ARCHIVO" | cut -f1))"
  # Se conservan los últimos 20: suficiente para volver atrás, no tanto como para
  # llenar el disco sin que nadie mire.
  ls -1t "$DIR_RESPALDOS"/hermes_db-*.sql.gz 2>/dev/null | tail -n +21 | xargs -r rm -f
fi

# ── El cambio ───────────────────────────────────────────────────────────────────
decir "checkout de ${NUEVO:0:8}"
como_deploy git -C "$RAIZ" checkout --quiet --force --detach "$NUEVO"

if [ -n "$CAMBIO_DEPS_SERVER" ] || [ "$ROLLBACK" -eq 1 ]; then
  decir "dependencias del server"
  como_deploy npm --prefix "$RAIZ/server" ci --no-audit --no-fund
fi
if [ -n "$CAMBIO_DEPS_RAIZ" ] || [ "$ROLLBACK" -eq 1 ]; then
  decir "dependencias del front"
  como_deploy env ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm --prefix "$RAIZ" ci --no-audit --no-fund
fi

if [ -n "$TRAE_MIGRACION" ] && [ "$MIGRAR" -eq 1 ]; then
  # Guardia: una base que existía ANTES de las migraciones no tiene la tabla de
  # registro, así que `migrate` intentaría aplicar el baseline y moriría en el primer
  # `CREATE TABLE` con un error que no dice nada de lo que pasa. Se detecta antes y se
  # dice qué hacer. Ver docs/migraciones.md §«Adoptar una base que ya existía».
  REGISTRO="$(docker exec "$CONTENEDOR_DB" psql -U "$DBUSER" -d "$DBNAME" -tAc \
    "select to_regclass('drizzle.__drizzle_migrations') is not null" 2>/dev/null | tr -d '[:space:]')"
  if [ "$REGISTRO" = "f" ]; then
    fallar "la base no tiene drizzle.__drizzle_migrations: nunca se adoptó el baseline.
       Migrar ahora intentaría recrear tablas que ya existen.
       Corré primero (y leé docs/migraciones.md antes):
         cd $RAIZ/server && npm run db:adoptar        # dice qué haría
         cd $RAIZ/server && npm run db:adoptar -- --si"
  fi

  decir "aplicando migraciones"
  como_deploy bash -c "cd '$RAIZ/server' && npm run db:migrate" \
    || fallar "la migración falló. La base quedó como estaba salvo lo que alcanzó a aplicar; el respaldo está en $DIR_RESPALDOS. NO reinicié el servicio."
fi

# El front se construye APARTE y se cambia de lugar al final: `vite build` vacía el
# directorio de salida antes de escribir, y hacerlo sobre `dist/` dejaría la app
# sirviendo 404 durante todo el build. Efecto lateral bienvenido: `dist.anterior` es
# el rollback del front, a un `mv` de distancia.
decir "build del front"
como_deploy rm -rf "$RAIZ/dist.nuevo"
como_deploy bash -c "cd '$RAIZ' && env VITE_API_URL='$API_PUBLICA' npx vite build --outDir dist.nuevo --emptyOutDir"
[ -f "$RAIZ/dist.nuevo/index.html" ] || fallar "el build no dejó index.html"
como_deploy rm -rf "$RAIZ/dist.anterior"
como_deploy mv "$RAIZ/dist" "$RAIZ/dist.anterior"
como_deploy mv "$RAIZ/dist.nuevo" "$RAIZ/dist"

decir "reiniciando $SERVICIO"
systemctl restart "$SERVICIO"

# ── Verificación (regla dura #2) ────────────────────────────────────────────────
revertir() {
  local motivo="$1"
  printf '\033[1;31m✗ %s\033[0m\n' "$motivo" >&2
  journalctl -u "$SERVICIO" -n 40 --no-pager >&2 || true

  if [ "$ROLLBACK" -eq 1 ]; then
    fallar "esto YA era un rollback y tampoco levanta — hace falta una persona"
  fi

  decir "REVIRTIENDO a ${VIEJO:0:8}"
  como_deploy git -C "$RAIZ" checkout --quiet --force --detach "$VIEJO"
  como_deploy npm --prefix "$RAIZ/server" ci --no-audit --no-fund || true
  # El dist viejo está a un mv: más rápido y más seguro que reconstruirlo.
  if [ -d "$RAIZ/dist.anterior" ]; then
    como_deploy rm -rf "$RAIZ/dist.roto"
    como_deploy mv "$RAIZ/dist" "$RAIZ/dist.roto"
    como_deploy mv "$RAIZ/dist.anterior" "$RAIZ/dist"
  fi
  systemctl restart "$SERVICIO"

  for _ in $(seq 1 20); do
    if curl -fsS --max-time 3 "$SALUD" >/dev/null 2>&1; then
      echo "$VIEJO" > "$ESTADO/server"; chown "$USUARIO": "$ESTADO/server"
      fallar "el deploy de ${NUEVO:0:8} falló ($motivo) — producción quedó revertida en ${VIEJO:0:8} y responde"
    fi
    sleep 2
  done
  fallar "el deploy falló Y el rollback tampoco levanta — PRODUCCIÓN CAÍDA, hace falta una persona YA"
}

decir "esperando /health"
sano=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 "$SALUD" | grep -q '"ok":true'; then
    sano=1; decir "arriba en ~$((i * 2)) s"; break
  fi
  sleep 2
done
[ "$sano" -eq 1 ] || revertir "no contesta /health después de 60 s"

# El smoke funcional: /health dice que el proceso arrancó, no que la app sirva. Con la
# base a medio migrar /health sigue en {ok:true} y la vendedora abre una pantalla vacía.
decir "smoke funcional contra la URL pública"
como_deploy bash -c "cd '$RAIZ/server' && BASE_URL='$API_PUBLICA' npm run humo" \
  || revertir "el smoke funcional falló"

# ── Quedó sano ──────────────────────────────────────────────────────────────────
echo "$NUEVO" > "$ESTADO/server"
echo "$NUEVO" > "$ESTADO/front"
echo "$VIEJO" > "$ESTADO/ultimo-sano"   # a dónde vuelve `--rollback`
chown "$USUARIO": "$ESTADO"/*

decir "OK — producción en ${NUEVO:0:8} ($(como_deploy git -C "$RAIZ" log -1 --format=%s))"
