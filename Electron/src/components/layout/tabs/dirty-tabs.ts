import { useEffect, useSyncExternalStore } from "react";
import { useTabId } from "./tab-active";

/**
 * KİRLİ SEKME KAYDI — "bu sekmede kaydedilmemiş değişiklik var mı?" sorusunun TEK kaynağı
 * (sekme kapatma onayı, başlıktaki nokta, çıkış ve pencere kapanışı buradan okur).
 *
 * İki besleyici, ekran başına tel yok:
 *  ① Açık beyan: `useDirtyTab(isDirty)` — ortak form katmanı (`EntityFormDialog`, react-hook-form `isDirty`)
 *     ve kendi kirlilik ölçüsü olan sayfa editörleri. Beyanlı kutu `data-dirty-managed` taşır; ② ona karışmaz.
 *  ② Yazılmış pencere: sekmeye portallanan ortak diyalog/yan pencere (`data-ui-dialog` / `data-ui-sheet`)
 *     içindeki alana yazıldıysa o sekme kirlidir; pencere DOM'dan kalkınca (kaydet/iptal/kapat) düşer.
 *     Seçici pencereler (arama kutusu) `data-dirty-ignore` ile dışarıda kalır.
 * Tutucu yön bilinçli: yanlış "kirli" yalnız bir onay sorar, yanlış "temiz" girdiyi kaybettirir.
 */

const PANE_SELECTOR = "[data-ui-dialog],[data-ui-sheet]";
const TAB_ATTR = "data-tab-id"; // `TabHost` sekme katmanı (portalların hedefi)

const declared = new Map<symbol, string>(); // beyan jetonu → sekme
const typedPanes = new Map<Element, string>(); // yazılmış pencere → sekme
const subscribers = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();
let observer: MutationObserver | null = null;
let listeningDoc: Document | null = null;

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Pencere kalktıysa kaydı düşür; DOM izleyicisi yalnız yazılmış pencere varken açık kalır. */
function syncObserver(): void {
  if (typedPanes.size > 0 && !observer && typeof MutationObserver !== "undefined" && listeningDoc?.body) {
    observer = new MutationObserver(() => recompute());
    observer.observe(listeningDoc.body, { childList: true, subtree: true });
  } else if (typedPanes.size === 0 && observer) {
    observer.disconnect();
    observer = null;
  }
}

function recompute(): void {
  for (const [pane] of typedPanes) {
    if (!pane.isConnected || pane.getAttribute("data-state") === "closed") typedPanes.delete(pane);
  }
  const next = new Set<string>([...declared.values(), ...typedPanes.values()]);
  syncObserver();
  if (sameSet(next, snapshot)) return;
  snapshot = next;
  for (const fn of subscribers) fn();
}

function onFieldInput(e: Event): void {
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (target.closest("[data-dirty-managed],[data-dirty-ignore]")) return;
  const pane = target.closest(PANE_SELECTOR);
  const tabId = pane?.closest(`[${TAB_ATTR}]`)?.getAttribute(TAB_ATTR);
  if (!pane || !tabId || typedPanes.has(pane)) return;
  typedPanes.set(pane, tabId);
  recompute();
}

/** Belge düzeyi yazım dinleyicisini bir kez kurar (idempotent); sekme barındırıcısı bağlanınca çağrılır. */
export function installDirtyTabListener(doc: Document = document): void {
  if (listeningDoc === doc) return;
  listeningDoc = doc;
  doc.addEventListener("input", onFieldInput, true);
  doc.addEventListener("change", onFieldInput, true);
}

/** Şu an kirli sekmelerin kimlikleri (kalkmış pencereler budanmış). */
export function getDirtyTabIds(): ReadonlySet<string> {
  recompute();
  return snapshot;
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Sekme başlığındaki işaret için: bu sekme kirli mi (canlı). */
export function useIsTabDirty(tabId: string): boolean {
  return useSyncExternalStore(subscribe, () => snapshot.has(tabId));
}

/**
 * Bileşen bulunduğu sekmeyi kirli ilan eder (`isDirty` doğruyken). Sekme sistemi dışında (test, global
 * diyalog) etkisizdir; bileşen kalkınca beyan düşer.
 */
export function useDirtyTab(isDirty: boolean): void {
  const tabId = useTabId();
  useEffect(() => {
    if (!isDirty || !tabId) return;
    const token = Symbol("dirty-tab");
    declared.set(token, tabId);
    recompute();
    return () => {
      declared.delete(token);
      recompute();
    };
  }, [isDirty, tabId]);
}

/** Yalnız test: kaydı sıfırlar. */
export function resetDirtyTabsForTest(): void {
  declared.clear();
  typedPanes.clear();
  recompute();
}

