// O34: menü adı = sekme adı = sayfa başlığı. Üçü de aynı katalogdan (karo `title` → komut girişi → `resolveTabMeta`)
// okunur; sayfa başlığını literal yazmak menüyle ayrışmanın ilk adımıdır. Bekçi: `screen-title.test.ts`.
import { resolveTabMeta } from "./tabs/tab-meta";

/** Ekranın menüdeki adı — `PageHeader title={screenTitle("/operations/kartela")}`. */
export function screenTitle(path: string): string {
  return resolveTabMeta(path).title;
}
