import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  HardDrive,
  Loader2,
  MessageSquarePlus,
  Moon,
  Sparkles,
  WifiOff,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "./App.css";

type Role = "assistant" | "user";

type Message = {
  id: string;
  role: Role;
  content: string;
  pending?: boolean;
};

type StarterTask = {
  title: string;
  prompt: string;
};

const starterTasks: StarterTask[] = [
  {
    title: "Explain the local setup",
    prompt:
      "Explain what runtime you are using and how you are separate from my default Hermes setup.",
  },
  {
    title: "Plan the next build",
    prompt:
      "Make a practical next-build checklist for turning HermHerm into a polished consumer desktop app.",
  },
  {
    title: "Write a product note",
    prompt:
      "Draft a short product note for HermHerm as a private local AI desktop app.",
  },
];

const welcomeMessage: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "I am ready when the local runtime is ready. Pick a starter task or ask me directly.",
};

const browserClient = {
  async status(): Promise<HermesStatus> {
    return {
      ok: false,
      url: "http://127.0.0.1:8643",
      profile: "hermherm",
      model: "llama3.2:3b",
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

function App() {
  const [messages, setMessages] = useState<Message[]>([welcomeMessage]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<HermesStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [startupNote, setStartupNote] = useState("");
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const bootAttempted = useRef(false);

  const client = useMemo(() => window.hermherm?.hermes ?? browserClient, []);
  const platformLabel = useMemo(() => {
    if (!window.hermherm?.isDesktop) return "Browser preview";
    if (window.hermherm.platform === "win32") return "Windows";
    if (window.hermherm.platform === "darwin") return "macOS";
    return "Desktop";
  }, []);

  const runtimeReady = Boolean(status?.ok);
  const runtimeLabel = runtimeReady
    ? "Local runtime ready"
    : isStarting
      ? "Starting local runtime"
      : "Local runtime offline";
  const detailLabel = runtimeReady
    ? `${status?.model ?? "local model"} through isolated ${status?.profile ?? "hermherm"} runtime`
    : status?.error ?? "Checking WSL, Hermes, and the app-owned model store";

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
        setStartupNote("Preparing the isolated hermherm runtime...");
        try {
          const result = await client.bootstrapWsl();
          if (cancelled) return;
          setStatus(result.status);
          setStartupNote(
            result.status.ok
              ? "Local runtime is ready."
              : result.status.error ?? "Runtime startup finished with warnings.",
          );
        } catch (error) {
          if (cancelled) return;
          setStatus({
            ok: false,
            url: "http://127.0.0.1:8643",
            profile: "hermherm",
            model: "llama3.2:3b",
            error: error instanceof Error ? error.message : String(error),
          });
          setStartupNote("Local runtime could not start automatically.");
        } finally {
          if (!cancelled) setIsStarting(false);
        }
      }
    }

    void checkAndStart();

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    timelineRef.current?.scrollTo({
      top: timelineRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  function newChat() {
    setMessages([welcomeMessage]);
    setInput("");
  }

  async function sendPrompt(prompt: string) {
    const content = prompt.trim();
    if (!content || isSending) return;

    const assistantId = createId();
    const history = messages
      .filter((message) => !message.pending)
      .map(({ role, content }) => ({ role, content }));

    setInput("");
    setIsSending(true);
    setMessages((current) => [
      ...current,
      { id: createId(), role: "user", content },
      { id: assistantId, role: "assistant", content: "Thinking...", pending: true },
    ]);

    try {
      const result = await client.chat({ content, history });
      const footer = result.usage?.total_duration_ms
        ? `\n\n_Local response via ${result.model ?? "Ollama"} in ${Math.round(
            result.usage.total_duration_ms / 1000,
          )}s._`
        : result.model
          ? `\n\n_Local response via ${result.model}._`
          : "";

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                pending: false,
                content:
                  (result.content || "The local model returned an empty response.") +
                  footer,
              }
            : message,
        ),
      );
      const latestStatus = await client.status();
      setStatus(latestStatus);
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                pending: false,
                content: `I could not get a local response yet.\n\n\`\`\`text\n${
                  error instanceof Error ? error.message : String(error)
                }\n\`\`\``,
              }
            : message,
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
    <main className="app-shell">
      <aside className="side-rail" aria-label="HermHerm">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkles size={19} />
          </div>
          <div>
            <p>HermHerm</p>
            <h1>Local AI</h1>
          </div>
        </div>

        <button className="new-chat-button" type="button" onClick={newChat}>
          <MessageSquarePlus size={16} />
          New chat
        </button>

        <section className="runtime-card">
          <div className={runtimeReady ? "runtime-dot ready" : "runtime-dot"} />
          <div>
            <strong>{runtimeLabel}</strong>
            <span>{detailLabel}</span>
          </div>
        </section>

        <section className="starter-section">
          <p className="section-label">Starter tasks</p>
          {starterTasks.map((task) => (
            <button
              className="starter-task"
              disabled={isSending}
              key={task.title}
              onClick={() => void sendPrompt(task.prompt)}
              type="button"
            >
              {task.title}
            </button>
          ))}
        </section>

        <div className="rail-footer">
          <HardDrive size={15} />
          <span>
            Uses the isolated <strong>hermherm</strong> WSL profile and app model
            store. Your default Hermes/Discord setup stays separate.
          </span>
        </div>
      </aside>

      <section className="chat-pane" aria-label="Chat">
        <header className="top-bar">
          <div>
            <p className="eyebrow">{platformLabel} desktop</p>
            <h2>Ask the local assistant</h2>
          </div>
          <div className="status-cluster">
            <span className={runtimeReady ? "status-pill ready" : "status-pill"}>
              {runtimeReady ? <CheckCircle2 size={15} /> : <WifiOff size={15} />}
              {runtimeReady ? "Ready" : isStarting ? "Starting" : "Offline"}
            </span>
            <span className="status-pill quiet">
              <Moon size={15} />
              Dark mode
            </span>
          </div>
        </header>

        <div className="timeline" ref={timelineRef}>
          {startupNote ? (
            <div className="startup-note">
              {isStarting ? <Loader2 size={15} /> : <CheckCircle2 size={15} />}
              <span>{startupNote}</span>
            </div>
          ) : null}

          {messages.map((message) => (
            <article
              className={`message ${message.role} ${message.pending ? "pending" : ""}`}
              key={message.id}
            >
              <div className="avatar">
                {message.role === "assistant" ? <Bot size={16} /> : "A"}
              </div>
              <div className="message-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            </article>
          ))}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            aria-label="Message"
            disabled={isSending}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={
              runtimeReady
                ? "Ask something..."
                : isStarting
                  ? "Local runtime is starting..."
                  : "Ask something; I will start the local runtime if needed..."
            }
            rows={2}
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
      </section>
    </main>
  );
}

export default App;
