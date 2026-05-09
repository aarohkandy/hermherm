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
    };
  }
}
