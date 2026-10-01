import { powerMonitor } from "electron";
import { handleTrusted } from "../security/trusted-ipc.js";

/**
 * Sistem-geneli boşta kalma süresi (saniye). `powerMonitor.getSystemIdleTime()`
 * TÜM makinenin son fare/klavye girdisinden bu yana geçen süreyi verir — yalnız
 * Electron penceresi değil. Panel hareketsizlik çıkışı (useIdleLogout) bunu okur;
 * böylece kullanıcı başka programla çalışırken oturum düşmez, ancak kimse
 * bilgisayara dokunmadığında düşer.
 */
export function registerPowerIpc(): void {
  handleTrusted("power:get-system-idle-time", () => powerMonitor.getSystemIdleTime());
}
