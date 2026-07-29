import { BrowserWindow, dialog } from "electron";
import type { IpcMainInvokeEvent, SaveDialogOptions, OpenDialogOptions } from "electron";

// =============================================================================
// Kaydet/klasör dialoglarını IPC'yi GÖNDEREN PENCEREYE bağlar → sheet-modal:
// arka plan kararır (side panel açılınca olan gibi). Yine awaitable olduğundan
// çağıran toast'ı doğru zamanda (kullanıcı onaylayınca) atar. Pencere bulunamazsa
// pencere-bağsız dialoga düşer.
// =============================================================================

export function showSaveDialogFor(e: IpcMainInvokeEvent, opts: SaveDialogOptions) {
  const win = BrowserWindow.fromWebContents(e.sender);
  return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts);
}

export function showOpenDialogFor(e: IpcMainInvokeEvent, opts: OpenDialogOptions) {
  const win = BrowserWindow.fromWebContents(e.sender);
  return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts);
}
