/**
 * Main ↔ renderer IPC kontratı.
 * - Yeni kanal eklerken: bu dosyaya tip ekle, electron/ipc/<domain>.ipc.ts'ye handler ekle,
 *   electron/preload.ts'ye bridge ekle. (electron-admin-page skill bu dört adımı atomik yapar.)
 * - Yalnız serializable veri geçer.
 */

export interface SecureStoreApi {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type AppPlatform = "darwin" | "win32" | "linux" | "aix" | "freebsd" | "openbsd" | "sunos";

export interface AppInfoApi {
  version: () => Promise<string>;
  platform: () => AppPlatform;
}

export interface WindowApi {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
}

export interface SystemApi {
  openExternal: (url: string) => Promise<void>;
  showInFolder: (path: string) => void;
}

export interface ApiBridge {
  secureStore: SecureStoreApi;
  appInfo: AppInfoApi;
  window: WindowApi;
  system: SystemApi;
}

declare global {
  interface Window {
    api: ApiBridge;
  }
}

export {};
