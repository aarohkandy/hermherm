import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import {
  ArrowUp,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  Cpu,
  Gauge,
  HardDrive,
  Layers3,
  Loader2,
  MessageSquarePlus,
  Orbit,
  PanelTop,
  Radar,
  ScanLine,
  Sparkles,
  WifiOff,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "./App.css";

const defaultLocalModel = "gemma3:4b";

type Exchange = {
  id: string;
  prompt: string;
  mode: HermHermMode;
  pending?: boolean;
  response?: string;
  visual?: VisualPayload;
  error?: string;
  usage?: HermesChatResult["usage"];
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
  "Local model engaged",
  "Visual MCP composing",
  "Artifact readying",
];

const browserClient = {
  async status(): Promise<HermesStatus> {
    return {
      ok: false,
      url: "http://127.0.0.1:8643",
      profile: "hermherm",
      model: defaultLocalModel,
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
      { label: "Model", value: defaultLocalModel, tone: "warm" },
      { label: "Visual MCP", value: "preview", tone: "amber" },
    ],
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
    if (!window.hermherm?.isDesktop) return "Browser preview";
    if (window.hermherm.platform === "win32") return "Windows command surface";
    if (window.hermherm.platform === "darwin") return "macOS command surface";
    return "Desktop command surface";
  }, []);

  const runtimeReady = Boolean(status?.ok);
  const activeMode = modes.find((item) => item.id === mode) ?? modes[0];
  const latestExchange = exchanges[exchanges.length - 1];
  const latestComplete = [...exchanges].reverse().find((item) => item.visual);
  const activeVisual = latestExchange?.visual ?? latestComplete?.visual;
  const isProcessing =
    isStarting || isSending || Boolean(latestExchange?.pending);
  const runtimeLabel = runtimeReady
    ? "Local runtime ready"
    : isStarting
      ? "Starting local runtime"
      : "Local runtime offline";
  const startupReadable = runtimeReady
    ? "Gemma and the isolated hermherm profile are ready."
    : startupNote;

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
            model: defaultLocalModel,
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

  function newSession() {
    setExchanges([]);
    setInput("");
  }

  async function sendPrompt(prompt: string) {
    const content = prompt.trim();
    if (!content || isSending) return;

    const exchangeId = createId();
    const history = exchanges
      .filter((exchange) => exchange.response && !exchange.pending)
      .flatMap((exchange) => [
        { role: "user" as const, content: exchange.prompt },
        { role: "assistant" as const, content: exchange.response ?? "" },
      ])
      .slice(-8);

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
              <p>{activeMode.noun}</p>
              <h2>{isProcessing ? "Composing locally" : "Awaiting command"}</h2>
              <span>{startupReadable}</span>
            </div>
          </section>

          <section className="system-readout">
            <div className="readout-row">
              <Cpu size={17} />
              <div>
                <span>Model</span>
                <strong>{status?.model ?? defaultLocalModel}</strong>
              </div>
            </div>
            <div className="readout-row">
              <HardDrive size={17} />
              <div>
                <span>Profile</span>
                <strong>{status?.profile ?? "hermherm"}</strong>
              </div>
            </div>
            <div className="readout-row">
              <PanelTop size={17} />
              <div>
                <span>Visual MCP</span>
                <strong>
                  {status?.visualMcp?.server ?? "hermherm-visuals"}
                </strong>
              </div>
            </div>
            <div className="readout-row">
              <Gauge size={17} />
              <div>
                <span>Runtime</span>
                <strong>{runtimeLabel}</strong>
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
              <p className="eyebrow">Artifact canvas</p>
              <h2>{activeVisual?.headline ?? "Command surface"}</h2>
            </div>
            <span className="mcp-pill">
              <Radar size={15} />
              {status?.visualMcp?.tools?.length ?? 5} tools
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
        <p className="eyebrow">System state</p>
        <h3>{runtimeReady ? "Ready for a command" : "Runtime warming"}</h3>
        <span>
          {runtimeReady
            ? "Standing by."
            : "Gemma, Hermes, and the visual server are being checked."}
        </span>
      </div>
    </section>
  );
}

function ProcessingArtifact({
  prompt,
  mode,
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
        <p className="eyebrow">{mode}</p>
        <h3>{prompt}</h3>
      </div>
      <div className="stage-stack">
        {processingStages.map((stage, index) => (
          <div className="stage-row" key={stage}>
            <span>{index + 1}</span>
            <strong>{stage}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function VisualArtifact({
  exchange,
  visual,
}: {
  exchange?: Exchange;
  visual: VisualPayload;
}) {
  const duration = exchange?.usage?.total_duration_ms
    ? `${Math.round(exchange.usage.total_duration_ms / 1000)}s`
    : null;

  return (
    <article className="visual-artifact">
      <section className="command-strip">
        <div>
          <p className="eyebrow">Command</p>
          <h3>{exchange?.prompt ?? visual.headline}</h3>
        </div>
        <span>{visual.subtitle}</span>
      </section>

      <section className="metric-grid">
        {visual.metrics.map((metric) => (
          <div
            className={`metric-card tone-${metric.tone ?? "warm"}`}
            key={metric.label}
          >
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </section>

      <section className="visual-card-grid">
        {visual.cards.map((card) => (
          <div className={`visual-card kind-${card.kind}`} key={card.id}>
            <div
              className="card-meter"
              style={{ "--level": `${card.intensity ?? 70}%` } as CSSProperties}
            />
            <p>{card.eyebrow}</p>
            <h3>{card.title}</h3>
            <span>{card.body}</span>
            {card.items && card.items.length > 0 ? (
              <ul>
                {card.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </section>

      <section className="timeline-panel">
        <div className="timeline-head">
          <p className="eyebrow">Task map</p>
          <span>
            {duration
              ? `Local response via ${exchange?.visual?.metrics[0]?.value ?? "Ollama"} in ${duration}`
              : "Local response via Gemma"}
          </span>
        </div>
        <div className="timeline-track">
          {visual.timeline.map((item) => (
            <div className="timeline-node" key={item.id}>
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </section>

      <details className="detail-drawer">
        <summary>Detail</summary>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {visual.rawText}
        </ReactMarkdown>
      </details>
    </article>
  );
}

export default App;
