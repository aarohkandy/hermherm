import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

if (process.platform !== "win32") {
  throw new Error(
    "This smoke test currently targets the Windows portable build.",
  );
}

const exe = path.join(
  process.cwd(),
  "release",
  "portable",
  "HermHerm-win32-x64",
  "HermHerm.exe",
);

try {
  execFileSync("taskkill", ["/IM", "HermHerm.exe", "/F"], { stdio: "ignore" });
} catch {
  // The app was not already running.
}

const child = spawn(exe, ["--remote-debugging-port=9333"], {
  detached: false,
  stdio: "ignore",
});

async function getDebugPages() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:9333/json");
      if (response.ok) return response.json();
    } catch {
      // Wait for Electron to expose its debug endpoint.
    }

    await delay(1000);
  }

  throw new Error("Electron debug endpoint did not open.");
}

const pages = await getDebugPages();
const page = pages.find((item) => item.webSocketDebuggerUrl);
if (!page) throw new Error("No debuggable Electron page found.");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

async function evalJs(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (response.error) throw new Error(response.error.message);
  if (response.result?.exceptionDetails) {
    throw new Error(
      response.result.exceptionDetails.exception?.description ??
        response.result.exceptionDetails.text,
    );
  }

  return response.result.result.value;
}

async function cleanup() {
  ws.close();
  child.kill();
  try {
    execFileSync("taskkill", ["/IM", "HermHerm.exe", "/F"], {
      stdio: "ignore",
    });
  } catch {
    // Already stopped.
  }
}

try {
  await send("Runtime.enable");
  await delay(6000);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const body = await evalJs("document.body.innerText");
    const normalizedBody = body.toLowerCase();
    if (
      (body.includes("Local runtime ready") ||
        body.includes("Fast Qwen is ready") ||
        body.includes("Fast ready")) &&
      normalizedBody.includes("windows")
    ) {
      break;
    }
    if (attempt === 119) throw new Error(body);
    await delay(1000);
  }

  await evalJs(`(() => {
    const el = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, 'Write one short sentence saying the packaged local app works.');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.send-button').click();
  })()`);

  for (let attempt = 0; attempt < 600; attempt += 1) {
    const body = await evalJs("document.body.innerText");
    const normalizedBody = body.toLowerCase();
    if (body.includes("I could not get a local response yet")) {
      throw new Error(body);
    }
    if (
      normalizedBody.includes("response") &&
      normalizedBody.includes("fast qwen") &&
      normalizedBody.includes("run details")
    ) {
      console.log("Packaged local runtime smoke test passed.");
      await cleanup();
      process.exit(0);
    }

    await delay(1000);
  }

  throw new Error(await evalJs("document.body.innerText"));
} catch (error) {
  await cleanup();
  throw error;
}
