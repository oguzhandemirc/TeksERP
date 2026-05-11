import { app, ipcMain } from "electron";

export function registerAppInfoIpc(): void {
  ipcMain.handle("app:version", () => app.getVersion());
}
