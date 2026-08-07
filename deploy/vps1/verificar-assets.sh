#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# ¿EL SITIO VIVO SIRVE LOS ARCHIVOS QUE SE CONSTRUYERON?
#
# ── El agujero que tapa ─────────────────────────────────────────────────────
# El smoke del deploy comparaba el hash del `assets/index-*.js` servido contra el
# construido. Eso prueba que el bundle nuevo está — y nada más. **Un asset que
# falta no mueve ese hash**: ni una fuente, ni una imagen, ni los 32 MB del core
# de ffmpeg.
#
# Pasó el 7-ago-2026: la compresión de video se desplegó SIN su WebAssembly. La
# app ofrecía achicar el video, la vendedora esperaba, y fallaba. El deploy
# estuvo verde todo el tiempo.
#
# ── 🔴 Y por qué NO alcanza con mirar el código HTTP ────────────────────────
# El server sirve `express.static` + un fallback SPA, así que **cualquier ruta
# desconocida responde `index.html` con 200**. Un `curl -f` a un archivo que no
# existe PASA. Verificado ese mismo día:
#
#     GET /ffmpeg/ffmpeg-core.wasm      → 200 · text/html · 487 bytes
#     GET /ffmpeg/no-existe-jamas.wasm  → 200 · text/html · 487 bytes   ← igual
#
# Por eso acá se compara el **content-length** contra el tamaño en disco. Es la
# única señal que distingue «está» de «el fallback te devolvió la portada».
#
# ── Qué verifica, y por qué una muestra ─────────────────────────────────────
# Pedir los ~40 assets de cada deploy sería lento y no aportaría: lo que falla es
# un tipo de archivo entero que no se copió, no un byte suelto. Se toma **el más
# grande de cada extensión**, que es exactamente el que un paso de copia olvidado
# deja afuera.
#
# Uso:  verificar-assets.sh <URL_BASE> <DIR_DIST>
# ─────────────────────────────────────────────────────────────────────────────

API="${1:?falta la URL base}"
DIST="${2:?falta el directorio dist}"

[ -d "$DIST" ] || { echo "::error::no existe $DIST"; exit 1; }

# El control: una ruta que con seguridad no existe. Si el fallback SPA está
# activo —y lo está— esto devuelve el index. Todo asset cuyo tamaño coincida con
# el del control es, casi con certeza, el mismo index disfrazado.
CONTROL_BYTES="$(curl -fsS --max-time 20 "$API/__no-existe-jamas__.wasm" | wc -c | tr -d ' ')"
echo "control (ruta inexistente): $CONTROL_BYTES bytes"

fallos=0
verificados=0

# El más grande de cada extensión.
#
# ⚠️ Sin `-printf` ni `stat -c`: ninguno de los dos existe en el `find`/`stat` de
# macOS, y la primera versión de este script los usaba con `2>/dev/null`. ¿El
# resultado? «assets verificados: 0 · fallos: 0» — **el verificador dio OK sin
# verificar nada**, que es EXACTAMENTE la clase de falso verde que existe para
# atrapar. `wc -c <archivo` anda en los dos.
while read -r archivo; do
  rel="${archivo#"$DIST"/}"
  local_bytes="$(wc -c < "$archivo" | tr -d ' ')"

  # Solo los headers: bajar 32 MB para contar bytes es exactamente lo que no
  # hace falta. Un HEAD alcanza porque `express.static` manda `content-length`.
  cabeceras="$(curl -fsSI --max-time 60 "$API/$rel" || true)"
  servido_bytes="$(awk 'tolower($1) ~ /^content-length:/ {gsub(/\r/,"",$2); print $2}' <<<"$cabeceras" | tail -1)"
  tipo="$(awk 'tolower($1) ~ /^content-type:/ {gsub(/\r/,"",$2); print $2}' <<<"$cabeceras" | tail -1)"

  verificados=$((verificados + 1))
  if [ "${servido_bytes:-0}" = "$local_bytes" ]; then
    echo "  ✓ $rel · $local_bytes bytes · $tipo"
  else
    echo "::error::$rel: el disco tiene $local_bytes bytes y el sitio sirve ${servido_bytes:-0} (${tipo:-sin tipo})."
    if [ "${servido_bytes:-0}" = "$CONTROL_BYTES" ]; then
      echo "::error::  ↳ es el MISMO tamaño que una ruta inexistente: el fallback SPA está devolviendo index.html. El archivo no se copió al build."
    fi
    fallos=$((fallos + 1))
  fi
done < <(
  find "$DIST" -type f ! -name '*.map' -print0 \
    | while IFS= read -r -d '' f; do printf '%s\t%s\t%s\n' "${f##*/}" "$(wc -c < "$f" | tr -d ' ')" "$f"; done \
    | awk -F'\t' '{ n=split($1,p,"."); ext=(n>1?p[n]:"sin-ext");
                    if ($2 + 0 > max[ext] + 0) { max[ext]=$2; ruta[ext]=$3 } }
                  END { for (e in ruta) print ruta[e] }'
)

echo "assets verificados: $verificados · fallos: $fallos"

# 🔴 UN VERIFICADOR QUE NO VERIFICÓ NADA NO PUEDE DECIR QUE ESTÁ TODO BIEN.
# Es la guarda que le faltó a la primera versión de este mismo script: con el
# `find` devolviendo vacío, terminaba en «0 fallos» y en verde. Cero assets
# significa que el `dist/` está vacío o que la enumeración se rompió — las dos
# cosas son un problema, ninguna es «pasó».
[ "$verificados" -gt 0 ] || {
  echo "::error::No se verificó NINGÚN asset. O $DIST está vacío, o la enumeración falló."
  exit 1
}

[ "$fallos" -eq 0 ] || {
  echo "::error::El sitio vivo no sirve todo lo que se construyó. Rollback: mv dist dist.roto && mv dist.anterior dist"
  exit 1
}
