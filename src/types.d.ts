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
          history?: Array<{ role: "assistant" | "user"; content: string }>;
        }) => Promise<HermesChatResult>;
      };
    };
  }

  type HermesStatus = {
    ok: boolean;
    url: string;
    profile?: string;
    model?: string;
    ollamaUrl?: string;
    error?: string;
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
  };

  type HermesChatResult = {
    id?: string;
    content: string;
    runtime?: string;
    model?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      total_duration_ms?: number;
    };
    raw?: unknown;
  };
}
