import { dialog, type BrowserWindow, type MessageBoxSyncOptions } from "electron";

/**
 * Pencere/uygulama kapanışı ve yenileme: renderer kirli sekme varken `beforeunload`u engeller
 * (`DirtyTabsConfirm`); Electron bunu sessizce yutar, soru sormak ana sürecin işidir.
 * "Kapat" → engel kaldırılır, pencere kapanır; "Vazgeç" → pencere açık kalır.
 */

export const UNLOAD_CONFIRM_INDEX = 0;

export const unloadDialogOptions: MessageBoxSyncOptions = {
  type: "warning",
  buttons: ["Kapat", "Vazgeç"],
  defaultId: 1,
  cancelId: 1,
  noLink: true,
  title: "Kaydedilmemiş değişiklik",
  message: "Açık sekmelerde kaydedilmemiş değişiklik var.",
  detail: "Kapatırsanız kaydedilmemiş bilgiler kaybolur. Yine de kapatılsın mı?",
};

/**
 * `skipPrompt`: kullanıcı aynı kararı az önce verdiyse (güncelleme kurulumu "Yine de kur") ikinci kez sorulmaz.
 */
export function installUnloadGuard(win: BrowserWindow, skipPrompt: () => boolean = () => false): void {
  win.webContents.on("will-prevent-unload", (event) => {
    if (skipPrompt()) {
      event.preventDefault();
      return;
    }
    const choice = dialog.showMessageBoxSync(win, unloadDialogOptions);
    // preventDefault burada "engeli yok say, kapat" demektir (Electron sözleşmesi).
    if (choice === UNLOAD_CONFIRM_INDEX) event.preventDefault();
  });
}
