import { registerSecureStoreIpc } from "./secure-store.ipc.js";
import { registerAppInfoIpc } from "./app-info.ipc.js";
import { registerWindowIpc } from "./window.ipc.js";
import { registerSystemIpc } from "./system.ipc.js";

export function registerIpcHandlers(): void {
  registerSecureStoreIpc();
  registerAppInfoIpc();
  registerWindowIpc();
  registerSystemIpc();
}
