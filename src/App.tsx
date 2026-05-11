import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  ArrowUp,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Loader2,
  MessageSquarePlus,
  Orbit,
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

const modeCopy: Record<HermHermMode, { label: string; hint: string }> = {
  ask: { label: "Listening", hint: "Fast local synthesis" },
  build: { label: "Constructing", hint: "Planning and making" },
  analyze: { label: "Scanning", hint: "Reading for patterns" },
};

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
  async retryDeepDownload(): Promise<HermesStatus> {
    throw new Error("Deep download retry is available in the desktop app.");
  },
};

const createId = () => Math.random().toString(36).slice(2);

const clampPercent = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;

function inferPromptMode(content: string): HermHermMode {
  const normalized = content.toLowerCase();
  if (
    /\b(build|make|create|implement|fix|change|update|design|code|app|feature)\b/.test(
      normalized,
    )
  ) {
    return "build";
  }

  if (
    /\b(analyze|analyse|compare|review|explain why|tradeoff|risk|inspect|summarize)\b/.test(
      normalized,
    )
  ) {
    return "analyze";
  }

  return "ask";
}

function friendlyDeepError(error?: string | null) {
  if (!error) return "Gemma 4 could not finish downloading.";
  if (/network.*block|dns.*redirect|registry.*redirect|private/i.test(error)) {
    return "Network is blocking Gemma 4.";
  }
  if (/timeout|timed out|i\/o timeout/i.test(error)) {
    return "Ollama registry timed out.";
  }
  if (/manifest|not found/i.test(error)) {
    return "Gemma 4 manifest is unavailable.";
  }
  if (/command failed|wsl\.exe|download check/i.test(error)) {
    return "Download check failed.";
  }

  return "Gemma 4 download paused.";
}

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
        title: "Decoded signal",
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
  const latestExchange = exchanges[exchanges.length - 1];
  const latestComplete = [...exchanges].reverse().find((item) => item.visual);
  const activeVisual = latestExchange?.visual ?? latestComplete?.visual;
  const surfaceMode = latestExchange?.mode ?? latestComplete?.mode ?? "ask";
  const activeMode = modeCopy[surfaceMode];
  const isProcessing =
    isStarting || isSending || Boolean(latestExchange?.pending);
  const startupReadable = runtimeReady
    ? "Fast ready. Deep runs when available."
    : startupNote;
  const deepTargetState =
    status?.models?.deep?.targetState ?? status?.models?.deep?.state;
  const deepTargetDownloading =
    deepTargetState === "downloading" ||
    status?.models?.deep?.state === "downloading";
  const deepState = status?.models?.deep?.ready
    ? status.models.deep.fallback
      ? deepTargetDownloading
        ? "Gemma 4 downloading"
        : "Deep fallback"
      : "Ready"
    : status?.models?.deep?.state === "downloading"
      ? "Downloading"
      : status?.models?.deep?.state === "error"
        ? "Needs retry"
        : "Waiting";
  const deepProgress = status?.models?.deep?.progress;
  const deepPercent = clampPercent(deepProgress?.percent);
  const deepError = status?.models?.deep?.error;
  const deepErrorLabel = friendlyDeepError(deepError);
  const deepProgressLabel =
    deepProgress?.label ??
    (deepTargetDownloading ? "Preparing download" : deepState);
  const deepSubstatus = status?.models?.deep?.fallback
    ? deepTargetDownloading
      ? `${status.models.deep.label ?? status.models.deep.name} is active. ${deepProgressLabel}`
      : deepTargetState === "error"
        ? `${status.models.deep.label ?? status.models.deep.name} is active. ${deepProgressLabel}`
        : `${status.models.deep.label ?? status.models.deep.name} is active while Gemma 4 retries.`
    : deepProgressLabel;
  const shouldPollDeep =
    status?.models?.deep?.state === "downloading" ||
    deepTargetState === "downloading" ||
    Boolean(
      status?.models?.deep?.fallback &&
      status.models.deep.targetName &&
      status.models.deep.targetName !== status.models.deep.name,
    );

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
    if (!shouldPollDeep) return;

    const interval = window.setInterval(() => {
      void client
        .status()
        .then(setStatus)
        .catch(() => undefined);
    }, 3_000);

    return () => window.clearInterval(interval);
  }, [client, shouldPollDeep]);

  function newSession() {
    setExchanges([]);
    setInput("");
  }

  async function retryDeepDownload() {
    setStatus((current) =>
      current
        ? {
            ...current,
            models: {
              ...(current.models ?? {}),
              deep: current.models?.deep
                ? {
                    ...current.models.deep,
                    state: "downloading",
                    error: null,
                    progress: { percent: 0, label: "Retrying download" },
                  }
                : current.models?.deep,
            },
          }
        : current,
    );

    try {
      const nextStatus = await client.retryDeepDownload();
      setStatus(nextStatus);
    } catch (error) {
      setStatus((current) =>
        current
          ? {
              ...current,
              models: {
                ...(current.models ?? {}),
                deep: current.models?.deep
                  ? {
                      ...current.models.deep,
                      state: "error",
                      error:
                        error instanceof Error ? error.message : String(error),
                      progress: { percent: 0, label: "Retry failed" },
                    }
                  : current.models?.deep,
              },
            }
          : current,
      );
    }
  }

  async function sendPrompt(prompt: string) {
    const content = prompt.trim();
    if (!content || isSending) return;

    const exchangeId = createId();
    const history = buildHistory();
    const promptMode = inferPromptMode(content);

    setInput("");
    setIsSending(true);
    setExchanges((current) => [
      ...current,
      { id: exchangeId, prompt: content, mode: promptMode, pending: true },
    ]);

    try {
      const result = await client.chat({ content, history, mode: promptMode });
      const response =
        result.content || "The local model returned an empty response.";
      const visual =
        result.visual ?? fallbackVisual(content, response, promptMode);

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
      className={`app-shell mode-${surfaceMode} ${
        isProcessing ? "is-processing" : ""
      }`}
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

        <div className="entity-status" aria-live="polite">
          <span>{isProcessing ? "Signal active" : "Signal idle"}</span>
          <strong>{activeMode.hint}</strong>
        </div>

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
            <SignalCore state={isProcessing ? "thinking" : "idle"} compact />
            <div className="core-copy">
              <p>{activeMode.label}</p>
              <h2>{isProcessing ? "Signal forming" : "Awaiting impulse"}</h2>
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
            <div
              className={
                status?.models?.deep?.state === "downloading"
                  ? "readout-row deep-readout is-downloading"
                  : status?.models?.deep?.state === "error" ||
                      deepTargetState === "error"
                    ? "readout-row deep-readout is-error"
                    : "readout-row deep-readout"
              }
            >
              <BrainCircuit size={17} />
              <div>
                <span>Deep</span>
                <strong>{deepState}</strong>
                {status?.models?.deep?.state !== "error" &&
                (deepTargetDownloading || deepPercent !== null) ? (
                  <>
                    <div
                      aria-label="Deep download progress"
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={deepPercent ?? 0}
                      className="download-track"
                      role="progressbar"
                    >
                      <i style={{ width: `${deepPercent ?? 0}%` }} />
                    </div>
                    <small>
                      {deepPercent !== null
                        ? `${deepPercent}% - ${deepSubstatus}`
                        : deepSubstatus}
                    </small>
                  </>
                ) : null}
                {status?.models?.deep?.state === "error" ? (
                  <>
                    <small title={deepErrorLabel}>{deepErrorLabel}</small>
                    <button
                      className="inline-retry-button"
                      onClick={retryDeepDownload}
                      type="button"
                    >
                      Retry
                    </button>
                  </>
                ) : null}
                {status?.models?.deep?.fallback && deepError ? (
                  <button
                    className="inline-retry-button quiet"
                    onClick={retryDeepDownload}
                    type="button"
                  >
                    Retry Gemma 4
                  </button>
                ) : null}
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
                  ? "Tell HermHerm what to do..."
                  : isStarting
                    ? "Local runtime is waking..."
                    : "Tell HermHerm what to do..."
              }
              rows={4}
              value={input}
            />
            <button
              className={isSending ? "send-button is-loading" : "send-button"}
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
              <p className="eyebrow">Living surface</p>
              <h2>{activeVisual ? "Signal resolved" : activeMode.label}</h2>
              <span>{activeMode.hint}</span>
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

function SignalCore({
  state,
  compact = false,
}: {
  state: "idle" | "thinking" | "resolved";
  compact?: boolean;
}) {
  return (
    <div
      className={`signal-core signal-${state} ${compact ? "compact" : ""}`}
      aria-label="HermHerm signal core"
    >
      <div className="signal-halo" />
      <div className="signal-orbit orbit-one" />
      <div className="signal-orbit orbit-two" />
      <div className="signal-orbit orbit-three" />
      <div className="signal-nucleus" />
    </div>
  );
}

function EmptyArtifact({ runtimeReady }: { runtimeReady: boolean }) {
  return (
    <section className="empty-artifact">
      <div className="field-grid" />
      <SignalCore state={runtimeReady ? "idle" : "thinking"} />
      <div className="surface-caption">
        <p>{runtimeReady ? "Listening" : "Warming"}</p>
        <h3>{runtimeReady ? "Awaiting impulse" : "Local mind waking"}</h3>
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
  const active = modeCopy[mode] ?? modeCopy.ask;

  return (
    <section className="processing-artifact">
      <SignalCore state="thinking" />
      <div>
        <h3>Signal forming</h3>
        <p>{active.hint}</p>
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
          <p className="eyebrow">Input</p>
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

      <section className="answer-panel signal-output">
        <div className="signal-output-core">
          <SignalCore state="resolved" compact />
          <div>
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
            <p className="signal-caption">
              {visual.brainLabel ?? "Local signal"}
            </p>
            <h3>{visual.modeSubtitle ?? "Response"}</h3>
            <div className="answer-readout">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {visual.rawText}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        <div className="signal-card-grid">
          {visual.cards.slice(0, 3).map((card) => (
            <section className={`signal-card kind-${card.kind}`} key={card.id}>
              <span>{card.eyebrow}</span>
              <strong>{card.title}</strong>
              <p>{card.body}</p>
              {card.items?.length ? (
                <div className="signal-points">
                  {card.items.slice(0, 4).map((item) => (
                    <i key={item}>{item}</i>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </section>

      <details className="detail-drawer transcript-drawer">
        <summary>Transcript</summary>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {visual.rawText}
        </ReactMarkdown>
      </details>

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
