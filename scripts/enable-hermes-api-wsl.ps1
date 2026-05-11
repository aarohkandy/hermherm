$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message"
}

Write-Step "Checking WSL"
wsl.exe -l -v

$bashScript = @'
set -euo pipefail

export PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

PROFILE="hermherm"
FAST_MODEL="${HERMHERM_FAST_MODEL:-qwen2.5:0.5b}"
DEEP_MODEL="${HERMHERM_DEEP_MODEL:-gemma4:e4b}"
PROFILE_DIR="$HOME/.hermes/profiles/$PROFILE"
HERMES_BIN="$HOME/.local/bin/hermes"
OLLAMA_ROOT="$HOME/.local/ollama"
OLLAMA_BIN="$OLLAMA_ROOT/bin/ollama"

if [ ! -x "$HERMES_BIN" ]; then
  echo "Hermes was not found at $HERMES_BIN."
  echo "Install Hermes in WSL first, then rerun this script."
  exit 11
fi

if ! "$HERMES_BIN" profile list | grep -Eq "(^|[[:space:]])$PROFILE([[:space:]]|$)"; then
  echo "Creating isolated Hermes profile: $PROFILE"
  "$HERMES_BIN" profile create "$PROFILE" >/dev/null 2>&1 || true
fi

mkdir -p "$PROFILE_DIR/logs" "$PROFILE_DIR/workspace" "$PROFILE_DIR/ollama-models"

cat > "$PROFILE_DIR/config.yaml" <<EOF
model:
  provider: custom
  default: $FAST_MODEL
  base_url: http://127.0.0.1:11434/v1
  api_mode: chat_completions
  context_length: 65536
providers: {}
fallback_providers: []
toolsets: []
agent:
  max_turns: 3
  reasoning_effort: low
  disabled_toolsets:
  - hermes-cli
  verbose: false
display:
  personality: helpful
  final_response_markdown: preserve
  streaming: true
terminal:
  backend: local
  cwd: $PROFILE_DIR/workspace
  timeout: 60
file_read_max_chars: 20000
tool_output:
  max_bytes: 12000
  max_lines: 400
auxiliary:
  compression:
    provider: custom
    model: $FAST_MODEL
    base_url: http://127.0.0.1:11434/v1
    api_key: ollama
    context_length: 65536
EOF

cat > "$PROFILE_DIR/.env" <<EOF
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8643
API_SERVER_KEY=hermherm-local-dev
API_SERVER_CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
API_SERVER_MODEL_NAME=hermherm-local
HERMES_ACCEPT_HOOKS=1
CUSTOM_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_API_KEY=ollama
OLLAMA_HOST=127.0.0.1:11434
OLLAMA_MODELS=$PROFILE_DIR/ollama-models
OLLAMA_CONTEXT_LENGTH=2048
EOF

if [ ! -x "$OLLAMA_BIN" ]; then
  echo "Installing user-local Ollama under $OLLAMA_ROOT"
  mkdir -p "$OLLAMA_ROOT"
  cd "$OLLAMA_ROOT"
  if [ ! -f ollama-linux-amd64.tar.zst ]; then
    curl -L --fail --retry 3 -o ollama-linux-amd64.tar.zst https://ollama.com/download/ollama-linux-amd64.tar.zst
  fi
  if [ ! -x "$OLLAMA_ROOT/zstd-venv/bin/python" ]; then
    python3 -m venv "$OLLAMA_ROOT/zstd-venv"
    "$OLLAMA_ROOT/zstd-venv/bin/python" -m pip install zstandard
  fi
  "$OLLAMA_ROOT/zstd-venv/bin/python" - <<'PY'
from pathlib import Path
import zstandard as zstd

src = Path("ollama-linux-amd64.tar.zst")
dst = Path("ollama-linux-amd64.tar")
if not dst.exists() or dst.stat().st_size == 0:
    with src.open("rb") as ifh, dst.open("wb") as ofh:
        zstd.ZstdDecompressor().copy_stream(ifh, ofh)
PY
  tar -xf ollama-linux-amd64.tar
fi

if ! curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "Starting app-owned Ollama server"
  nohup env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" OLLAMA_CONTEXT_LENGTH=2048 OLLAMA_KEEP_ALIVE=30m "$OLLAMA_BIN" serve > "$PROFILE_DIR/logs/ollama.log" 2>&1 &
  echo $! > "$PROFILE_DIR/logs/ollama.pid"
fi

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" list | awk '{print $1}' | grep -Fx "$FAST_MODEL" >/dev/null 2>&1; then
  echo "Downloading fast local model: $FAST_MODEL"
  env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" pull "$FAST_MODEL"
fi

if ! env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" list | awk '{print $1}' | grep -Fx "$DEEP_MODEL" >/dev/null 2>&1; then
  if [ ! -f "$PROFILE_DIR/logs/deep-model-pull.pid" ] || ! kill -0 "$(cat "$PROFILE_DIR/logs/deep-model-pull.pid")" >/dev/null 2>&1; then
    echo "Starting background download for deep local model: $DEEP_MODEL"
    nohup env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" pull "$DEEP_MODEL" > "$PROFILE_DIR/logs/deep-model-pull.log" 2>&1 &
    echo $! > "$PROFILE_DIR/logs/deep-model-pull.pid"
  else
    echo "Deep local model is already downloading: $DEEP_MODEL"
  fi
fi

if [ -f "$PROFILE_DIR/logs/gateway-app.pid" ]; then
  kill -9 "$(cat "$PROFILE_DIR/logs/gateway-app.pid")" >/dev/null 2>&1 || true
fi
for pid in $(pgrep -f "$HERMES_BIN -p $PROFILE gateway" || true); do
  kill -9 "$pid" >/dev/null 2>&1 || true
done

echo "Starting isolated Hermes API profile on http://127.0.0.1:8643"
nohup env PATH="$PATH" OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" OLLAMA_CONTEXT_LENGTH=2048 "$HERMES_BIN" -p "$PROFILE" gateway run > "$PROFILE_DIR/logs/gateway-app.log" 2>&1 &
echo $! > "$PROFILE_DIR/logs/gateway-app.pid"

for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8643/health >/dev/null 2>&1; then
    echo "HermHerm local runtime is ready."
    exit 0
  fi
  sleep 2
done

echo "HermHerm gateway did not become healthy. Recent log:"
tail -160 "$PROFILE_DIR/logs/gateway-app.log" || true
exit 1
'@

$tempScript = Join-Path $env:TEMP "hermherm-local-wsl.sh"
[System.IO.File]::WriteAllText($tempScript, $bashScript, [System.Text.UTF8Encoding]::new($false))

try {
  $wslScript = (wsl.exe wslpath -a ($tempScript -replace "\\", "/")).Trim()
  Write-Step "Preparing isolated HermHerm runtime"
  wsl.exe bash $wslScript
  if ($LASTEXITCODE -ne 0) {
    throw "WSL setup failed with exit code $LASTEXITCODE."
  }
}
finally {
  Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
}

Write-Step "Checking local endpoints"
$health = Invoke-RestMethod -Uri "http://127.0.0.1:8643/health" -TimeoutSec 10
$models = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 10

Write-Host "Hermes profile: hermherm"
Write-Host "Hermes API:    http://127.0.0.1:8643 ($($health.status))"
Write-Host "Fast model:    qwen2.5:0.5b"
Write-Host "Deep model:    gemma4:e4b (ready when it appears below)"
Write-Host "Ollama models: $($models.models.name -join ', ')"
Write-Host ""
Write-Host "Your default Hermes profile and Discord gateway were not modified."
