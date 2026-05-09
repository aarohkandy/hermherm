const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const isDev = process.env.NODE_ENV === "development";
const execFileAsync = promisify(execFile);

const HERMES_URL = process.env.HERMES_URL || "http://127.0.0.1:8642";
const HERMES_API_KEY = process.env.HERMES_API_KEY || "hermherm-local-dev";

function hermesHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${HERMES_API_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function readHermesJson(pathname, options = {}) {
  const response = await fetch(`${HERMES_URL}${pathname}`, {
    ...options,
    headers: hermesHeaders(options.headers),
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
}

async function runWslHermes(command) {
  const script = `set -e
export PATH="$HOME/.local/bin:$PATH"
${command}
`;
  const { stdout, stderr } = await execFileAsync(
    "wsl.exe",
    ["bash", "-lc", script],
    {
      timeout: 45_000,
      windowsHide: true,
    },
  );

  return `${stdout}${stderr}`.trim();
}

async function getHermesStatus() {
  try {
    const [health, models] = await Promise.all([
      readHermesJson("/health", { headers: {} }),
      readHermesJson("/v1/models"),
    ]);

    return {
      ok: true,
      url: HERMES_URL,
      health,
      models: models?.data ?? [],
    };
  } catch (error) {
    return {
      ok: false,
      url: HERMES_URL,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function enableHermesApiInWsl() {
  return runWslHermes(`python3 - <<'PY'
from pathlib import Path

p = Path.home() / ".hermes/.env"
if not p.exists():
    raise SystemExit("Hermes .env was not found. Run Hermes setup first.")

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

p.write_text("\\n".join(out) + "\\n")
PY
hermes gateway restart || hermes gateway start
`);
}

ipcMain.handle("hermes:status", async () => getHermesStatus());

ipcMain.handle("hermes:bootstrap-wsl", async () => {
  const output = await enableHermesApiInWsl();
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const status = await getHermesStatus();
  return { output, status };
});

ipcMain.handle("hermes:chat", async (_event, payload) => {
  const content = String(payload?.content ?? "").trim();
  const sessionId = String(payload?.sessionId ?? "hermherm-desktop");

  if (!content) {
    throw new Error("Message is empty.");
  }

  const body = {
    model: "hermes-agent",
    messages: [{ role: "user", content }],
    stream: false,
  };

  const result = await readHermesJson("/v1/chat/completions", {
    method: "POST",
    headers: {
      "X-Hermes-Session-Id": sessionId,
    },
    body: JSON.stringify(body),
  });

  return {
    id: result?.id,
    content: result?.choices?.[0]?.message?.content ?? "",
    usage: result?.usage,
    raw: result,
  };
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#f6f7f9",
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
