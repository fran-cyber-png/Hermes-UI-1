#!/usr/bin/env bash
# Activa el nuevo Ivi en geógrafo: SYSTEM prompt del modelo + engine analítico en :8080.
# Correr desde el Mac:  bash goberna-kos/deploy-ivi-geografo.sh
# Requiere el alias SSH "ia" (~/.ssh/config → geografo@100.117.204.80).
set -euo pipefail

KOS="$(cd "$(dirname "$0")" && pwd)"

echo "== 1/4 Sincronizando engine analítico (ivi/) =="
rsync -a --exclude='__pycache__' "$KOS/ivi/" ia:ia-local/ivi/

echo "== 2/4 Aplicando SYSTEM nuevo y recreando ivi-ventas =="
scp "$KOS/Modelfile.ventas" ia:ia-local/modelfiles/Modelfile.ventas.new
ssh ia bash -s <<'EOF'
set -e
cd ~/ia-local/modelfiles
# conserva el prompt viejo la primera vez, no lo pisa en re-runs
cp -n Modelfile.ventas Modelfile.ventas.bak-faq-viejo || true
mv Modelfile.ventas.new Modelfile.ventas
ollama create ivi-ventas -f Modelfile.ventas
ollama list | grep ivi-ventas
EOF

echo "== 3/4 Reemplazando chat_ivi.py por el engine nuevo en :8080 =="
ssh ia bash -s <<'EOF'
set -e
pkill -f 'python3 -u chat_ivi.py' || true
pkill -f 'ivi.server' || true
sleep 1
cd ~/ia-local
nohup python3 -m ivi.server > ivi-server.log 2>&1 < /dev/null &
sleep 2
pgrep -fl 'ivi.server' || { echo 'ERROR: el server no levantó'; tail -20 ivi-server.log; exit 1; }
EOF

echo "== 4/4 Smoke test (puede tardar ~1 min por la inferencia) =="
ssh ia 'curl -s -m 300 -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" -d "{\"message\":\"ventas de este mes\"}"' | head -c 800
echo
echo "Listo. UI: http://100.117.204.80:8080  (logs: ssh ia tail -f ia-local/ivi-server.log)"
