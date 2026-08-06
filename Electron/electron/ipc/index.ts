import { registerSecureStoreIpc } from "./secure-store.ipc.js";
import { registerAppInfoIpc } from "./app-info.ipc.js";
import { registerWindowIpc } from "./window.ipc.js";
import { registerSystemIpc } from "./system.ipc.js";
import { registerPowerIpc } from "./power.ipc.js";
import { registerScannerIpc } from "./scanner.ipc.js";
import { registerPrinterIpc } from "./printer.ipc.js";
import { registerScaleIpc } from "./scale.ipc.js";
import { registerPdfIpc } from "./pdf.ipc.js";
import { registerFilesIpc } from "./files.ipc.js";

export function registerIpcHandlers(): void {
  registerSecureStoreIpc();
  registerAppInfoIpc();
  registerWindowIpc();
  registerSystemIpc();
  registerPowerIpc();
  registerScannerIpc();
  registerPrinterIpc();
  registerScaleIpc();
  registerPdfIpc();
  registerFilesIpc();
}
