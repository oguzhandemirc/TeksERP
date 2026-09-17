/// <reference types="vite/client" />
import type { ApiBridge } from "@shared/ipc-contract";

declare global {
  interface Window {
    api: ApiBridge;
  }

  /** Web build'inde Vite `define` ile gömülen renderer sürümü (`vite.config.web.ts`); Electron/test'te tanımsız.
   *  Çift alt çizgi Vite define konvansiyonudur (çıplak tanımlayıcı, başka adla çakışmasın). */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const __APP_VERSION__: string | undefined;

  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
