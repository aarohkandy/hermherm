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
        chat: (payload: { content: string; sessionId?: string }) => Promise<{
          id?: string;
          content: string;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
          raw?: unknown;
        }>;
      };
    };
  }

  type HermesStatus = {
    ok: boolean;
    url: string;
    error?: string;
    health?: unknown;
    models?: Array<{ id?: string }>;
  };
}
