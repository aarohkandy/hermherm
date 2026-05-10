const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const isDev = process.env.NODE_ENV === "development";
const execFileAsync = promisify(execFile);

const HERMES_PROFILE = process.env.HERMES_PROFILE || "hermherm";
const HERMES_URL = process.env.HERMES_URL || "http://127.0.0.1:8643";
const HERMES_API_KEY = process.env.HERMES_API_KEY || "hermherm-local-dev";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const LOCAL_MODEL = process.env.HERMHERM_LOCAL_MODEL || "gemma3:4b";
const LOCAL_CHAT_TIMEOUT_MS = Number(
  process.env.HERMHERM_CHAT_TIMEOUT_MS || 600_000,
);

function hermesHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${HERMES_API_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function readJson(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    if (!response.ok) {
      const message =
        body?.error?.message || body?.message || response.statusText;
      throw new Error(message);
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function readHermesJson(pathname, options = {}, timeoutMs = 15_000) {
  return readJson(
    `${HERMES_URL}${pathname}`,
    {
      ...options,
      headers: hermesHeaders(options.headers),
    },
    timeoutMs,
  );
}

async function readOllamaJson(pathname, options = {}, timeoutMs = 15_000) {
  return readJson(
    `${OLLAMA_URL}${pathname}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    },
    timeoutMs,
  );
}

async function runWslHermes(command, timeout = 1_800_000) {
  const script = `set -e
export PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
${command}
`;
  const { stdout, stderr } = await execFileAsync(
    "wsl.exe",
    ["-d", "Ubuntu", "--", "bash", "-lc", script],
    {
      timeout,
      windowsHide: true,
    },
  );

  return `${stdout}${stderr}`.trim();
}

async function getHermesStatus() {
  const status = {
    ok: false,
    url: HERMES_URL,
    profile: HERMES_PROFILE,
    model: LOCAL_MODEL,
    ollamaUrl: OLLAMA_URL,
    hermes: { ok: false },
    ollama: { ok: false },
  };

  try {
    const [health, models] = await Promise.allSettled([
      readHermesJson("/health", { headers: {} }),
      readHermesJson("/v1/models"),
    ]);

    if (health.status === "fulfilled") status.hermes.health = health.value;
    if (models.status === "fulfilled") {
      status.hermes.models = models.value?.data ?? [];
    }
    status.hermes.ok = health.status === "fulfilled";
  } catch (error) {
    status.hermes.error = error instanceof Error ? error.message : String(error);
  }

  try {
    const [version, tags] = await Promise.all([
      readOllamaJson("/api/version"),
      readOllamaJson("/api/tags"),
    ]);
    const models = Array.isArray(tags?.models) ? tags.models : [];
    status.ollama = {
      ok: true,
      version: version?.version,
      models: models.map((model) => model.name).filter(Boolean),
    };
    status.ok = models.some((model) => model.name === LOCAL_MODEL);
  } catch (error) {
    status.ollama = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!status.ok) {
    status.error = status.ollama.ok
      ? `${LOCAL_MODEL} is not downloaded in the HermHerm model store yet.`
      : status.ollama.error || status.hermes.error || "Local runtime is not ready.";
  }

  return status;
}

async function bootstrapHermhermInWsl() {
  return runWslHermes(`set -euo pipefail
PROFILE="${HERMES_PROFILE}"
MODEL="${LOCAL_MODEL}"
PROFILE_DIR="$HOME/.hermes/profiles/$PROFILE"
OLLAMA_ROOT="$HOME/.local/ollama"
OLLAMA_BIN="$OLLAMA_ROOT/bin/ollama"
HERMES_BIN="$HOME/.local/bin/hermes"
BASE_PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [ ! -x "$HERMES_BIN" ]; then
  echo "Hermes was not found at $HERMES_BIN. Install Hermes in WSL first."
  exit 11
fi

if ! "$HERMES_BIN" profile list | grep -Eq "^[[:space:]]*$PROFILE[[:space:]]|^[[:space:]]*◆$PROFILE[[:space:]]"; then
  "$HERMES_BIN" profile create "$PROFILE" >/dev/null 2>&1 || true
fi

mkdir -p "$PROFILE_DIR/logs" "$PROFILE_DIR/workspace" "$PROFILE_DIR/ollama-models"

cat > "$PROFILE_DIR/config.yaml" <<EOF
model:
  provider: custom
  default: $MODEL
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
    model: $MODEL
    base_url: http://127.0.0.1:11434/v1
    api_key: ollama
    context_length: 65536
EOF

cat > "$PROFILE_DIR/.env" <<EOF
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8643
API_SERVER_KEY=${HERMES_API_KEY}
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
  nohup env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" OLLAMA_CONTEXT_LENGTH=2048 OLLAMA_KEEP_ALIVE=30m "$OLLAMA_BIN" serve > "$PROFILE_DIR/logs/ollama.log" 2>&1 &
  echo $! > "$PROFILE_DIR/logs/ollama.pid"
fi

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" list | awk '{print $1}' | grep -Fx "$MODEL" >/dev/null 2>&1; then
  env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" pull "$MODEL"
fi

if [ -f "$PROFILE_DIR/logs/gateway-app.pid" ]; then
  kill -9 "$(cat "$PROFILE_DIR/logs/gateway-app.pid")" >/dev/null 2>&1 || true
fi
for pid in $(pgrep -f "$HERMES_BIN -p $PROFILE gateway" || true); do
  kill -9 "$pid" >/dev/null 2>&1 || true
done

nohup env PATH="$BASE_PATH" OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" OLLAMA_CONTEXT_LENGTH=2048 "$HERMES_BIN" -p "$PROFILE" gateway run > "$PROFILE_DIR/logs/gateway-app.log" 2>&1 &
echo $! > "$PROFILE_DIR/logs/gateway-app.pid"

for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8643/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "HermHerm local runtime is ready."
`);
}

ipcMain.handle("hermes:status", async () => getHermesStatus());

ipcMain.handle("hermes:bootstrap-wsl", async () => {
  const output = await bootstrapHermhermInWsl();
  const status = await getHermesStatus();
  return { output, status };
});

ipcMain.handle("hermes:chat", async (_event, payload) => {
  const content = String(payload?.content ?? "").trim();
  const history = Array.isArray(payload?.history) ? payload.history : [];

  if (!content) {
    throw new Error("Message is empty.");
  }

  const status = await getHermesStatus();
  if (!status.ok) {
    await bootstrapHermhermInWsl();
  }

  const recentHistory = history
    .slice(-8)
    .filter((message) => ["user", "assistant"].includes(message?.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? "").slice(0, 4000),
    }));

  const body = {
    model: LOCAL_MODEL,
    stream: false,
    options: {
      num_ctx: 2048,
      num_predict: 700,
      temperature: 0.7,
      top_p: 0.9,
    },
    messages: [
      {
        role: "system",
        content:
          "You are HermHerm, a private local desktop assistant running on this Windows computer. Be clear, practical, and concise. You are using the isolated hermherm runtime, not the user's default Hermes setup.",
      },
      ...recentHistory,
      { role: "user", content },
    ],
  };

  const result = await readOllamaJson(
    "/api/chat",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    LOCAL_CHAT_TIMEOUT_MS,
  );

  return {
    id: result?.created_at,
    content: result?.message?.content ?? "",
    runtime: "ollama",
    model: LOCAL_MODEL,
    usage: {
      prompt_tokens: result?.prompt_eval_count,
      completion_tokens: result?.eval_count,
      total_duration_ms: result?.total_duration
        ? Math.round(result.total_duration / 1_000_000)
        : undefined,
    },
    raw: result,
  };
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#080b10",
    title: "HermHerm",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
