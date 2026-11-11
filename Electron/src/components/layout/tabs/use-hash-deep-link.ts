import { useEffect } from "react";
import { useTabsStore } from "@/store/tabs";
import { readHashPath } from "@/lib/use-hash-path";

// Kabuk dışı yollar: oturum-dışı router ya da AppShell'in kendi dalı sahiplenir, sekme açılmaz.
const NON_TAB_PATHS = new Set(["/", "/login", "/2fa-kurulum", "/tezgah-tv"]);

/** `#/x?y=1` → sekmede açılacak yol (sorgu korunur) ya da null. */
export function deepLinkTarget(hash: string): string | null {
  const path = readHashPath(hash);
  if (NON_TAB_PATHS.has(path)) return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?")).split("#")[0] : "";
  return `${path}${query ?? ""}`;
}

/**
 * Sekmeler bellek router'ındadır; adres çubuğundaki hash'i kimse okumuyordu → `#/operations/orders`
 * ile gelen (bağlantı, yer imi, Electron derin bağlantısı) Anasayfa'da kalıyordu. Açılışta ve her
 * `hashchange`te hedef sekmede açılır (açıksa ona geçilir), sonra hash `#/`e indirilir ki yenileme
 * (F5) sekme defterini değil eski bağlantıyı yeniden açmasın.
 */
export function useHashDeepLink(): void {
  const openTab = useTabsStore((s) => s.openTab);
  useEffect(() => {
    const consume = () => {
      const target = deepLinkTarget(window.location.hash);
      if (!target) return;
      openTab(target);
      window.history.replaceState(window.history.state, "", "#/");
    };
    consume();
    window.addEventListener("hashchange", consume);
    return () => window.removeEventListener("hashchange", consume);
  }, [openTab]);
}
