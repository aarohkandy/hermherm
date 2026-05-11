import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  ArrowUp,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  Cpu,
  Layers3,
  Loader2,
  MessageSquarePlus,
  Orbit,
  ScanLine,
  Sparkles,
  WifiOff,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "./App.css";

const fastModel = "qwen2.5:0.5b";
const deepModel = "gemma4:e4b";

type Exchange = {
  id: string;
  prompt: string;
  mode: HermHermMode;
  pending?: boolean;
  response?: string;
  visual?: VisualPayload;
  error?: string;
  usage?: HermesChatResult["usage"];
  selectedModel?: string;
  selectedBrain?: BrainId;
  router?: RouterResult;
  canRerunDeep?: boolean;
};

type ModeDefinition = {
  id: HermHermMode;
  label: string;
  noun: string;
  icon: typeof Sparkles;
};

const modes: ModeDefinition[] = [
  { id: "ask", label: "Ask", noun: "Query", icon: Sparkles },
  { id: "build", label: "Build", noun: "Construct", icon: Layers3 },
  { id: "analyze", label: "Analyze", noun: "Scan", icon: ScanLine },
];

const processingStages = [
  "Command received",
  "Fast brain routing",
  "Model selected",
  "Visual MCP composing",
  "Artifact readying",
];

const browserClient = {
  async status(): Promise<HermesStatus> {
    return {
      ok: false,
      url: "http://127.0.0.1:8643",
      profile: "hermherm",
      model: fastModel,
      models: {
        fast: {
          name: fastModel,
          label: "Fast Qwen",
          ready: false,
          state: "missing",
        },
        deep: {
          name: deepModel,
          label: "Deep Gemma 4",
          ready: false,
          state: "missing",
        },
      },
      visualMcp: {
        ok: true,
        server: "hermherm-visuals",
        tools: ["compose_visual_response"],
      },
      error: "Open the desktop app to use the local runtime.",
    };
  },
  async bootstrapWsl(): Promise<{ output: string; status: HermesStatus }> {
    throw new Error("Local startup is available in the desktop app.");
  },
  async chat(): Promise<HermesChatResult> {
    throw new Error("Local chat is available in the desktop app.");
  },
  async rerunDeep(): Promise<HermesChatResult> {
    throw new Error("Deep rerun is available in the desktop app.");
  },
};

const createId = () => Math.random().toString(36).slice(2);

function fallbackVisual(
  prompt: string,
  response: string,
  mode: HermHermMode,
): VisualPayload {
  const firstLine =
    response
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .find(Boolean) ?? "The local assistant returned a response.";

  return {
    version: 1,
    source: "browser-preview",
    mode,
    headline: prompt || "Local command",
    subtitle: "Visual response",
    intent: mode,
    cards: [
      {
        id: "fallback",
        kind: "summary",
        eyebrow: mode,
        title: "Main readout",
        body: firstLine,
        items: [],
        intensity: 68,
      },
    ],
    timeline: processingStages.map((stage, index) => ({
      id: `fallback-${index}`,
      label: index === 0 ? "Input" : "Process",
      title: stage,
      detail: "Local surface",
      state: index === processingStages.length - 1 ? "ready" : "complete",
    })),
    metrics: [
      { label: "Brain", value: "Fast Qwen", tone: "warm" },
      { label: "Model", value: fastModel, tone: "warm" },
      { label: "Visual MCP", value: "preview", tone: "amber" },
    ],
    selectedBrain: "fast",
    selectedModel: fastModel,
    rawText: response,
  };
}

function App() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<HermHermMode>("ask");
  const [status, setStatus] = useState<HermesStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [startupNote, setStartupNote] = useState("Checking local runtime");
  const artifactRef = useRef<HTMLDivElement | null>(null);
  const bootAttempted = useRef(false);

  const client = useMemo(() => window.hermherm?.hermes ?? browserClient, []);
  const platformLabel = useMemo(() => {
    if (!window.hermherm?.isDesktop) return "Preview";
    if (window.hermherm.platform === "win32") return "Windows";
    if (window.hermherm.platform === "darwin") return "macOS";
    return "Desktop";
  }, []);

  const runtimeReady = Boolean(status?.ok);
  const activeMode = modes.find((item) => item.id === mode) ?? modes[0];
  const latestExchange = exchanges[exchanges.length - 1];
  const latestComplete = [...exchanges].reverse().find((item) => item.visual);
  const activeVisual = latestExchange?.visual ?? latestComplete?.visual;
  const isProcessing =
    isStarting || isSending || Boolean(latestExchange?.pending);
  const startupReadable = runtimeReady
    ? "Fast ready. Deep runs when available."
    : startupNote;
  const deepState = status?.models?.deep?.ready
    ? "Ready"
    : status?.models?.deep?.state === "downloading"
      ? "Downloading"
      : "Waiting";

  function buildHistory() {
    return exchanges
      .filter((exchange) => exchange.response && !exchange.pending)
      .flatMap((exchange) => [
        { role: "user" as const, content: exchange.prompt },
        { role: "assistant" as const, content: exchange.response ?? "" },
      ])
      .slice(-8);
  }

  useEffect(() => {
    let cancelled = false;

    async function checkAndStart() {
      const firstStatus = await client.status();
      if (cancelled) return;
      setStatus(firstStatus);

      if (
        window.hermherm?.isDesktop &&
        !firstStatus.ok &&
        !bootAttempted.current
      ) {
        bootAttempted.current = true;
        setIsStarting(true);
        setStartupNote("Warming the isolated local runtime");
        try {
          const result = await client.bootstrapWsl();
          if (cancelled) return;
          setStatus(result.status);
          setStartupNote(
            result.status.ok
              ? "Local runtime ready"
              : (result.status.error ??
                  "Runtime startup finished with warnings"),
          );
        } catch (error) {
          if (cancelled) return;
          setStatus({
            ok: false,
            url: "http://127.0.0.1:8643",
            profile: "hermherm",
            model: fastModel,
            models: {
              fast: {
                name: fastModel,
                label: "Fast Qwen",
                ready: false,
                state: "missing",
              },
              deep: {
                name: deepModel,
                label: "Deep Gemma 4",
                ready: false,
                state: "missing",
              },
            },
            error: error instanceof Error ? error.message : String(error),
          });
          setStartupNote("Local runtime could not start automatically");
        } finally {
          if (!cancelled) setIsStarting(false);
        }
      } else {
        setStartupNote(
          firstStatus.ok
            ? "Local runtime ready"
            : (firstStatus.error ?? "Local runtime offline"),
        );
      }
    }

    void checkAndStart();

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    artifactRef.current?.scrollTo({
      top: artifactRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [exchanges]);

  useEffect(() => {
    if (status?.models?.deep?.state !== "downloading") return;

    const interval = window.setInterval(() => {
      void client
        .status()
        .then(setStatus)
        .catch(() => undefined);
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [client, status?.models?.deep?.state]);

  function newSession() {
    setExchanges([]);
    setInput("");
  }

  async function sendPrompt(prompt: string) {
    const content = prompt.trim();
    if (!content || isSending) return;

    const exchangeId = createId();
    const history = buildHistory();

    setInput("");
    setIsSending(true);
    setExchanges((current) => [
      ...current,
      { id: exchangeId, prompt: content, mode, pending: true },
    ]);

    try {
      const result = await client.chat({ content, history, mode });
      const response =
        result.content || "The local model returned an empty response.";
      const visual = result.visual ?? fallbackVisual(content, response, mode);

      setExchanges((current) =>
        current.map((exchange) =>
          exchange.id === exchangeId
            ? {
                ...exchange,
                pending: false,
                response,
                visual,
                usage: result.usage,
                selectedModel: result.selectedModel,
                selectedBrain: result.selectedBrain,
                router: result.router,
                canRerunDeep: result.canRerunDeep,
              }
            : exchange,
        ),
      );
      const latestStatus = await client.status();
      setStatus(latestStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExchanges((current) =>
        current.map((exchange) =>
          exchange.id === exchangeId
            ? {
                ...exchange,
                pending: false,
                error: message,
                response: `I could not get a local response yet.\n\n\`\`\`text\n${message}\n\`\`\``,
              }
            : exchange,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }

  async function rerunWithDeep(exchange: Exchange) {
    if (isSending || !exchange.prompt) return;

    const exchangeId = createId();
    const history = buildHistory();

    setIsSending(true);
    setExchanges((current) => [
      ...current,
      {
        id: exchangeId,
        prompt: exchange.prompt,
        mode: exchange.mode,
        pending: true,
      },
    ]);

    try {
      const result = await client.rerunDeep({
        content: exchange.prompt,
        history,
        mode: exchange.mode,
      });
      const response =
        result.content || "The deep model returned an empty response.";
      const visual =
        result.visual ??
        fallbackVisual(exchange.prompt, response, exchange.mode);

      setExchanges((current) =>
        current.map((item) =>
          item.id === exchangeId
            ? {
                ...item,
                pending: false,
                response,
                visual,
                usage: result.usage,
                selectedModel: result.selectedModel,
                selectedBrain: result.selectedBrain,
                router: result.router,
                canRerunDeep: result.canRerunDeep,
              }
            : item,
        ),
      );
      const latestStatus = await client.status();
      setStatus(latestStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExchanges((current) =>
        current.map((item) =>
          item.id === exchangeId
            ? {
                ...item,
                pending: false,
                error: message,
                response: `Deep rerun is not ready yet.\n\n\`\`\`text\n${message}\n\`\`\``,
              }
            : item,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void sendPrompt(input);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendPrompt(input);
    }
  }

  return (
    <main
      className={`app-shell mode-${mode} ${isProcessing ? "is-processing" : ""}`}
    >
      <header className="app-topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Orbit size={20} />
          </div>
          <div>
            <p>{platformLabel}</p>
            <h1>HermHerm</h1>
          </div>
        </div>

        <nav className="mode-switcher" aria-label="Mode">
          {modes.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={
                  item.id === mode ? "mode-button active" : "mode-button"
                }
                key={item.id}
                onClick={() => setMode(item.id)}
                type="button"
              >
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="top-actions">
          <button className="ghost-button" type="button" onClick={newSession}>
            <MessageSquarePlus size={16} />
            New
          </button>
          <span className={runtimeReady ? "status-pill ready" : "status-pill"}>
            {runtimeReady ? <CheckCircle2 size={15} /> : <WifiOff size={15} />}
            {runtimeReady ? "Ready" : isStarting ? "Starting" : "Offline"}
          </span>
        </div>
      </header>

      <section className="workbench">
        <aside className="control-deck">
          <section className="core-panel">
            <div className="core-orb" aria-label="HermHerm core">
              <div className="core-ring outer" />
              <div className="core-ring middle" />
              <div className="core-ring inner" />
              <div className="core-center">
                {isProcessing ? (
                  <Loader2 size={36} />
                ) : (
                  <BrainCircuit size={38} />
                )}
              </div>
            </div>
            <div className="core-copy">
              <p>{activeMode.label}</p>
              <h2>{isProcessing ? "Composing locally" : "Awaiting command"}</h2>
              <span>{startupReadable}</span>
            </div>
          </section>

          <section className="system-readout">
            <div className="readout-row">
              <Cpu size={17} />
              <div>
                <span>Fast</span>
                <strong>
                  {status?.models?.fast?.ready ? "Ready" : "Missing"}
                </strong>
              </div>
            </div>
            <div className="readout-row">
              <BrainCircuit size={17} />
              <div>
                <span>Deep</span>
                <strong>{deepState}</strong>
              </div>
            </div>
          </section>

          <form className="composer" onSubmit={handleSubmit}>
            <div className="composer-glow" />
            <textarea
              aria-label="Message"
              disabled={isSending}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={
                runtimeReady
                  ? "Ask HermHerm anything..."
                  : isStarting
                    ? "Local runtime is starting..."
                    : "Ask HermHerm anything..."
              }
              rows={4}
              value={input}
            />
            <button
              className="send-button"
              disabled={isSending || !input.trim()}
              type="submit"
            >
              {isSending ? <Loader2 size={18} /> : <ArrowUp size={18} />}
            </button>
          </form>
        </aside>

        <section
          className="artifact-canvas"
          ref={artifactRef}
          aria-label="Artifact canvas"
        >
          <div className="canvas-head">
            <div>
              <p className="eyebrow">Surface</p>
              <h2>{activeVisual ? "Response" : "Command surface"}</h2>
            </div>
            <span className="mcp-pill">
              <BrainCircuit size={15} />
              {activeVisual?.brainLabel ?? "Local"}
            </span>
          </div>

          {latestExchange?.pending ? (
            <ProcessingArtifact
              prompt={latestExchange.prompt}
              mode={latestExchange.mode}
            />
          ) : activeVisual ? (
            <VisualArtifact
              exchange={latestComplete ?? latestExchange}
              visual={activeVisual}
              deepReady={Boolean(status?.models?.deep?.ready)}
              deepState={status?.models?.deep?.state ?? "missing"}
              isSending={isSending}
              onRerunDeep={rerunWithDeep}
            />
          ) : (
            <EmptyArtifact runtimeReady={runtimeReady} />
          )}
        </section>
      </section>
    </main>
  );
}

function EmptyArtifact({ runtimeReady }: { runtimeReady: boolean }) {
  return (
    <section className="empty-artifact">
      <div className="empty-grid" />
      <div>
        <h3>{runtimeReady ? "Ready for a command" : "Runtime warming"}</h3>
      </div>
    </section>
  );
}

function ProcessingArtifact({
  prompt,
}: {
  prompt: string;
  mode: HermHermMode;
}) {
  return (
    <section className="processing-artifact">
      <div className="breathing-node">
        <CircleDot size={38} />
      </div>
      <div>
        <h3>Thinking</h3>
        <span>{prompt}</span>
      </div>
    </section>
  );
}

function VisualArtifact({
  exchange,
  visual,
  deepReady,
  deepState,
  isSending,
  onRerunDeep,
}: {
  exchange?: Exchange;
  visual: VisualPayload;
  deepReady: boolean;
  deepState: "ready" | "missing" | "downloading" | "error";
  isSending: boolean;
  onRerunDeep: (exchange: Exchange) => void;
}) {
  const duration = exchange?.usage?.total_duration_ms
    ? `${Math.round(exchange.usage.total_duration_ms / 1000)}s`
    : null;
  const fastArtifact =
    exchange?.selectedBrain === "fast" || visual.selectedBrain === "fast";
  const showDeepRerun = Boolean(exchange && fastArtifact);
  const canRerunDeep = showDeepRerun && deepReady && !isSending;
  const routeLabel = visual.router?.route ?? visual.selectedBrain ?? "fast";
  const runMeta = [
    visual.brainLabel ?? "Local",
    routeLabel === "deep" ? "Deep route" : "Fast route",
    duration ? duration : null,
  ].filter(Boolean);

  return (
    <article className="visual-artifact">
      <section className="command-strip">
        <div>
          <p className="eyebrow">You asked</p>
          <h3>{exchange?.prompt ?? visual.headline}</h3>
        </div>
        <div className="artifact-actions">
          {showDeepRerun && exchange ? (
            <button
              className="deep-rerun-button"
              disabled={!canRerunDeep}
              onClick={() => onRerunDeep(exchange)}
              type="button"
            >
              <BrainCircuit size={15} />
              {deepReady
                ? "Rerun with Deep"
                : deepState === "downloading"
                  ? "Deep downloading"
                  : "Deep unavailable"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="answer-panel">
        <div className="answer-topline">
          <div className="run-chips">
            {runMeta.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          {visual.router?.fallback ? (
            <span className="fallback-chip">Fallback</span>
          ) : null}
        </div>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {visual.rawText}
        </ReactMarkdown>
      </section>

      <details className="detail-drawer">
        <summary>Run details</summary>
        <div className="detail-grid">
          <span>Brain</span>
          <strong>{visual.brainLabel ?? "Local"}</strong>
          <span>Model</span>
          <strong>
            {visual.selectedModel ?? exchange?.selectedModel ?? "local"}
          </strong>
          <span>Route</span>
          <strong>
            {visual.router?.route ?? visual.selectedBrain ?? "fast"}
            {visual.router?.confidence
              ? `, ${Math.round(visual.router.confidence * 100)}%`
              : ""}
          </strong>
          {visual.router?.reason ? (
            <>
              <span>Reason</span>
              <strong>{visual.router.reason}</strong>
            </>
          ) : null}
        </div>
        <div className="timeline-track compact">
          {visual.timeline.map((item) => (
            <div className="timeline-node" key={item.id}>
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

export default App;
