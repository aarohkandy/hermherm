export {};

declare global {
  interface Window {
    hermherm?: {
      isDesktop: boolean;
      platform: string;
      versions: {
        chrome?: string;
        electron?: string;
        node?: string;
      };
      hermes: {
        status: () => Promise<HermesStatus>;
        bootstrapWsl: () => Promise<{ output: string; status: HermesStatus }>;
        chat: (payload: {
          content: string;
          mode?: HermHermMode;
          history?: Array<{ role: "assistant" | "user"; content: string }>;
        }) => Promise<HermesChatResult>;
        rerunDeep: (payload: {
          content: string;
          mode?: HermHermMode;
          history?: Array<{ role: "assistant" | "user"; content: string }>;
        }) => Promise<HermesChatResult>;
        retryDeepDownload: () => Promise<HermesStatus>;
      };
      visuals?: {
        tools: () => Promise<{
          server: string;
          tools: Array<{ name: string }>;
        }>;
      };
    };
  }

  type HermHermMode = "ask" | "build" | "analyze";

  type VisualTone = "warm" | "green" | "amber";

  type VisualMetric = {
    label: string;
    value: string;
    tone?: VisualTone;
  };

  type VisualCard = {
    id: string;
    kind: "summary" | "status" | "plan" | "scan" | "warning";
    eyebrow: string;
    title: string;
    body: string;
    items?: string[];
    intensity?: number;
  };

  type VisualTimelineItem = {
    id: string;
    label: string;
    title: string;
    detail: string;
    state: "complete" | "ready";
  };

  type BrainId = "fast" | "deep";

  type ModelProgress = {
    percent: number;
    label: string;
  };

  type RouterResult = {
    route: BrainId;
    confidence: number;
    reason: string;
    fallback: boolean;
    selectedBrain?: BrainId;
    selectedModel?: string;
    deepReady?: boolean;
  };

  type VisualPayload = {
    version: number;
    source: string;
    mode: HermHermMode;
    selectedBrain?: BrainId;
    selectedModel?: string;
    brainLabel?: string;
    router?: RouterResult;
    canRerunDeep?: boolean;
    deepReady?: boolean;
    headline: string;
    subtitle: string;
    modeSubtitle?: string;
    intent: string;
    cards: VisualCard[];
    timeline: VisualTimelineItem[];
    metrics: VisualMetric[];
    rawText: string;
  };

  type HermesStatus = {
    ok: boolean;
    url: string;
    profile?: string;
    model?: string;
    activeModel?: string | null;
    ollamaUrl?: string;
    error?: string;
    models?: {
      fast?: {
        name: string;
        label?: string;
        ready: boolean;
        state: "ready" | "missing" | "downloading" | "error";
        error?: string | null;
        progress?: ModelProgress | null;
      };
      deep?: {
        name: string;
        label?: string;
        ready: boolean;
        state: "ready" | "missing" | "downloading" | "error";
        error?: string | null;
        progress?: ModelProgress | null;
      };
    };
    hermes?: {
      ok?: boolean;
      error?: string;
      health?: unknown;
      models?: Array<{ id?: string }>;
    };
    ollama?: {
      ok?: boolean;
      version?: string;
      error?: string;
      models?: string[];
    };
    visualMcp?: {
      ok?: boolean;
      server?: string;
      tools?: string[];
    };
  };

  type HermesChatResult = {
    id?: string;
    content: string;
    runtime?: string;
    model?: string;
    selectedModel?: string;
    selectedBrain?: BrainId;
    router?: RouterResult;
    canRerunDeep?: boolean;
    mode?: HermHermMode;
    visual?: VisualPayload;
    visualMcp?: {
      server: string;
      tools: string[];
    };
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      total_duration_ms?: number;
    };
    raw?: unknown;
  };
}
