/// <reference types="vite/client" />
import type { ApiBridge } from "@shared/ipc-contract";

declare global {
  interface Window {
    api: ApiBridge;
  }

  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
