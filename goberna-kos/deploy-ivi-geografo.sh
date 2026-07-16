#!/usr/bin/env bash
# Activa Ivi en geógrafo: engine analítico + SYSTEM del modelo + tuning de Ollama.
#
# Correr desde el Mac, desde donde sea (el script se ubica solo):
#     bash goberna-kos/deploy-ivi-geografo.sh    # desde la raíz del repo
#     bash deploy-ivi-geografo.sh                # desde goberna-kos/
#
# Requiere el alias SSH "ia" (~/.ssh/config → geografo@100.117.204.80) y sudo en
# geógrafo (paso 4). Necesita una TTY real: no lo corras desde un agente.
#
# Qué arregla esta corrida (todo medido en prod el 2026-07-16, ver docs/18):
#   1. impact_engine.py en prod comparaba mes PARCIAL vs mes COMPLETO → Ivi decía
#      "las ventas caen 54%" cuando en base comparable SUBEN 28%. El fix ya estaba
#      en el repo pero nunca se desplegó.
#   2. OLLAMA_NUM_PARALLEL=1 serializaba todo → el 5º usuario concurrente moría por
#      timeout ("Error al llamar a Ollama: timed out").
#   3. El fallo se devolvía como HTTP 200 con el error dentro del texto → invisible
#      para cualquier monitoreo por status code.
#   4. ivi-server.log quedaba en 0 bytes (log_message era `pass`) → cero observabilidad.
#   5. voz-ivi (Apolo) usaba qwen3:14b y peleaba la VRAM con ivi-ventas.
set -euo pipefail

KOS="$(cd "$(dirname "$0")" && pwd)"
TOTAL=8

echo "== 1/$TOTAL Sincronizando engine analítico (ivi/) =="
rsync -a --exclude='__pycache__' "$KOS/ivi/" ia:ia-local/ivi/

echo "== 2/$TOTAL Aplicando SYSTEM y recreando ivi-ventas =="
scp -q "$KOS/Modelfile.ventas" ia:ia-local/modelfiles/Modelfile.ventas.new
ssh ia bash -s <<'EOF'
set -e
cd ~/ia-local/modelfiles
# conserva el prompt viejo la primera vez, no lo pisa en re-runs
cp -n Modelfile.ventas Modelfile.ventas.bak-faq-viejo || true
mv Modelfile.ventas.new Modelfile.ventas
ollama create ivi-ventas -f Modelfile.ventas
EOF

echo "== 3/$TOTAL Apagando voz-ivi (Apolo) — libera la VRAM que peleaba con ivi-ventas =="
# Nota: voz-ivi corre en nohup, sin unidad systemd, así que no vuelve solo tras
# un reboot. Sus archivos NO se borran: para revivirlo, cd ~/ia-local/voz-ivi &&
# nohup python3 server.py &  (y ahí habría que repensar el modelo único).
#
# Se identifica por CWD, no por patrón de cmdline. Dos razones:
#   - su cmdline es "python3 server.py" a secas (genérico de más para pkill -f),
#     mientras que "voz-ivi/server.py" es el cwd y NO aparece en el cmdline;
#   - `ssh ia 'pkill -f "..."'` mete el patrón en el cmdline del shell remoto y
#     pkill se encuentra a sí mismo y se suicida antes de matar al objetivo.
#     Por eso todo esto va por `bash -s` (el script viaja por stdin, así que el
#     cmdline del shell remoto es sólo "bash -s").
ssh ia bash -s <<'EOF'
set -e
matados=0
for pid in $(pgrep -f "python3 server.py" 2>/dev/null || true); do
  case "$(readlink /proc/$pid/cwd 2>/dev/null || true)" in
    */voz-ivi) echo "  matando voz-ivi (pid $pid)"; kill "$pid" 2>/dev/null || true; matados=$((matados+1)) ;;
  esac
done
sleep 1
if ss -tln 2>/dev/null | grep -q "127.0.0.1:8600"; then
  echo "  AVISO: algo sigue escuchando en :8600 — voz-ivi no murió"
else
  echo "  voz-ivi apagado ($matados proceso/s)"
fi
EOF

echo "== 4/$TOTAL Aplicando tuning de Ollama (NUM_PARALLEL 1→4, KEEP_ALIVE 5m→24h) =="
scp -q "$KOS/deploy/ollama-tuning.conf" ia:/tmp/ollama-tuning.conf
ssh -t ia 'sudo cp /tmp/ollama-tuning.conf /etc/systemd/system/ollama.service.d/tuning.conf && sudo systemctl daemon-reload && sudo systemctl restart ollama && sleep 5 && systemctl show ollama --property=Environment | tr " " "\n" | grep -E "NUM_PARALLEL|KEEP_ALIVE|MAX_LOADED"'

echo "== 5/$TOTAL Limpiando modelos que ya no se usan =="
# qwen3:8b NO se toca: es el FROM de Modelfile.ventas, sin él `ollama create` de
# arriba no puede reconstruir ivi-ventas. Los otros tres son recuperables con
# `ollama pull <modelo>` si alguna vez hacen falta.
ssh ia bash -s <<'EOF'
set -e
# Red de seguridad: estos dos no se borran ni por error de tipeo más arriba.
INTOCABLES="ivi-ventas:latest qwen3:8b"
for m in qwen3:14b qwen2.5:7b bge-m3:latest; do
  for guard in $INTOCABLES; do
    if [ "$m" = "$guard" ]; then echo "  ABORTO: $m está en la lista de intocables"; exit 1; fi
  done
  # Match exacto contra la columna NAME. Un `grep "^qwen3"` matchearía qwen3:8b
  # (el FROM de Modelfile.ventas) y mentiría sobre qué existe.
  if ollama list | awk '{print $1}' | grep -qx "$m"; then
    echo "  rm $m"; ollama rm "$m" || echo "  (no se pudo borrar $m, sigo)"
  else
    echo "  $m ya no está, nada que hacer"
  fi
done
echo "--- modelos que quedan (deben estar ivi-ventas y qwen3:8b) ---"
ollama list
ollama list | awk '{print $1}' | grep -qx "qwen3:8b" || { echo "ERROR: qwen3:8b desapareció — sin él no se puede recrear ivi-ventas"; exit 1; }
EOF

echo "== 6/$TOTAL Levantando el engine en :8080 =="
ssh ia bash -s <<'EOF'
set -e
pkill -f 'python3 -u chat_ivi.py' || true
pkill -f 'ivi.server' || true
sleep 1
cd ~/ia-local
# -u: sin buffering, para que el log se escriba línea a línea y `tail -f` sirva.
nohup python3 -u -m ivi.server > ivi-server.log 2>&1 < /dev/null &
sleep 2
pgrep -fl 'ivi.server' || { echo 'ERROR: el server no levantó'; tail -20 ivi-server.log; exit 1; }
EOF

echo "== 7/$TOTAL Smoke test: ¿el fix de 'mismos días' está vivo? =="
ssh ia 'curl -s -m 300 -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" -d "{\"message\":\"ventas de este mes\"}"' > /tmp/ivi-smoke.json
python3 - <<'EOF'
import json, sys
d = json.load(open("/tmp/ivi-smoke.json"))
impact = " ".join(d.get("impact", []))
ok = "mismos días" in impact
print("  impacto:", (d.get("impact") or ["(vacío)"])[0][:100])
if not ok:
    print("  ✗ FALLO: el impacto NO dice 'mismos días' — prod sigue comparando")
    print("    mes parcial contra mes completo. El rsync del paso 1 no llegó.")
    sys.exit(1)
print("  ✓ el impacto compara mismos días (fix desplegado)")
EOF

echo "== 8/$TOTAL Verificando que la concurrencia dejó de serializarse =="
# Antes: 4 requests concurrentes tardaban 25/50/75/100s (escalón de ~25s).
# Con NUM_PARALLEL=4 deben terminar todas en una ventana parecida.
ssh ia bash -s <<'EOF'
set -e
for i in 1 2 3 4; do
  ( curl -s -o /dev/null -m 300 -X POST http://localhost:8080/api/chat \
      -H "Content-Type: application/json" -d '{"message":"ventas de este mes"}' \
      -w "  req$i -> HTTP=%{http_code} %{time_total}s\n" ) &
done
wait
echo "--- VRAM con los 4 slots ---"
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
EOF

echo
echo "Listo. UI: http://100.117.204.80:8080"
echo "Logs (ahora sí escriben): ssh ia tail -f ia-local/ivi-server.log"
