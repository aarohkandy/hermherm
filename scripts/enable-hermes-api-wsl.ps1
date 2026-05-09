$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message"
}

Write-Step "Checking WSL"
wsl.exe -l -v

$bashScript = @'
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

if ! command -v hermes >/dev/null 2>&1; then
  echo "Hermes was not found in WSL. Install Hermes first, then rerun this script."
  exit 1
fi

ENV_FILE="$HOME/.hermes/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Hermes .env was not found at $ENV_FILE. Run hermes setup first."
  exit 1
fi

BACKUP="$ENV_FILE.hermherm.$(date +%Y%m%d%H%M%S).bak"
cp "$ENV_FILE" "$BACKUP"

python3 - <<'PY'
from pathlib import Path

p = Path.home() / ".hermes/.env"
lines = p.read_text().splitlines()
updates = {
    "API_SERVER_ENABLED": "true",
    "API_SERVER_HOST": "127.0.0.1",
    "API_SERVER_PORT": "8642",
    "API_SERVER_KEY": "hermherm-local-dev",
    "API_SERVER_CORS_ORIGINS": "http://127.0.0.1:5173,http://localhost:5173",
}

seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)

for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")

p.write_text("\n".join(out) + "\n")
PY

echo "Updated Hermes API settings. Backup: $BACKUP"
hermes gateway restart || true

for attempt in $(seq 1 8); do
  if curl -fsS http://127.0.0.1:8642/health >/dev/null 2>&1; then
    break
  fi

  hermes gateway start >/dev/null 2>&1 || true
  sleep 5
done

hermes gateway status || true
'@

$tempScript = Join-Path $env:TEMP "hermherm-enable-api-wsl.sh"
[System.IO.File]::WriteAllText($tempScript, $bashScript, [System.Text.UTF8Encoding]::new($false))

try {
  $wslScript = (wsl.exe wslpath -a ($tempScript -replace "\\", "/")).Trim()
  Write-Step "Enabling Hermes API server in WSL"
  wsl.exe bash $wslScript
}
finally {
  Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
}

Write-Step "Checking local Hermes API"
$health = $null
for ($attempt = 1; $attempt -le 10; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8642/health" -TimeoutSec 5
    break
  }
  catch {
    Start-Sleep -Seconds 3
  }
}

if (-not $health) {
  throw "Hermes API did not become reachable on http://127.0.0.1:8642."
}

$models = Invoke-RestMethod -Uri "http://127.0.0.1:8642/v1/models" -Headers @{ Authorization = "Bearer hermherm-local-dev" } -TimeoutSec 10

Write-Host "Health: $($health.status)"
Write-Host "Models: $($models.data.id -join ', ')"
Write-Host ""
Write-Host "Hermes is ready for HermHerm."
