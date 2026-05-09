import { useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  Activity,
  Archive,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Cloud,
  Code2,
  Copy,
  FileText,
  FolderOpen,
  Gauge,
  HardDrive,
  KeyRound,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Mic,
  MonitorUp,
  PanelRight,
  Play,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "./App.css";

type Role = "assistant" | "user";

type Message = {
  id: string;
  role: Role;
  content: string;
  tone?: "quiet" | "normal";
};

type ToolStep = {
  id: string;
  icon: "search" | "file" | "terminal" | "chart";
  label: string;
  detail: string;
  status: "queued" | "running" | "done";
};

type Scenario = {
  id: string;
  title: string;
  kicker: string;
  prompt: string;
  artifactTitle: string;
  artifactKind: string;
  response: string;
  chart: Array<{ label: string; value: number; confidence: number }>;
  bullets: string[];
  tools: Array<Omit<ToolStep, "status">>;
};

const scenarios: Scenario[] = [
  {
    id: "research-brief",
    title: "Research Brief",
    kicker: "Turn messy links into a source-backed summary",
    prompt:
      "Make a clean research brief for launching a consumer AI desktop app.",
    artifactTitle: "Consumer AI Desktop Brief",
    artifactKind: "Research artifact",
    response:
      "I built a first-pass brief around the thing that matters most: **trustable setup**. The pattern is not to make people learn an agent framework. The pattern is to make the first useful result appear, then reveal what the agent did in a calm trace.\n\n| Priority | Decision | Why it matters |\n| --- | --- | --- |\n| 1 | Hosted demo first | Lets Windows users test immediately |\n| 2 | Visible tool cards | Makes agent work inspectable |\n| 3 | Artifact pane | Turns chat into durable output |\n| 4 | Local mode later | Keeps the first build from drowning in model/runtime setup |\n\nNext I would wire this UI to a real streaming provider, then move the shell back to Tauri once Rust/MSVC are installed.",
    chart: [
      { label: "Install", value: 92, confidence: 88 },
      { label: "Trust", value: 84, confidence: 79 },
      { label: "Output", value: 78, confidence: 82 },
      { label: "Local", value: 61, confidence: 70 },
      { label: "Voice", value: 34, confidence: 51 },
    ],
    bullets: [
      "Keep the first run inside a safe demo workspace.",
      "Show the run trace as a product feature, not debug noise.",
      "Make cloud/local status visible in every run.",
    ],
    tools: [
      {
        id: "scan",
        icon: "search",
        label: "Searched product references",
        detail:
          "Claude, ChatGPT Desktop, Granola, Raycast, Open WebUI patterns",
      },
      {
        id: "rank",
        icon: "chart",
        label: "Ranked launch risks",
        detail:
          "Install, trust, output quality, local model setup, voice latency",
      },
      {
        id: "write",
        icon: "file",
        label: "Drafted brief",
        detail:
          "Created a durable artifact with next actions and decision notes",
      },
    ],
  },
  {
    id: "tool-lab",
    title: "Tool Lab",
    kicker: "Debug an agent run without staring at JSON",
    prompt: "Show me how a tool debugging lab should work for normal people.",
    artifactTitle: "Tool Lab Run Trace",
    artifactKind: "Debug artifact",
    response:
      'The tool lab should feel like a flight recorder. Each tool gets a friendly name, visible inputs, visible outputs, retry controls, and a clear boundary around what it can touch.\n\n```json\n{\n  "tool": "filesystem.search",\n  "scope": "sample-workspace",\n  "approval": "read-only",\n  "status": "passed"\n}\n```\n\nThe important design move is to collapse details by default while keeping every claim inspectable.',
    chart: [
      { label: "Inputs", value: 76, confidence: 72 },
      { label: "Logs", value: 88, confidence: 83 },
      { label: "Retry", value: 69, confidence: 64 },
      { label: "Secrets", value: 94, confidence: 90 },
      { label: "Replay", value: 81, confidence: 77 },
    ],
    bullets: [
      "Make permissions readable before the tool runs.",
      "Keep inputs, outputs, and errors in one expandable row.",
      "Let users copy, retry, or disable a tool from the trace.",
    ],
    tools: [
      {
        id: "schema",
        icon: "terminal",
        label: "Loaded sample tool schema",
        detail: "Read-only filesystem search with one safe demo folder",
      },
      {
        id: "call",
        icon: "terminal",
        label: "Simulated tool call",
        detail: "Captured arguments, result preview, duration, and retry state",
      },
      {
        id: "artifact",
        icon: "chart",
        label: "Rendered trace",
        detail: "Turned raw tool output into a compact run inspector",
      },
    ],
  },
  {
    id: "local-mode",
    title: "Local Mode Plan",
    kicker: "Map the road to private, offline agent runs",
    prompt: "Plan the local mode path without making v1 too heavy.",
    artifactTitle: "Local Mode Readiness",
    artifactKind: "Build plan",
    response:
      "Local mode should be sold as the trust upgrade, not buried in settings. The app can prepare the path now by keeping provider status, model status, and filesystem scope visible.\n\n**Recommended sequence**\n\n1. Ship hosted demo mode.\n2. Add a Hermes sidecar health check.\n3. Add Ollama detection before downloading anything.\n4. Add model download progress with pause/resume.\n5. Gate terminal/file write tools behind approval.",
    chart: [
      { label: "UI", value: 91, confidence: 86 },
      { label: "Hermes", value: 58, confidence: 62 },
      { label: "Ollama", value: 46, confidence: 55 },
      { label: "Signing", value: 38, confidence: 49 },
      { label: "Models", value: 42, confidence: 52 },
    ],
    bullets: [
      "Do not bundle a giant model in the first installer.",
      "Treat sidecar health as a visible product state.",
      "Make offline/privacy copy concrete and verifiable.",
    ],
    tools: [
      {
        id: "health",
        icon: "terminal",
        label: "Checked runtime assumptions",
        detail: "Hermes API server, Ollama endpoint, model context length",
      },
      {
        id: "scope",
        icon: "file",
        label: "Mapped safe scopes",
        detail:
          "Read-only demo workspace first; write access requires approval",
      },
      {
        id: "plan",
        icon: "chart",
        label: "Built rollout plan",
        detail: "Hosted v1, local v1.1, voice after transport is stable",
      },
    ],
  },
];

const initialMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    tone: "quiet",
    content:
      "Pick a starter task or type your own. This first build runs in demo mode, so you can test the desktop shell, streaming feel, tool cards, and artifact pane before any real provider keys or Hermes sidecars exist.",
  },
];

const navItems = [
  { label: "Playground", icon: MessageSquareText, active: true },
  { label: "Runs", icon: Activity },
  { label: "Artifacts", icon: Archive },
  { label: "Tools", icon: Wrench },
  { label: "Settings", icon: Settings },
];

const inspectorRows = [
  { label: "Cloud demo", value: "Active", icon: Cloud, good: true },
  { label: "Local runtime", value: "Planned", icon: HardDrive },
  {
    label: "File access",
    value: "Read-only sample",
    icon: FolderOpen,
    good: true,
  },
  { label: "Terminal", value: "Approval required", icon: TerminalSquare },
];

const roadmap = [
  "Real streaming provider adapter",
  "Hermes API health check",
  "Windows installer artifact",
  "Tauri migration spike",
];

const delay = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const createId = () => Math.random().toString(36).slice(2);

function App() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeScenario, setActiveScenario] = useState<Scenario>(scenarios[0]);
  const [toolSteps, setToolSteps] = useState<ToolStep[]>(
    scenarios[0].tools.map((tool) => ({ ...tool, status: "done" })),
  );

  const platformLabel = useMemo(() => {
    if (!window.hermherm?.isDesktop) return "Browser preview";
    if (window.hermherm.platform === "win32") return "Windows desktop";
    if (window.hermherm.platform === "darwin") return "macOS desktop";
    return "Desktop app";
  }, []);

  async function runScenario(scenario: Scenario, customPrompt?: string) {
    if (isRunning) return;

    const prompt = customPrompt?.trim() || scenario.prompt;
    if (!prompt) return;

    setIsRunning(true);
    setActiveScenario(scenario);
    setInput("");
    setToolSteps(scenario.tools.map((tool) => ({ ...tool, status: "queued" })));

    const assistantId = createId();
    setMessages((current) => [
      ...current,
      { id: createId(), role: "user", content: prompt },
      { id: assistantId, role: "assistant", content: "" },
    ]);

    await delay(240);

    for (const tool of scenario.tools) {
      setToolSteps((steps) =>
        steps.map((step) =>
          step.id === tool.id ? { ...step, status: "running" } : step,
        ),
      );
      await delay(520);
      setToolSteps((steps) =>
        steps.map((step) =>
          step.id === tool.id ? { ...step, status: "done" } : step,
        ),
      );
    }

    const chunks = scenario.response.match(/(.|[\r\n]){1,34}/g) ?? [
      scenario.response,
    ];
    for (const chunk of chunks) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: `${message.content}${chunk}` }
            : message,
        ),
      );
      await delay(18);
    }

    setIsRunning(false);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runScenario(activeScenario, input);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void runScenario(activeScenario, input);
    }
  }

  return (
    <main className="app-shell">
      <aside className="left-rail" aria-label="Primary">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkles size={20} strokeWidth={2.2} />
          </div>
          <div>
            <p className="eyebrow">HermHerm</p>
            <h1>Agent Lab</h1>
          </div>
        </div>

        <button
          className="new-run-button"
          type="button"
          onClick={() => void runScenario(scenarios[0])}
        >
          <Plus size={16} />
          New run
        </button>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              className={item.active ? "active" : ""}
              key={item.label}
              type="button"
            >
              <item.icon size={17} />
              {item.label}
            </button>
          ))}
        </nav>

        <section className="rail-section">
          <div className="section-heading">
            <span>Starter tasks</span>
          </div>
          <div className="starter-list">
            {scenarios.map((scenario) => (
              <button
                className={
                  scenario.id === activeScenario.id
                    ? "starter active"
                    : "starter"
                }
                key={scenario.id}
                type="button"
                onClick={() => void runScenario(scenario)}
              >
                <span>{scenario.title}</span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </section>

        <div className="rail-footer">
          <ShieldCheck size={16} />
          <span>Demo mode: no files are touched.</span>
        </div>
      </aside>

      <section className="run-pane" aria-label="Run timeline">
        <header className="top-bar">
          <div>
            <p className="eyebrow">First Windows playground</p>
            <h2>See the product shape before wiring the engine.</h2>
          </div>
          <div className="top-actions">
            <span className="status-pill">
              <MonitorUp size={15} />
              {platformLabel}
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="Open output panel"
            >
              <PanelRight size={18} />
            </button>
          </div>
        </header>

        <div className="suggestion-strip" aria-label="Suggested tasks">
          {scenarios.map((scenario) => (
            <button
              className="suggestion"
              key={scenario.id}
              type="button"
              onClick={() => void runScenario(scenario)}
            >
              <span>{scenario.title}</span>
              <small>{scenario.kicker}</small>
            </button>
          ))}
        </div>

        <div className="timeline">
          {messages.map((message) => (
            <article
              className={`message ${message.role} ${message.tone ?? ""}`}
              key={message.id}
            >
              <div className="avatar">
                {message.role === "assistant" ? (
                  <Bot size={16} />
                ) : (
                  <span>A</span>
                )}
              </div>
              <div className="message-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {message.content || "Working..."}
                </ReactMarkdown>
              </div>
            </article>
          ))}
        </div>

        <section className="tool-trace" aria-label="Tool trace">
          <div className="section-heading">
            <span>Run trace</span>
            <span>{isRunning ? "Running" : "Ready"}</span>
          </div>
          <div className="tool-list">
            {toolSteps.map((step) => (
              <ToolRow key={step.id} step={step} />
            ))}
          </div>
        </section>

        <form className="composer" onSubmit={handleSubmit}>
          <div className="composer-tools" aria-label="Composer tools">
            <button type="button" aria-label="Attach file">
              <FolderOpen size={16} />
            </button>
            <button type="button" aria-label="Capture screen">
              <MonitorUp size={16} />
            </button>
            <button type="button" aria-label="Voice input">
              <Mic size={16} />
            </button>
            <span className="mode-chip">
              <LockKeyhole size={14} />
              Safe demo
            </span>
          </div>
          <textarea
            aria-label="Message"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask the playground to draft, inspect, compare, or plan..."
            rows={2}
            value={input}
          />
          <button
            className="send-button"
            disabled={isRunning || !input.trim()}
            type="submit"
          >
            <ArrowUp size={18} />
          </button>
        </form>
      </section>

      <aside className="right-pane" aria-label="Output and inspector">
        <section className="artifact-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Output studio</p>
              <h2>{activeScenario.artifactTitle}</h2>
            </div>
            <span>{activeScenario.artifactKind}</span>
          </div>

          <div className="chart-block">
            <ResponsiveContainer width="100%" height={190}>
              <AreaChart
                data={activeScenario.chart}
                margin={{ top: 12, right: 12, left: -16, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="valueGradient"
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#2c7a73" stopOpacity={0.36} />
                    <stop offset="95%" stopColor="#2c7a73" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="#e3e7ec"
                  strokeDasharray="4 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <YAxis hide domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    border: "1px solid #d9dee7",
                    borderRadius: 8,
                    boxShadow: "0 18px 42px rgba(15, 23, 42, 0.12)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#2c7a73"
                  strokeWidth={2}
                  fill="url(#valueGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="artifact-list">
            {activeScenario.bullets.map((bullet) => (
              <div className="artifact-row" key={bullet}>
                <Check size={16} />
                <span>{bullet}</span>
              </div>
            ))}
          </div>

          <div className="artifact-actions">
            <button type="button">
              <Copy size={15} />
              Copy
            </button>
            <button type="button">
              <FileText size={15} />
              Open as doc
            </button>
          </div>
        </section>

        <section className="inspector-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Run boundaries</p>
              <h2>What can it touch?</h2>
            </div>
            <Gauge size={18} />
          </div>
          <div className="inspector-list">
            {inspectorRows.map((row) => (
              <div className="inspector-row" key={row.label}>
                <row.icon size={16} />
                <span>{row.label}</span>
                <strong className={row.good ? "good" : ""}>{row.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="inspector-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Coming up</p>
              <h2>Build track</h2>
            </div>
            <Clock3 size={18} />
          </div>
          <div className="roadmap-list">
            {roadmap.map((item, index) => (
              <div className="roadmap-item" key={item}>
                <span>{index + 1}</span>
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="key-panel">
          <KeyRound size={17} />
          <span>
            Provider keys and Hermes sidecars are intentionally not wired in
            this first playground.
          </span>
        </section>
      </aside>
    </main>
  );
}

function ToolRow({ step }: { step: ToolStep }) {
  const Icon = toolIcons[step.icon];
  const statusIcon =
    step.status === "done" ? (
      <Check size={14} />
    ) : step.status === "running" ? (
      <Play size={14} />
    ) : (
      <X size={14} />
    );

  return (
    <div className={`tool-row ${step.status}`}>
      <div className="tool-icon">
        <Icon size={16} />
      </div>
      <div>
        <strong>{step.label}</strong>
        <span>{step.detail}</span>
      </div>
      <div className="tool-status">{statusIcon}</div>
    </div>
  );
}

const toolIcons = {
  search: Search,
  file: FileText,
  terminal: Code2,
  chart: Layers3,
} satisfies Record<ToolStep["icon"], typeof Search>;

export default App;
