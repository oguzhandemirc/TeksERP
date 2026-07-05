import { ipcMain, powerMonitor } from "electron";

/**
 * Sistem-geneli boşta kalma süresi (saniye). `powerMonitor.getSystemIdleTime()`
 * TÜM makinenin son fare/klavye girdisinden bu yana geçen süreyi verir — yalnız
 * Electron penceresi değil. Panel hareketsizlik çıkışı (useIdleLogout) bunu okur;
 * böylece kullanıcı başka programla çalışırken oturum düşmez, ancak kimse
 * bilgisayara dokunmadığında düşer.
 */
export function registerPowerIpc(): void {
  ipcMain.handle("power:get-system-idle-time", () => powerMonitor.getSystemIdleTime());
}
