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
# Fuera del checkout, para no ensuciarlo. Son los MISMOS archivos que escribe el N4 de
# ci.yml y los que dejó el último deploy a mano por SSH: el SHA del server que está
# corriendo no es el del checkout (el proceso se quedó con el código que había al
# último restart).
#
#   server        el SHA que el proceso está EJECUTANDO. Lo escriben este script y N4
#                 (N4 solo cuando el rango no toca server/, así que la marca es honesta).
#   front         el SHA del dist/ que se está sirviendo. Igual.
#   ultimo-sano   a dónde vuelve `--rollback`: el SHA que estaba corriendo y sano ANTES
#                 del último deploy con restart. Lo escribe SOLO este script — N4 no lo
#                 toca porque un deploy de front no reinicia el server, así que no
#                 cambia cuál fue el último server sano.
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

# Usuario y base salen del DATABASE_URL, que es la única fuente de verdad de a qué
# base le habla el server. La contraseña de esa URL NO se toca: `docker exec` entra al
# contenedor, donde la autenticación local ya está resuelta (regla dura #1).
#
# Se parsea con expansiones de bash y no con `sed`, por una razón concreta: el `sed`
# anterior tenía `postgresql://` horneado, y `postgres://` —igual de válido para
# postgres.js y para drizzle— NO matcheaba, así que devolvía la URL ENTERA como si
# fuera el nombre de usuario. Eso terminaba en `pg_dump -U <url-con-contraseña>`, cuyo
# error va al log del run de Actions. Un typo en un esquema, y la contraseña de
# producción publicada. Acá el esquema se descarta sin mirarlo.
#
# Y se VALIDA: si lo que sale no parece un identificador, se falla. Un valor raro que
# igual «no está vacío» es exactamente cómo pasó desapercibido el bug anterior.
leer_datos_de_la_base() {
  local dbu sin_esquema credencial resto ruta
  dbu="$(sed -n 's|^DATABASE_URL=||p' "$RAIZ/server/.env" | head -1)"
  [ -n "$dbu" ] || fallar "no encontré DATABASE_URL en $RAIZ/server/.env"

  sin_esquema="${dbu#*://}"          # usuario:clave@host:puerto/base?params
  credencial="${sin_esquema%%@*}"    # usuario:clave
  resto="${sin_esquema#*@}"          # host:puerto/base?params
  ruta="${resto#*/}"                 # base?params
  DBUSER="${credencial%%:*}"
  DBNAME="${ruta%%\?*}"

  # NUNCA se imprime `$dbu` en el mensaje de error: lleva la contraseña.
  case "$DBUSER" in
    "" | *[!A-Za-z0-9_]*)
      fallar "el usuario que saqué del DATABASE_URL de $RAIZ/server/.env no parece un identificador. No lo imprimo (la URL lleva la contraseña): miralo vos." ;;
  esac
  case "$DBNAME" in
    "" | *[!A-Za-z0-9_-]*)
      fallar "la base que saqué del DATABASE_URL de $RAIZ/server/.env no parece un identificador. No la imprimo: miralo vos." ;;
  esac
}

# ¿La base ya adoptó el baseline? `f` = no, `t` = sí, vacío = no se pudo saber.
registro_de_migraciones() {
  docker exec "$CONTENEDOR_DB" psql -U "$DBUSER" -d "$DBNAME" -tAc \
    "select to_regclass('drizzle.__drizzle_migrations') is not null" 2>/dev/null | tr -d '[:space:]'
}

[ "$(id -u)" -eq 0 ] || fallar "corré con sudo (necesita systemctl y runuser)"

# UN SOLO DEPLOY A LA VEZ. El `concurrency` de Actions serializa los workflows, pero no
# sabe nada de un `sudo hermes-deploy` disparado por SSH — y este script se ofrece para
# eso a propósito. Dos corridas a la vez se pelean por el mismo worktree, por `dist/` y
# por los archivos de estado, y el `revertir()` de una pisaría el checkout de la otra.
exec 9>/var/lock/hermes-deploy
flock -n 9 || fallar "ya hay un deploy de Hermes corriendo (candado /var/lock/hermes-deploy). Esperá a que termine."

# El DRY-RUN no escribe: ni la bitácora, ni el directorio de estado. Un «decime qué
# harías» que deja archivos atrás no es un dry-run — la misma vara que le aplicamos a
# `db:adoptar`.
if [ "$DRY" -eq 0 ]; then
  touch "$BITACORA" 2>/dev/null || true
  mkdir -p "$ESTADO" && chown "$USUARIO": "$ESTADO"
fi

decir "deploy pedido por ${SUDO_USER:-root} · ref=$REF migrar=$MIGRAR rollback=$ROLLBACK"

# ── Regla dura #6: ante drift prod≠git, avisar antes de tocar ────────────────────
# `-uno` a propósito: dist.anterior y compañía son artefactos, no drift.
if [ -n "$(como_deploy git -C "$RAIZ" status --porcelain -uno)" ]; then
  como_deploy git -C "$RAIZ" status --short -uno >&2
  fallar "$RAIZ tiene cambios sin commitear. Miralos antes de descartarlos: puede ser un parche de emergencia que nadie subió."
fi

# `--prune --tags` borra refs locales, así que solo va cuando el deploy es de verdad.
if [ "$DRY" -eq 1 ]; then
  como_deploy git -C "$RAIZ" fetch --quiet origin
else
  como_deploy git -C "$RAIZ" fetch --quiet --all --prune --tags
fi

# El SHA del server CORRIENDO sale del archivo de estado, no del checkout.
if [ -f "$ESTADO/server" ]; then
  VIEJO="$(cat "$ESTADO/server")"
else
  VIEJO="$(como_deploy git -C "$RAIZ" rev-parse HEAD)"
fi

if [ "$ROLLBACK" -eq 1 ]; then
  if [ ! -f "$ESTADO/ultimo-sano" ]; then
    fallar "no hay $ESTADO/ultimo-sano — todavía no hubo un deploy por este script, que es
       quien lo escribe. Volvé indicando el SHA a mano:
         sudo hermes-deploy <sha>
       El SHA anterior sale de: git -C $RAIZ reflog | head, o del resumen del run de Actions."
  fi
  REF="$(cat "$ESTADO/ultimo-sano")"
  decir "rollback pedido: volviendo a ${REF:0:8}"
  # UN ROLLBACK NO TOCA LA BASE, a propósito. Las migraciones son expand-only (CI lo
  # hace cumplir), así que el código viejo funciona contra el schema nuevo: devolver
  # también el schema sería el paso peligroso e innecesario. Si alguna vez hiciera
  # falta, es restaurar el dump de /srv/respaldos-hermes a mano, con downtime y con
  # alguien mirando — nunca automático.
  MIGRAR=0
fi

NUEVO="$(como_deploy git -C "$RAIZ" rev-parse "$REF")"

# ¿El rango trae migraciones? Decide si hace falta respaldar la base.
#
# El fallo de este `git diff` NO se puede tragar. Antes era `2>/dev/null || true`, y con
# eso un `$VIEJO` inválido —un SHA podado por un force-push, un archivo de estado
# truncado— se convertía en «no cambió ningún archivo»: sin respaldo, sin migración,
# reiniciando el código nuevo contra el schema viejo. Fail-open en el único punto donde
# el diseño promete red.
if ! TOCADOS="$(como_deploy git -C "$RAIZ" diff --name-only "$VIEJO..$NUEVO" 2>&1)"; then
  fallar "no pude comparar ${VIEJO:0:8}..${NUEVO:0:8}: $TOCADOS
       Suele ser que el SHA de $ESTADO/server ya no existe en el repo.
       Miralo antes de seguir: si sigo, no sabría si hay migraciones que aplicar."
fi
TRAE_MIGRACION="$(printf '%s\n' "$TOCADOS" | grep -E '^server/drizzle/' || true)"
CAMBIO_DEPS_RAIZ="$(printf '%s\n' "$TOCADOS" | grep -E '^(package\.json|package-lock\.json)$' || true)"
CAMBIO_DEPS_SERVER="$(printf '%s\n' "$TOCADOS" | grep -E '^server/(package\.json|package-lock\.json)$' || true)"

if [ "$DRY" -eq 1 ]; then
  # UN DRY-RUN QUE MUESTRA EL RESULTADO Y NO LAS VARIABLES DE LA DECISIÓN NO VERIFICA
  # NADA. La lección salió cara: el simulacro de la auto-respuesta imprimió un plan
  # impecable que estaba mal de siete formas, porque decía a quién le iba a escribir y
  # no de dónde había sacado cada dato. Acá se imprime de dónde sale cada decisión.
  decir "DRY-RUN — ${VIEJO:0:8} → ${NUEVO:0:8}"
  echo
  echo "  ref pedida            : $REF → ${NUEVO:0:8}"
  if [ -f "$ESTADO/server" ]; then
    echo "  server corriendo      : ${VIEJO:0:8}  (de $ESTADO/server)"
  else
    echo "  server corriendo      : ${VIEJO:0:8}  (no hay marca de estado: es el HEAD del checkout)"
  fi
  echo "  archivos en el rango  : $(printf '%s\n' "$TOCADOS" | grep -c . || true)"
  echo "  npm ci del server     : $([ -n "$CAMBIO_DEPS_SERVER" ] && echo 'sí (cambió server/package*.json)' || echo no)"
  echo "  npm ci del front      : $([ -n "$CAMBIO_DEPS_RAIZ" ] && echo 'sí (cambió package*.json)' || echo no)"

  if [ -n "$TRAE_MIGRACION" ] && [ "$MIGRAR" -eq 1 ]; then
    leer_datos_de_la_base
    REGISTRO="$(registro_de_migraciones)"
    echo "  migraciones           : sí → se respalda la base ANTES de aplicarlas"
    case "$REGISTRO" in
      t) echo "  la base ya adoptó     : sí (drizzle.__drizzle_migrations existe)" ;;
      f) echo "  la base ya adoptó     : NO → este deploy va a FRENAR. Corré antes:
                          cd $RAIZ/server && npm run db:adoptar" ;;
      *) echo "  la base ya adoptó     : no se pudo saber (¿el contenedor $CONTENEDOR_DB está arriba?)" ;;
    esac
    printf '  %s\n' "$TRAE_MIGRACION"
  else
    echo "  migraciones           : $([ -n "$TRAE_MIGRACION" ] && echo 'las trae, pero --sin-migrar las saltea' || echo no)"
  fi

  echo "  reinicio de $SERVICIO   : sí — cada vendedora logueada pierde su sesión de Cerberus"
  if [ -f "$ESTADO/ultimo-sano" ]; then
    echo "  --rollback volvería a : $(cut -c1-8 < "$ESTADO/ultimo-sano")"
  else
    echo "  --rollback volvería a : nada todavía; este deploy deja ${VIEJO:0:8} como punto de vuelta"
  fi
  echo
  decir "commits que entran:"
  como_deploy git -C "$RAIZ" --no-pager log --oneline "$VIEJO..$NUEVO" || true
  exit 0
fi

if [ "$VIEJO" = "$NUEVO" ] && [ "$ROLLBACK" -eq 0 ]; then
  decir "producción ya está en ${NUEVO:0:8} — nada que hacer"
  exit 0
fi

# ── Respaldo de la base, ANTES de migrar ────────────────────────────────────────
# Solo si el rango trae migraciones: un dump por cada deploy de código sería ruido.
if [ -n "$TRAE_MIGRACION" ] && [ "$MIGRAR" -eq 1 ]; then
  leer_datos_de_la_base

  # La guardia del baseline va ANTES del respaldo: si la base nunca adoptó, este deploy
  # no puede migrar, y hacerle un dump de 200 MB para después frenar es ruido.
  REGISTRO="$(registro_de_migraciones)"
  if [ "$REGISTRO" = "f" ]; then
    fallar "la base no tiene drizzle.__drizzle_migrations: nunca se adoptó el baseline.
       Migrar ahora intentaría recrear tablas que ya existen.
       Corré primero (y leé docs/migraciones.md antes):
         cd $RAIZ/server && npm run db:adoptar        # verifica y dice qué haría
         cd $RAIZ/server && npm run db:adoptar -- --si"
  fi

  # EL DUMP ES EL CRM ENTERO: teléfonos, nombres y las conversaciones de WhatsApp de
  # gente real. En VPS1 conviven otros productos y otros usuarios, así que los permisos
  # importan tanto como el respaldo. `chown` NO cambia el modo — el `umask` del root que
  # corre esto dejaría el archivo en 0644 y el directorio en 0755, legibles por
  # cualquiera. Van explícitos.
  mkdir -p "$DIR_RESPALDOS"
  chmod 0750 "$DIR_RESPALDOS"
  chown "$USUARIO":hermes "$DIR_RESPALDOS" 2>/dev/null || true

  ARCHIVO="$DIR_RESPALDOS/hermes_db-$(date +%Y%m%d-%H%M%S)-pre-${NUEVO:0:8}.sql.gz"
  decir "trae migraciones → respaldando la base en $ARCHIVO"
  (umask 027; docker exec "$CONTENEDOR_DB" pg_dump -U "$DBUSER" -d "$DBNAME" | gzip > "$ARCHIVO") \
    || fallar "el respaldo falló — NO sigo con una migración sin red"
  chmod 0640 "$ARCHIVO"
  chown "$USUARIO":hermes "$ARCHIVO" 2>/dev/null || true
  decir "respaldo listo ($(du -h "$ARCHIVO" | cut -f1))"

  # Se conservan los últimos 20: suficiente para volver atrás, no tanto como para
  # llenar el disco sin que nadie mire. El `|| true` es porque bajo `pipefail` un `ls`
  # sin coincidencias (imposible acá, pero) mataría el deploy por una tarea de limpieza.
  (ls -1t "$DIR_RESPALDOS"/hermes_db-*.sql.gz 2>/dev/null | tail -n +21 | xargs -r rm -f) || true
fi

# ── El cambio ───────────────────────────────────────────────────────────────────
#
# DESDE ACÁ Y HASTA EL RESTART hay una ventana peligrosa: el checkout ya se movió al
# código nuevo pero el proceso sigue ejecutando el viejo. Si algo falla en el medio
# —`npm ci` sin red, `vite build` sin memoria— morir en seco deja el disco adelantado y
# el proceso atrás: el próximo restart que haga systemd (crash, reboot) levantaría el
# código nuevo sin que nadie lo haya decidido.
#
# `desandar_checkout` cierra esa ventana. NO reinicia, a propósito: el proceso nunca se
# reinició, así que para la vendedora no pasó nada — y un restart le costaría la sesión
# de Cerberus por un fallo que no la afectó. Lo que sí puede quedar adelantado es la
# base, y está bien: las migraciones son expand-only, el código viejo funciona igual.
desandar_checkout() {
  printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2
  decir "deshaciendo el checkout: vuelvo a ${VIEJO:0:8} SIN reiniciar (el proceso nunca se movió)"
  como_deploy git -C "$RAIZ" checkout --quiet --force --detach "$VIEJO" || true
  local aviso=""
  if [ -n "$TRAE_MIGRACION" ] && [ "$MIGRAR" -eq 1 ]; then
    aviso="
       OJO: las migraciones YA se aplicaron. La base queda adelantada, que es seguro
       (son expand-only), pero al volver a desplegar no se van a re-aplicar."
  fi
  fallar "el deploy de ${NUEVO:0:8} se cortó antes de reiniciar. Producción sigue sirviendo ${VIEJO:0:8} y nadie se enteró.$aviso"
}

decir "checkout de ${NUEVO:0:8}"
como_deploy git -C "$RAIZ" checkout --quiet --force --detach "$NUEVO"

if [ -n "$CAMBIO_DEPS_SERVER" ] || [ "$ROLLBACK" -eq 1 ]; then
  decir "dependencias del server"
  como_deploy npm --prefix "$RAIZ/server" ci --no-audit --no-fund \
    || desandar_checkout "falló el npm ci del server"
fi
if [ -n "$CAMBIO_DEPS_RAIZ" ] || [ "$ROLLBACK" -eq 1 ]; then
  decir "dependencias del front"
  como_deploy env ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm --prefix "$RAIZ" ci --no-audit --no-fund \
    || desandar_checkout "falló el npm ci del front"
fi

if [ -n "$TRAE_MIGRACION" ] && [ "$MIGRAR" -eq 1 ]; then
  # Segunda guardia, ahora con el código NUEVO en el disco: que lo registrado en la base
  # y lo que el repo dice ser coincidan. Sin esto, una base migrada contra otro baseline
  # pasa desapercibida — el migrador de drizzle compara por `when`, no por hash, así que
  # aplicaría cosas sobre un schema que no es el que cree.
  # (La guardia de «nunca adoptó» ya corrió antes del respaldo: esa funciona con
  # cualquier checkout, y esta necesita que `db:estado` exista en el código nuevo.)
  decir "estado de las migraciones en la base"
  como_deploy bash -c "cd '$RAIZ/server' && npm run db:estado -- --exigir-coherencia" \
    || desandar_checkout "la base y las migraciones del repo no se corresponden — NO migré. Mirá la salida de arriba."

  decir "aplicando migraciones"
  como_deploy bash -c "cd '$RAIZ/server' && npm run db:migrate" \
    || desandar_checkout "la migración falló. Lo que aplicó, aplicó (drizzle no envuelve el archivo en una transacción); el respaldo está en $DIR_RESPALDOS"
fi

# El front se construye APARTE y se cambia de lugar al final: `vite build` vacía el
# directorio de salida antes de escribir, y hacerlo sobre `dist/` dejaría la app
# sirviendo 404 durante todo el build. Efecto lateral bienvenido: `dist.anterior` es
# el rollback del front, a un `mv` de distancia.
decir "build del front"
como_deploy rm -rf "$RAIZ/dist.nuevo"
como_deploy bash -c "cd '$RAIZ' && env VITE_API_URL='$API_PUBLICA' npx vite build --outDir dist.nuevo --emptyOutDir" \
  || desandar_checkout "falló el build del front"
[ -f "$RAIZ/dist.nuevo/index.html" ] || desandar_checkout "el build no dejó index.html"
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
