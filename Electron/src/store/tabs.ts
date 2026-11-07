import { create } from "zustand";
import { persist } from "zustand/middleware";
import { resolveTabMeta, tabPathname } from "@/components/layout/tabs/tab-meta";
import {
  getTabRouter,
  navigateTabRouter,
  goBackTabRouter,
  disposeTabRouter,
} from "@/components/layout/tabs/tab-routers";
import { recallRoute } from "@/components/layout/tabs/route-memory";
import { idsToClose, nextActiveAfterClose, type CloseScope } from "@/components/layout/tabs/tab-close";
import { TABS_STORAGE_KEY, purgeTabsOnFreshLaunch, tabsStorage } from "./tabs-storage";

export interface TabItem {
  /** Kararlı kimlik — router registry + React key. */
  id: string;
  /** Pathname (sorgusuz) — dedup, başlık ve sidebar aktif-eşleşme için. */
  path: string;
  title: string;
}

interface OpenOpts {
  /** location.state olarak taşınacak veri (seed akışları). */
  state?: unknown;
  /** Aynı yol açık olsa bile ikinci bir sekme aç (shift/sağ tık). */
  forceNew?: boolean;
  /** Odaklanmadan arka planda aç. */
  background?: boolean;
}

interface TabsState {
  tabs: TabItem[];
  activeId: string | null;
  /** Yeni/var olan sekmede aç (forceNew ile her zaman yeni). */
  openTab: (path: string, opts?: OpenOpts) => void;
  /** Aktif sekmeyi yerinde başka sayfaya taşı (varsayılan tık davranışı). */
  navigateActive: (path: string, opts?: { state?: unknown }) => void;
  /** Aktif sekmede bir adım geri (sekmenin kendi geçmişi) — Alt+← / fare geri tuşu. */
  backActive: () => void;
  /**
   * Sekmenin router'ı KENDİ İÇİNDE gezindiyse (geri oku, breadcrumb, sayfa içi
   * `navigate()`) defteri eşitle. Store'dan geçmeyen gezinmeler eskiden sekme
   * başlığını ve kenar menüsü eşleşmesini BAYAT bırakıyordu.
   */
  syncTabLocation: (id: string, pathname: string) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  /** Aktif sekmeden delta kadar ileri/geri (sarmalı) geç. */
  cycle: (delta: number) => void;
  /** N. sekmeye geç (0 tabanlı, sınır dışıysa yok sayılır). */
  selectIndex: (index: number) => void;
  reorder: (fromId: string, toId: string) => void;
  /** Toplu kapatma (sağ tık menüsü / "Tümünü kapat"): çapaya göre kapsam; "all" çapasızdır. */
  closeTabs: (scope: CloseScope, anchorId?: string | null) => void;
  /** Son TOPLU kapatmadan (≥2 sekme) önceki liste; "Geri al" bununla döner. Kalıcı değil, çıkışta silinir. */
  lastBulkClose: { tabs: TabItem[]; activeId: string | null; closedIds: string[] } | null;
  /** Son toplu kapatmayı geri al: kapananlar eski yerine, sonradan açılanlar sona; etkin sekme eskisi. */
  undoBulkClose: () => void;
  /** Sekme başlığını güncelle (detay sayfaları entity adını öğrendikten sonra çağırır). */
  updateTabTitle: (id: string, title: string) => void;
  /**
   * TÜM sekmeleri kapat — oturum sınırında çağrılır (`bindTabsToSession`).
   *
   * Temizlenmezse bir sonraki kullanıcı öncekinin sekmelerini (başlıklarındaki
   * müşteri/sipariş adlarıyla) hazır bulurdu. `set` ile boşaltmak kalıcı kopyayı da günceller.
   */
  resetTabs: () => void;
}

let counter = 0;
function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tab-${Date.now()}-${counter++}`;
  }
}

// Yeni açılış (reload değil) önceki sekmeleri getirmez — store kurulmadan, hidrasyondan önce.
purgeTabsOnFreshLaunch();

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,

      resetTabs: () => set({ tabs: [], activeId: null, lastBulkClose: null }),
      lastBulkClose: null,

      openTab: (rawPath, opts = {}) => {
        const { state, forceNew, background } = opts;
        const pathname = tabPathname(rawPath);
        // Sorgusuz bir yol isteniyorsa o sayfanın SON görünümünü (filtre/sıralama)
        // geri getir. Çağıran açıkça sorgu gönderdiyse (panodan gelen daraltılmış
        // bağlantı) onun niyeti kazanır — hafıza ezilmez, ezmez.
        const wanted = rawPath === pathname && state === undefined
          ? (recallRoute(pathname) ?? rawPath)
          : rawPath;
        const { tabs, activeId } = get();

        if (!forceNew) {
          const existing = tabs.find((t) => t.path === pathname);
          if (existing) {
            // Aynı sayfa açık → odakla; farklı sorgu/state geldiyse o sekmeyi taşı.
            // Sorgusuz istekte sekme YERİNDE bırakılır: zaten açık olan görünümü
            // (kullanıcının kurduğu filtreyi) sıfırlamak istenmez.
            if (rawPath !== pathname || state !== undefined) {
              navigateTabRouter(existing.id, rawPath, state);
            }
            if (!background) set({ activeId: existing.id });
            return;
          }
        }

        const id = newId();
        const { title } = resolveTabMeta(pathname);
        getTabRouter(id, wanted, state); // router'ı şimdi kur (arka plan dahil hazır)
        set({
          tabs: [...tabs, { id, path: pathname, title }],
          activeId: background ? activeId : id,
        });
      },

      navigateActive: (rawPath, opts = {}) => {
        const { state } = opts;
        const pathname = tabPathname(rawPath);
        const { tabs, activeId } = get();
        const active = tabs.find((t) => t.id === activeId);

        // Aktif sekme yoksa (hepsi kapalı) yeni bir sekme aç.
        if (!active) {
          get().openTab(rawPath, { state });
          return;
        }

        // Zaten bu sayfadaysak (sorgu/state yok) hiçbir şey yapma — filtreleri sıfırlama.
        if (active.path === pathname && rawPath === pathname && state === undefined) return;

        const wanted = rawPath === pathname && state === undefined
          ? (recallRoute(pathname) ?? rawPath)
          : rawPath;
        navigateTabRouter(active.id, wanted, state);
        const { title } = resolveTabMeta(pathname);
        set({
          tabs: tabs.map((t) => (t.id === active.id ? { ...t, path: pathname, title } : t)),
        });
      },

      backActive: () => {
        const { activeId } = get();
        if (activeId) goBackTabRouter(activeId);
      },

      syncTabLocation: (id, rawPathname) => {
        const pathname = tabPathname(rawPathname);
        const { tabs } = get();
        const tab = tabs.find((t) => t.id === id);
        // Yol değişmediyse dokunma: sayfaların `updateTabTitle` ile yazdığı özel
        // başlık (ör. "Sevkiyat · SVK…") her router olayında silinmesin.
        if (!tab || tab.path === pathname) return;
        const { title } = resolveTabMeta(pathname);
        set({ tabs: tabs.map((t) => (t.id === id ? { ...t, path: pathname, title } : t)) });
      },

      closeTab: (id) => get().closeTabs("self", id),

      closeTabs: (scope, anchorId = null) => {
        const { tabs, activeId } = get();
        const closed = new Set(idsToClose(tabs, anchorId, scope));
        if (closed.size === 0) return;
        closed.forEach((id) => disposeTabRouter(id));
        set({
          tabs: tabs.filter((t) => !closed.has(t.id)),
          activeId: nextActiveAfterClose(tabs, activeId, closed),
          // Tekli kapatma geri alma anlık görüntüsünü EZMEZ (toplu kapatmanın hemen ardından X'e basmak "Geri al"ı yemesin).
          ...(closed.size >= 2 ? { lastBulkClose: { tabs, activeId, closedIds: [...closed] } } : {}),
        });
      },

      undoBulkClose: () => {
        const { tabs, lastBulkClose } = get();
        if (!lastBulkClose) return;
        const openIds = new Set(tabs.map((t) => t.id));
        const bulkClosed = new Set(lastBulkClose.closedIds);
        const snapIds = new Set(lastBulkClose.tabs.map((t) => t.id));
        // Toplu kapananlar eski sırasına döner; o arada ELLE kapatılan sekme diriltilmez, yeni açılanlar sona.
        // Router'lar `getTabRouter` ile yoldan yeniden kurulur.
        const restored = lastBulkClose.tabs.filter((t) => openIds.has(t.id) || bulkClosed.has(t.id));
        const next = [...restored, ...tabs.filter((t) => !snapIds.has(t.id))];
        const prevActive = lastBulkClose.activeId;
        set({
          tabs: next,
          activeId: prevActive && next.some((t) => t.id === prevActive) ? prevActive : get().activeId,
          lastBulkClose: null,
        });
      },

      setActive: (id) => set({ activeId: id }),

      cycle: (delta) => {
        const { tabs, activeId } = get();
        if (tabs.length === 0) return;
        const cur = tabs.findIndex((t) => t.id === activeId);
        const start = cur < 0 ? 0 : cur;
        const nextIdx = (start + delta + tabs.length) % tabs.length;
        set({ activeId: tabs[nextIdx]!.id });
      },

      selectIndex: (index) => {
        const { tabs } = get();
        const tab = tabs[index];
        if (tab) set({ activeId: tab.id });
      },

      reorder: (fromId, toId) => {
        const { tabs } = get();
        const from = tabs.findIndex((t) => t.id === fromId);
        const to = tabs.findIndex((t) => t.id === toId);
        if (from < 0 || to < 0 || from === to) return;
        const next = [...tabs];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved!);
        set({ tabs: next });
      },

      updateTabTitle: (id, title) => {
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) }));
      },
    }),
    {
      name: TABS_STORAGE_KEY,
      // Yalnız pencere ömrü (F5'te korunur); yeni oturum/açılış her zaman Anasayfa'dan başlar.
      storage: tabsStorage,
      // Yalnız sekme listesi + aktif sekme; memory router'lar yeniden kurulur.
      partialize: (s) => ({ tabs: s.tabs, activeId: s.activeId }),
    },
  ),
);

interface SessionSnapshot {
  user: { userId: string } | null;
  isHydrated: boolean;
}

/**
 * OTURUM SINIRI = SEKME SIFIRI: kimlik değişince (çıkış, 401/oturum düşmesi, yeni giriş)
 * defter boşalır; kabuk boş defterle bağlanınca tek sekme Anasayfa açılır. Açılıştaki
 * hidrasyon (`isHydrated` henüz false) sınır değildir — F5 sekmeleri korur.
 * Auth store parametre: tabs → auth statik bağı kurulmaz (testler auth'u mocklar).
 */
export function bindTabsToSession<S extends SessionSnapshot>(auth: {
  subscribe: (listener: (state: S, prev: S) => void) => () => void;
}): () => void {
  return auth.subscribe((state, prev) => {
    if (!prev.isHydrated || state.user === prev.user) return;
    if (state.user && prev.user && state.user.userId === prev.user.userId) return;
    useTabsStore.getState().resetTabs();
  });
}

/** Aktif sekmenin pathname'i (sidebar/komut paleti aktif vurgusu için). */
export const selectActivePath = (s: TabsState): string | null =>
  s.tabs.find((t) => t.id === s.activeId)?.path ?? null;
