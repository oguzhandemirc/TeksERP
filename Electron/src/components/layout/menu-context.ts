import { create } from "zustand";

// MENÜ BAĞLAMI (2026-11-23): aynı ekran birden çok menü kökünde durabilir (Fasondaki İplik: Depo + Üretim).
// Etkin satır yalnız adresten türetilirse ilk eşleşen kazanır ve menü kullanıcının tıkladığı yerden kaçar.
// Bu yüzden tıklanan konum (sahip + yol) sekmeye bağlanır; çözüm: tık bağlamı → sekmenin bağlamı → kanonik.

/** Menüde tıklanabilir bir konum: `owner` bölüm kökünün yolu (alt öğe) ya da `grup:<ad>` (üst satır). */
export interface MenuPlacement {
  owner: string;
  to: string;
}

/** Sekmeye bağlanan bağlam — `ownerLabel` kırıntıda (Üretim › …) kullanılır. */
export interface MenuContext extends MenuPlacement {
  ownerLabel?: string;
}

export const groupOwner = (label: string) => `grup:${label}`;

const STORE_KEY = "tekserp.nav.tabMenuContext";

const bare = (to: string) => to.split(/[?#]/)[0] ?? to;

/** Yol konumun ekranı mı (tam ya da alt sayfa `/x/:id`); `/` yalnız tam eşleşir. Konumun sorgusu yok sayılır. */
export function pathMatches(path: string, to: string): boolean {
  const t = bare(to);
  return path === t || (t !== "/" && path.startsWith(`${t}/`));
}

const samePlacement = (a: MenuPlacement, b: MenuPlacement) => a.owner === b.owner && a.to === b.to;

/** En özgül (en uzun) konum; eşitlikte `prefer`e uyan, o da yoksa menü sırasında ilk gelen. */
function pickLongest(list: MenuPlacement[], prefer: (p: MenuPlacement) => boolean): MenuPlacement | null {
  let best: MenuPlacement | null = null;
  for (const p of list) {
    if (!best) {
      best = p;
      continue;
    }
    const d = bare(p.to).length - bare(best.to).length;
    if (d > 0 || (d === 0 && prefer(p) && !prefer(best))) best = p;
  }
  return best;
}

/**
 * Etkin menü konumu (saf). `placements` menü sırasıyla (kanonik öncelik ilk gelenin); `ctx` sekmenin bağlamı.
 *  - Bağlam hâlâ adresle eşleşiyorsa: aynı sahipte (ya da tıklanan kökün altında) en özgül konum — Raporlar'dan
 *    açılan rapor Üretim'e kaçmaz; iş emri listesinden "Yeni"ye geçince aynı kökte kalınır.
 *  - Eşleşmiyorsa (sayfa içi gezinme): en özgül konumlar arasında bağlamın sahibine/köküne yakın olan.
 *  - Bağlam yoksa: en özgül konum, eşitlikte menü sırası.
 */
export function resolveMenuPlacement(
  placements: readonly MenuPlacement[],
  path: string | null | undefined,
  ctx: MenuPlacement | null | undefined,
): MenuPlacement | null {
  if (!path) return null;
  const hits = placements.filter((p) => pathMatches(path, p.to));
  if (hits.length === 0) return null;
  if (!ctx) return pickLongest(hits, () => false);
  const near = (p: MenuPlacement) => p.owner === ctx.owner || p.owner === ctx.to;
  if (hits.some((p) => samePlacement(p, ctx))) {
    return pickLongest(hits.filter(near), (p) => samePlacement(p, ctx));
  }
  return pickLongest(hits, near);
}

function isContext(v: unknown): v is MenuContext {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.owner === "string" && typeof o.to === "string" && (o.ownerLabel === undefined || typeof o.ownerLabel === "string");
}

function load(): Record<string, MenuContext> {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, MenuContext] => isContext(e[1])));
  } catch {
    return {};
  }
}

function save(byTab: Record<string, MenuContext>) {
  try {
    globalThis.sessionStorage?.setItem(STORE_KEY, JSON.stringify(byTab));
  } catch {
    /* depolama yoksa yalnız bellekte; F5'te kanonik konuma düşer */
  }
}

interface MenuContextState {
  /** Sekme kimliği → bağlam (F5'te sessionStorage'dan döner). */
  byTab: Record<string, MenuContext>;
  /** Son menü tıkı — gezinme aynı olayda olur; menü bunu bağlamadan önce de okur (titreme olmasın). */
  pending: MenuContext | null;
}

export const useMenuContextStore = create<MenuContextState>(() => ({ byTab: load(), pending: null }));

/** Menü satırı tıklandı (gezinme kararı `useTabTarget`te). */
export function recordMenuClick(ctx: MenuContext): void {
  useMenuContextStore.setState({ pending: ctx });
}

/**
 * Bekleyen tıkı etkin sekmeye bağla: sekmenin yolu tıklanan konumla eşleşiyorsa yazılır, değilse (gezinme
 * olmadı / arka plan sekmesi) düşer. `liveTabIds` verilirse kapanmış sekmelerin kaydı budanır.
 */
export function bindPendingMenuClick(activeId: string | null, activePath: string | null, liveTabIds?: readonly string[]): void {
  const { pending, byTab } = useMenuContextStore.getState();
  if (!pending) return;
  if (!activeId || !activePath || !pathMatches(activePath, pending.to)) {
    useMenuContextStore.setState({ pending: null });
    return;
  }
  const live = liveTabIds && liveTabIds.length > 0 ? new Set(liveTabIds) : null;
  const next: Record<string, MenuContext> = {};
  for (const [id, c] of Object.entries(byTab)) if (!live || live.has(id)) next[id] = c;
  next[activeId] = pending;
  save(next);
  useMenuContextStore.setState({ byTab: next, pending: null });
}

/** Sekmenin bağlı bağlamı (yoksa null). */
export function useTabMenuContext(tabId: string | null | undefined): MenuContext | null {
  return useMenuContextStore((s) => (tabId ? (s.byTab[tabId] ?? null) : null));
}

/** Kırıntı üstü: sekme bu ekrana bir bölüm kökünün altından açıldıysa o kök (üst satır tıkı ve kökün kendisi değil). */
export function menuBreadcrumbParent(ctx: MenuContext | null, pathname: string): { label: string; to: string } | null {
  if (!ctx?.ownerLabel || !ctx.owner.startsWith("/") || ctx.owner === pathname) return null;
  return bare(ctx.to) === pathname ? { label: ctx.ownerLabel, to: ctx.owner } : null;
}

/** Menünün çözümde kullanacağı bağlam: aynı olaydaki tık (henüz bağlanmamış) önce, sonra sekmenin kaydı. */
export function effectiveMenuContext(
  state: MenuContextState,
  activeId: string | null,
  activePath: string | null,
): MenuContext | null {
  if (state.pending && activePath && pathMatches(activePath, state.pending.to)) return state.pending;
  return activeId ? (state.byTab[activeId] ?? null) : null;
}
