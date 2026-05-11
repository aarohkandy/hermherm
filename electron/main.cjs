const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");
const {
  callVisualTool,
  tools: visualMcpTools,
} = require("./visual-mcp-server.cjs");

const isDev = process.env.NODE_ENV === "development";
const isSmokeTest =
  process.env.HERMHERM_SMOKE_TEST === "1" ||
  process.argv.includes("--smoke-test");
const execFileAsync = promisify(execFile);

const HERMES_PROFILE = process.env.HERMES_PROFILE || "hermherm";
const HERMES_URL = process.env.HERMES_URL || "http://127.0.0.1:8643";
const HERMES_API_KEY = process.env.HERMES_API_KEY || "hermherm-local-dev";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const FAST_MODEL = process.env.HERMHERM_FAST_MODEL || "qwen2.5:0.5b";
const DEEP_MODEL = process.env.HERMHERM_DEEP_MODEL || "gemma4:e4b";
const FAST_CHAT_TIMEOUT_MS = Number(
  process.env.HERMHERM_FAST_CHAT_TIMEOUT_MS || 180_000,
);
const DEEP_CHAT_TIMEOUT_MS = Number(
  process.env.HERMHERM_DEEP_CHAT_TIMEOUT_MS || 900_000,
);
const ROUTER_TIMEOUT_MS = Number(
  process.env.HERMHERM_ROUTER_TIMEOUT_MS || 45_000,
);
const VISUAL_MCP_SERVER = "hermherm-visuals";
const CHAT_MODES = new Set(["ask", "build", "analyze"]);
const BRAIN_LABELS = {
  fast: "Fast Qwen",
  deep: "Deep Gemma 4",
};

let deepPullState = {
  state: "idle",
  error: null,
  progress: null,
};
let lastDeepPullProbeAt = 0;

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

function modelState(modelNames, model, pendingState) {
  const ready = modelNames.includes(model);

  return {
    name: model,
    ready,
    state: ready
      ? "ready"
      : pendingState === "starting" || pendingState === "downloading"
        ? "downloading"
        : pendingState === "error"
          ? "error"
          : "missing",
    error: ready ? null : pendingState === "error" ? deepPullState.error : null,
    progress: ready ? { percent: 100, label: "Ready" } : deepPullState.progress,
  };
}

function stripAnsi(text) {
  return String(text ?? "")
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, "");
}

function parseDeepPullProgress(logText) {
  const clean = stripAnsi(logText).replace(/\r/g, "\n");
  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLines = lines.slice(-80);

  for (const line of [...lastLines].reverse()) {
    const percentMatch = line.match(/\b(\d{1,3})%\b/);
    if (percentMatch) {
      const percent = Math.min(99, Math.max(0, Number(percentMatch[1])));
      const sizeMatch = line.match(
        /(\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB))\s*\/\s*(\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB))/i,
      );
      return {
        percent,
        label: sizeMatch
          ? `${sizeMatch[1]} of ${sizeMatch[2]}`
          : `${percent}% downloaded`,
      };
    }
  }

  if (
    lastLines.some((line) => /verifying|success|writing manifest/i.test(line))
  ) {
    return { percent: 98, label: "Finalizing model" };
  }

  if (lastLines.some((line) => /pulling manifest/i.test(line))) {
    return { percent: 3, label: "Connecting to Ollama registry" };
  }

  if (lastLines.some((line) => /pulling/i.test(line))) {
    return { percent: 8, label: "Starting model download" };
  }

  return null;
}

function parseDeepPullError(logText) {
  const clean = stripAnsi(logText).replace(/\r/g, "\n");
  const lines = clean
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  const errorLine = [...lines]
    .reverse()
    .find((line) =>
      /(^|\b)(error:|failed|i\/o timeout|connection timed out|timed out|not found|unauthorized)/i.test(
        line,
      ),
    );

  return errorLine ?? null;
}

function progressForDeepError(message) {
  if (/timeout|timed out/i.test(message)) {
    return { percent: 0, label: "Registry timed out" };
  }

  if (/not found|manifest/i.test(message)) {
    return { percent: 0, label: "Model manifest unavailable" };
  }

  return { percent: 0, label: "Download failed" };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function localRoutingHeuristic(
  content,
  mode,
  fallbackReason = "Local heuristic",
) {
  const normalized = String(content ?? "").toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const deepPattern =
    /\b(plan|build|implement|code|debug|fix|analyze|analyse|compare|architecture|strategy|steps|multi[- ]?step|file|folder|repo|install|configure|mcp|design|research|explain why|tradeoff|risk|app changes?|system changes?|change the app|modify the app|update the app)\b/;

  if (mode === "build" || mode === "analyze") {
    return {
      route: "deep",
      confidence: 0.9,
      reason: `${fallbackReason}: ${mode} mode needs the deep brain.`,
      fallback: true,
    };
  }

  if (
    wordCount > 45 ||
    normalized.length > 260 ||
    deepPattern.test(normalized)
  ) {
    return {
      route: "deep",
      confidence: 0.78,
      reason: `${fallbackReason}: prompt looks multi-step or important.`,
      fallback: true,
    };
  }

  return {
    route: "fast",
    confidence: 0.82,
    reason: `${fallbackReason}: common lightweight question.`,
    fallback: true,
  };
}

function normalizeRouterDecision(decision, content, mode, fallback) {
  const heuristic = localRoutingHeuristic(content, mode, "Bias");
  const route = decision?.route === "deep" ? "deep" : "fast";
  const confidence = Number(decision?.confidence);
  const safeConfidence =
    Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
      ? confidence
      : 0.5;
  const reason =
    typeof decision?.reason === "string" && decision.reason.trim()
      ? decision.reason.trim().slice(0, 180)
      : "Fast classifier route.";

  if (heuristic.route === "deep") {
    return {
      ...heuristic,
      confidence: Math.max(safeConfidence, heuristic.confidence),
      reason:
        route === "deep"
          ? reason
          : `${heuristic.reason} Classifier suggested Fast, but safety bias upgraded it.`,
      fallback,
    };
  }

  if (safeConfidence < 0.62) {
    return {
      route: "deep",
      confidence: safeConfidence,
      reason: "Classifier confidence was low, so HermHerm escalated to Deep.",
      fallback,
    };
  }

  return {
    route,
    confidence: safeConfidence,
    reason,
    fallback,
  };
}

async function runOllamaChat({ model, messages, options, timeoutMs, format }) {
  return readOllamaJson(
    "/api/chat",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        stream: false,
        ...(format ? { format } : {}),
        options,
        messages,
      }),
    },
    timeoutMs,
  );
}

async function classifyPrompt(content, mode) {
  try {
    const result = await runOllamaChat({
      model: FAST_MODEL,
      timeoutMs: ROUTER_TIMEOUT_MS,
      format: "json",
      options: {
        num_ctx: 1024,
        num_predict: 96,
        temperature: 0,
        top_p: 0.1,
      },
      messages: [
        {
          role: "system",
          content: [
            "You are HermHerm's fast local routing classifier.",
            "Return only JSON with route, confidence, and reason.",
            "route must be fast or deep.",
            "Use fast for greetings, tiny facts, simple rewrites, short summaries, and common questions.",
            "Use deep for planning, implementation, coding, debugging, app changes, files, analysis, comparison, multi-step work, or anything high-stakes.",
          ].join(" "),
        },
        {
          role: "user",
          content: `Mode: ${mode}\nPrompt: ${content}`,
        },
      ],
    });
    const parsed = safeJsonParse(result?.message?.content ?? "");
    return normalizeRouterDecision(parsed, content, mode, false);
  } catch (error) {
    const heuristic = localRoutingHeuristic(
      content,
      mode,
      "Classifier unavailable",
    );
    return {
      ...heuristic,
      reason: `${heuristic.reason} ${
        error instanceof Error ? error.message : String(error)
      }`.slice(0, 180),
    };
  }
}

function buildChatMessages({ content, history, mode, selectedBrain }) {
  return [
    {
      role: "system",
      content: [
        "You are HermHerm, a private local desktop assistant running on this Windows computer.",
        "You are using the isolated hermherm runtime, not the user's default Hermes setup.",
        selectedBrain === "fast"
          ? "You are answering as the Fast Qwen brain. Be brief, direct, and useful."
          : "You are answering as the Deep Gemma 4 brain. Be careful, structured, and complete.",
        "Write in clear sections with concrete points so the desktop app can turn your answer into visual cards.",
        "Do not end with a follow-up question unless the user explicitly asks for options.",
        mode === "build"
          ? "Mode: Build. Prioritize steps, decisions, sequence, and implementation details."
          : mode === "analyze"
            ? "Mode: Analyze. Prioritize signals, tradeoffs, risks, and what to watch next."
            : "Mode: Ask. Prioritize direct synthesis and useful takeaways.",
      ].join(" "),
    },
    ...history,
    { role: "user", content },
  ];
}

async function ensureDeepModelPull() {
  if (
    deepPullState.state === "starting" ||
    deepPullState.state === "downloading"
  ) {
    return;
  }

  deepPullState = {
    state: "starting",
    error: null,
    progress: { percent: 0, label: "Preparing download" },
  };

  try {
    const output = await runWslHermes(
      `set -euo pipefail
PROFILE="${HERMES_PROFILE}"
DEEP_MODEL="${DEEP_MODEL}"
PROFILE_DIR="$HOME/.hermes/profiles/$PROFILE"
OLLAMA_ROOT="$HOME/.local/ollama"
OLLAMA_BIN="$OLLAMA_ROOT/bin/ollama"
mkdir -p "$PROFILE_DIR/logs" "$PROFILE_DIR/ollama-models"

if [ ! -x "$OLLAMA_BIN" ]; then
  echo "deep-missing-ollama"
  exit 0
fi

if ! curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  nohup env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" OLLAMA_CONTEXT_LENGTH=2048 OLLAMA_KEEP_ALIVE=30m "$OLLAMA_BIN" serve > "$PROFILE_DIR/logs/ollama.log" 2>&1 &
  echo $! > "$PROFILE_DIR/logs/ollama.pid"
fi

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" list | awk '{print $1}' | grep -Fx "$DEEP_MODEL" >/dev/null 2>&1; then
  echo "deep-ready"
  exit 0
fi

if [ -f "$PROFILE_DIR/logs/deep-model-pull.pid" ] && kill -0 "$(cat "$PROFILE_DIR/logs/deep-model-pull.pid")" >/dev/null 2>&1; then
  echo "deep-downloading"
  [ -f "$PROFILE_DIR/logs/deep-model-pull.log" ] && tail -c 12000 "$PROFILE_DIR/logs/deep-model-pull.log"
  exit 0
fi

if pgrep -f "ollama.*pull.*$DEEP_MODEL" >/dev/null 2>&1; then
  echo "deep-downloading"
  [ -f "$PROFILE_DIR/logs/deep-model-pull.log" ] && tail -c 12000 "$PROFILE_DIR/logs/deep-model-pull.log"
  exit 0
fi

nohup env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" pull "$DEEP_MODEL" > "$PROFILE_DIR/logs/deep-model-pull.log" 2>&1 &
echo $! > "$PROFILE_DIR/logs/deep-model-pull.pid"
echo "deep-downloading"`,
      60_000,
    );

    deepPullState = {
      state: output.includes("deep-ready") ? "ready" : "downloading",
      error: null,
      progress: output.includes("deep-ready")
        ? { percent: 100, label: "Ready" }
        : (parseDeepPullProgress(output) ?? {
            percent: 3,
            label: "Connecting to Ollama registry",
          }),
    };
  } catch (error) {
    deepPullState = {
      state: "error",
      error: error instanceof Error ? error.message : String(error),
      progress: { percent: 0, label: "Download failed" },
    };
  }
}

async function refreshDeepPullState() {
  const now = Date.now();
  if (now - lastDeepPullProbeAt < 5_000) return;
  lastDeepPullProbeAt = now;

  try {
    const output = await runWslHermes(
      `set -euo pipefail
PROFILE="${HERMES_PROFILE}"
DEEP_MODEL="${DEEP_MODEL}"
PROFILE_DIR="$HOME/.hermes/profiles/$PROFILE"
PID_FILE="$PROFILE_DIR/logs/deep-model-pull.pid"
LOG_FILE="$PROFILE_DIR/logs/deep-model-pull.log"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" >/dev/null 2>&1; then
  echo "deep-downloading"
  [ -f "$LOG_FILE" ] && tail -c 12000 "$LOG_FILE"
  exit 0
fi

if pgrep -f "ollama.*pull.*$DEEP_MODEL" >/dev/null 2>&1; then
  echo "deep-downloading"
  [ -f "$LOG_FILE" ] && tail -c 12000 "$LOG_FILE"
  exit 0
fi

if [ -f "$LOG_FILE" ] && tail -n 12 "$LOG_FILE" | grep -qi "error:"; then
  echo "deep-error"
  tail -n 4 "$LOG_FILE" | tr '\\n' ' ' | cut -c1-300
  exit 0
fi

if [ -f "$LOG_FILE" ]; then
  echo "deep-progress"
  tail -c 12000 "$LOG_FILE"
fi

echo "deep-stopped"`,
      20_000,
    );

    if (output.includes("deep-downloading")) {
      deepPullState = {
        state: "downloading",
        error: null,
        progress: parseDeepPullProgress(output) ??
          deepPullState.progress ?? {
            percent: 3,
            label: "Connecting to Ollama registry",
          },
      };
    } else if (output.includes("deep-error")) {
      const message =
        parseDeepPullError(output) ??
        output.replace("deep-error", "").trim() ??
        "Download failed.";
      deepPullState = {
        state: "error",
        error: message,
        progress: progressForDeepError(message),
      };
    } else if (output.includes("deep-progress")) {
      deepPullState = {
        state: "downloading",
        error: null,
        progress: parseDeepPullProgress(output) ?? {
          percent: 3,
          label: "Connecting to Ollama registry",
        },
      };
    } else {
      deepPullState = { state: "idle", error: null, progress: null };
    }
  } catch (error) {
    const raw = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${
      error instanceof Error ? error.message : String(error)
    }`;
    const message = parseDeepPullError(raw) ?? "Download check failed.";
    deepPullState = {
      state: "error",
      error: message,
      progress: progressForDeepError(message),
    };
  }
}

async function getHermesStatus({ startDeepPull = true } = {}) {
  const status = {
    ok: false,
    url: HERMES_URL,
    profile: HERMES_PROFILE,
    model: FAST_MODEL,
    activeModel: null,
    ollamaUrl: OLLAMA_URL,
    models: {
      fast: {
        name: FAST_MODEL,
        label: BRAIN_LABELS.fast,
        ready: false,
        state: "missing",
      },
      deep: {
        name: DEEP_MODEL,
        label: BRAIN_LABELS.deep,
        ready: false,
        state: deepPullState.state === "idle" ? "missing" : deepPullState.state,
        error: deepPullState.error,
        progress: deepPullState.progress,
      },
    },
    hermes: { ok: false },
    ollama: { ok: false },
    visualMcp: {
      ok: true,
      server: VISUAL_MCP_SERVER,
      tools: visualMcpTools.map((tool) => tool.name),
    },
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
    status.hermes.error =
      error instanceof Error ? error.message : String(error);
  }

  try {
    const [version, tags] = await Promise.all([
      readOllamaJson("/api/version"),
      readOllamaJson("/api/tags"),
    ]);
    const models = Array.isArray(tags?.models) ? tags.models : [];
    const modelNames = models.map((model) => model.name).filter(Boolean);

    if (!modelNames.includes(DEEP_MODEL)) {
      await refreshDeepPullState();
    }

    status.ollama = {
      ok: true,
      version: version?.version,
      models: modelNames,
    };
    status.models.fast = {
      label: BRAIN_LABELS.fast,
      ...modelState(modelNames, FAST_MODEL, "missing"),
    };
    status.models.deep = {
      label: BRAIN_LABELS.deep,
      ...modelState(modelNames, DEEP_MODEL, deepPullState.state),
    };
    status.ok = status.models.fast.ready;
    status.model = status.models.fast.name;
  } catch (error) {
    status.ollama = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (
    status.ok &&
    !status.models.deep.ready &&
    startDeepPull &&
    deepPullState.state !== "error"
  ) {
    status.models.deep.state = "downloading";
    status.models.deep.progress = deepPullState.progress ??
      status.models.deep.progress ?? {
        percent: 3,
        label: "Connecting to Ollama registry",
      };
    void ensureDeepModelPull();
  }

  if (!status.ok) {
    status.error = status.ollama.ok
      ? `${FAST_MODEL} is not downloaded in the HermHerm model store yet.`
      : status.ollama.error ||
        status.hermes.error ||
        "Local runtime is not ready.";
  }

  return status;
}

async function bootstrapHermhermInWsl() {
  return runWslHermes(`set -euo pipefail
PROFILE="${HERMES_PROFILE}"
FAST_MODEL="${FAST_MODEL}"
DEEP_MODEL="${DEEP_MODEL}"
PROFILE_DIR="$HOME/.hermes/profiles/$PROFILE"
OLLAMA_ROOT="$HOME/.local/ollama"
OLLAMA_BIN="$OLLAMA_ROOT/bin/ollama"
HERMES_BIN="$HOME/.local/bin/hermes"
BASE_PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [ ! -x "$HERMES_BIN" ]; then
  echo "Hermes was not found at $HERMES_BIN. Install Hermes in WSL first."
  exit 11
fi

if ! "$HERMES_BIN" profile list | grep -Eq "(^|[[:space:]])$PROFILE([[:space:]]|$)"; then
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

if ! env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" list | awk '{print $1}' | grep -Fx "$FAST_MODEL" >/dev/null 2>&1; then
  env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" pull "$FAST_MODEL"
fi

if ! env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" list | awk '{print $1}' | grep -Fx "$DEEP_MODEL" >/dev/null 2>&1; then
  if [ ! -f "$PROFILE_DIR/logs/deep-model-pull.pid" ] || ! kill -0 "$(cat "$PROFILE_DIR/logs/deep-model-pull.pid")" >/dev/null 2>&1; then
    nohup env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PROFILE_DIR/ollama-models" "$OLLAMA_BIN" pull "$DEEP_MODEL" > "$PROFILE_DIR/logs/deep-model-pull.log" 2>&1 &
    echo $! > "$PROFILE_DIR/logs/deep-model-pull.pid"
  fi
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

function recentHistoryFrom(payload) {
  const history = Array.isArray(payload?.history) ? payload.history : [];
  return history
    .slice(-8)
    .filter((message) => ["user", "assistant"].includes(message?.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? "").slice(0, 4000),
    }));
}

async function runChatRequest(payload, { forceDeep = false } = {}) {
  const content = String(payload?.content ?? "").trim();
  const mode = CHAT_MODES.has(payload?.mode) ? payload.mode : "ask";

  if (!content) {
    throw new Error("Message is empty.");
  }

  let status = await getHermesStatus();
  if (!status.ok) {
    await bootstrapHermhermInWsl();
    status = await getHermesStatus();
  }

  const router = forceDeep
    ? {
        route: "deep",
        confidence: 1,
        reason: "Manual rerun with Deep Gemma 4.",
        fallback: false,
      }
    : await classifyPrompt(content, mode);

  const deepReady = Boolean(status.models?.deep?.ready);

  if (forceDeep && !deepReady) {
    throw new Error("Deep Gemma 4 is still downloading.");
  }

  const selectedBrain = router.route === "deep" && deepReady ? "deep" : "fast";
  const selectedModel = selectedBrain === "deep" ? DEEP_MODEL : FAST_MODEL;
  const deepFallback = router.route === "deep" && !deepReady;
  const canRerunDeep = selectedBrain === "fast" && deepReady;
  const recentHistory = recentHistoryFrom(payload);
  const result = await runOllamaChat({
    model: selectedModel,
    timeoutMs:
      selectedBrain === "deep" ? DEEP_CHAT_TIMEOUT_MS : FAST_CHAT_TIMEOUT_MS,
    options: {
      num_ctx: selectedBrain === "deep" ? 4096 : 2048,
      num_predict: selectedBrain === "deep" ? 900 : 360,
      temperature: selectedBrain === "deep" ? 0.62 : 0.35,
      top_p: 0.9,
    },
    messages: buildChatMessages({
      content,
      history: recentHistory,
      mode,
      selectedBrain,
    }),
  });
  const answer = result?.message?.content ?? "";
  const finalRouter = {
    ...router,
    fallback: Boolean(router.fallback || deepFallback),
    selectedBrain,
    selectedModel,
    deepReady,
  };

  return {
    id: result?.created_at,
    content: answer,
    runtime: "ollama",
    model: selectedModel,
    selectedModel,
    selectedBrain,
    canRerunDeep,
    usage: {
      prompt_tokens: result?.prompt_eval_count,
      completion_tokens: result?.eval_count,
      total_duration_ms: result?.total_duration
        ? Math.round(result.total_duration / 1_000_000)
        : undefined,
    },
    raw: result,
    mode,
    router: finalRouter,
    visual: callVisualTool("compose_visual_response", {
      prompt: content,
      response: answer,
      mode,
      model: selectedModel,
      selectedModel,
      selectedBrain,
      brainLabel: BRAIN_LABELS[selectedBrain],
      runtimeReady: status.ok,
      durationMs: result?.total_duration
        ? Math.round(result.total_duration / 1_000_000)
        : undefined,
      router: finalRouter,
      canRerunDeep,
      deepReady,
    }),
    visualMcp: {
      server: VISUAL_MCP_SERVER,
      tools: ["compose_visual_response"],
    },
  };
}

ipcMain.handle("hermes:status", async () => getHermesStatus());
ipcMain.handle("visuals:tools", async () => ({
  server: VISUAL_MCP_SERVER,
  tools: visualMcpTools,
}));

ipcMain.handle("hermes:bootstrap-wsl", async () => {
  const output = await bootstrapHermhermInWsl();
  const status = await getHermesStatus();
  return { output, status };
});

ipcMain.handle("hermes:chat", async (_event, payload) =>
  runChatRequest(payload),
);
ipcMain.handle("hermes:rerun-deep", async (_event, payload) =>
  runChatRequest(payload, { forceDeep: true }),
);
ipcMain.handle("hermes:retry-deep", async () => {
  deepPullState = {
    state: "idle",
    error: null,
    progress: null,
  };
  lastDeepPullProbeAt = 0;
  await ensureDeepModelPull();
  return getHermesStatus({ startDeepPull: false });
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f3eadc",
    title: "HermHerm",
    show: false,
    skipTaskbar: isSmokeTest,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!isSmokeTest) {
      mainWindow.show();
    }
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
