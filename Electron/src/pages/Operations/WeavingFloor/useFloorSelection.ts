// Tezgah Salonu seçim durumu: tık / Ctrl / Shift, lasso, Ctrl+A, Esc, klavye ve dokunmatik seçim kipi.
// Seçim tezgah KİMLİĞİYLE tutulur; tazelemede listeden düşen tezgah sessizce çıkar ve sayılır.
import { useCallback, useEffect, useRef, useState } from "react";
import { useEscapeTarget } from "@/components/ui/escape-stack";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { EMPTY_SELECTION, applyClick, applyMany, neighborOf, pruneSelection, type ArrowKey, type ClickMods, type Selection } from "./selection";
import { useLasso, cardBoxes } from "./useLasso";
import { useLongPress } from "./useLongPress";

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

interface Opts {
  /** Görünen kartlar ekran sırasıyla (Shift aralığı ve Ctrl+A bunu kullanır). */
  order: readonly string[];
  /** Listedeki bütün tezgahlar (süzgeçten bağımsız) — dışarıda kalan seçimden düşer. */
  present: ReadonlySet<string>;
  root: HTMLElement | null;
  /** TV kipinde false: seçim, lasso, klavye ve uzun bas yok. */
  enabled: boolean;
  /** Detay paneli açıkken Esc önce paneli kapatır; seçim Esc'i sonra alır. */
  escBlocked: boolean;
}

interface KeyOpts {
  enabled: boolean;
  root: HTMLElement | null;
  selectAll: () => void;
  toggle: (id: string) => void;
  extendTo: (id: string) => void;
}

function arrowTarget(card: HTMLElement, key: ArrowKey, root: HTMLElement): string | null {
  const r = card.getBoundingClientRect();
  const others = cardBoxes(root).filter((c) => c.id !== card.dataset.loomId);
  return neighborOf({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, key, others);
}

/** Ctrl/Cmd+A görünenleri seçer; kart odaktayken ok gezinir, Shift+ok aralığı büyütür, Boşluk seçer. */
function useSelectionKeys({ enabled, root, selectAll, toggle, extendTo }: KeyOpts) {
  const tabActive = useIsTabActive();
  useEffect(() => {
    if (!enabled || !tabActive || !root) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !root.isConnected) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
        return;
      }
      const card = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-loom-id]");
      if (!card || !root.contains(card)) return;
      if (e.key.startsWith("Arrow")) {
        const next = arrowTarget(card, e.key as ArrowKey, root);
        if (!next) return;
        e.preventDefault();
        root.querySelector<HTMLElement>(`[data-loom-id="${CSS.escape(next)}"]`)?.focus();
        if (e.shiftKey) extendTo(next);
      } else if (e.key === " ") {
        e.preventDefault();
        toggle(card.dataset.loomId!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, tabActive, root, selectAll, toggle, extendTo]);
}

export function useFloorSelection({ order, present, root, enabled, escBlocked }: Opts) {
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const [dropped, setDropped] = useState(0);
  const [touchMode, setTouchMode] = useState(false);
  const orderRef = useRef(order);
  orderRef.current = order;
  const selRef = useRef(sel);
  selRef.current = sel;
  const tabActive = useIsTabActive();

  useEffect(() => {
    const r = pruneSelection(selRef.current, present);
    if (r.dropped === 0) return;
    setSel(r.sel);
    setDropped((d) => d + r.dropped);
  }, [present]);
  useEffect(() => {
    if (sel.ids.size === 0) setTouchMode(false);
  }, [sel]);

  const clear = useCallback(() => {
    setSel(EMPTY_SELECTION);
    setDropped(0);
  }, []);
  const many = useCallback((ids: readonly string[], add: boolean) => setSel((s) => applyMany(s, ids, add)), []);
  const selectAll = useCallback(() => many(orderRef.current, false), [many]);
  const toggle = useCallback((id: string) => setSel((s) => applyClick(s, id, { toggle: true, range: false }, orderRef.current)), []);
  const extendTo = useCallback((id: string) => setSel((s) => applyClick(s, id, { toggle: true, range: true }, orderRef.current)), []);
  const longPress = useLongPress({
    enabled,
    onLongPress: (id) => {
      setTouchMode(true);
      many([id], true);
    },
  });
  const touchRef = useRef(touchMode);
  touchRef.current = touchMode;

  /** Kart tıklaması; `true` = düz tık (çağıran detayı açar). Dokunmatik seçim kipinde tık ekler/çıkarır. */
  const click = useCallback(
    (id: string, mods: ClickMods) => {
      if (longPress.consumeClick()) return false;
      const m = touchRef.current ? { toggle: true, range: false } : mods;
      setSel((s) => applyClick(s, id, m, orderRef.current));
      return !m.toggle && !m.range;
    },
    [longPress],
  );

  useEscapeTarget(enabled && sel.ids.size > 0 && !escBlocked, clear, () => tabActive && !!root?.isConnected);
  useSelectionKeys({ enabled, root, selectAll, toggle, extendTo });
  const lasso = useLasso({ enabled, root, onPick: (picked, add) => (picked ? many(picked, add) : !add && clear()) });

  return { sel, click, many, selectAll, clear, dropped, lasso, longPress, touchMode };
}

export type FloorSelectionState = ReturnType<typeof useFloorSelection>;
