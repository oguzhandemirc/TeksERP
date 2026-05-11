import { ipcMain, shell } from "electron";

export function registerSystemIpc(): void {
  ipcMain.handle("system:open-external", async (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error("Invalid URL");
    await shell.openExternal(url);
  });
  ipcMain.on("system:show-in-folder", (_e, path: string) =>
    shell.showItemInFolder(path),
  );
}
