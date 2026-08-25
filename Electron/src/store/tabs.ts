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
  closeOthers: (id: string) => void;
  /** Sekme başlığını güncelle (detay sayfaları entity adını öğrendikten sonra çağırır). */
  updateTabTitle: (id: string, title: string) => void;
}

let counter = 0;
function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tab-${Date.now()}-${counter++}`;
  }
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,

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

      closeTab: (id) => {
        const { tabs, activeId } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx < 0) return;
        const next = tabs.filter((t) => t.id !== id);
        disposeTabRouter(id);
        let nextActive = activeId;
        if (activeId === id) {
          // Komşuya odaklan: önce sağdaki, yoksa soldaki.
          const neighbor = next[idx] ?? next[idx - 1] ?? null;
          nextActive = neighbor?.id ?? null;
        }
        set({ tabs: next, activeId: nextActive });
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

      closeOthers: (id) => {
        const { tabs } = get();
        tabs.forEach((t) => {
          if (t.id !== id) disposeTabRouter(t.id);
        });
        const keep = tabs.find((t) => t.id === id);
        set({ tabs: keep ? [keep] : [], activeId: keep?.id ?? null });
      },
    }),
    {
      name: "teks.tabs",
      // Yalnız sekme listesi + aktif sekme kalıcı; memory router'lar açılışta
      // her sekme için yeniden kurulur (filtreler/scroll yeniden başlamaz).
      partialize: (s) => ({ tabs: s.tabs, activeId: s.activeId }),
    },
  ),
);

/** Aktif sekmenin pathname'i (sidebar/komut paleti aktif vurgusu için). */
export const selectActivePath = (s: TabsState): string | null =>
  s.tabs.find((t) => t.id === s.activeId)?.path ?? null;
