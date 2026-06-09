import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, Copy, TextCursorInput } from "lucide-react";
import { toast } from "sonner";
import { copyText, getSelectedText } from "@/lib/clipboard";

/**
 * Sağ-tık bağlam menüsü: seçili metinde "Kopyala", editable alanlarda ayrıca
 * "Yapıştır" + "Tümünü Seç".
 *
 * Mevcut Radix sağ-tık menüleriyle (DataTable satır menüsü, sekme/nav orta-tık)
 * ÇAKIŞMAZ: onlar `contextmenu`'yu `preventDefault` ettiği için `e.defaultPrevented`
 * kontrolüyle devre dışı kalırız. Yalnız hiçbir özel menünün işlemediği yerde,
 * VE (bir seçim varsa) VEYA (hedef editable bir alansa) görünür.
 */
type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface MenuState {
  x: number;
  y: number;
  selection: string; // "Kopyala" için
  editable: Editable | null; // "Yapıştır" / "Tümünü Seç" hedefi
}

// Yalnız metin taşıyan input tipleri (checkbox/radio/range/file vb. hariç).
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "password", "email", "number", ""]);

/** Hedef düzenlenebilir bir alansa onu döndürür (salt-okunur/pasif hariç). */
function getEditable(target: EventTarget | null): Editable | null {
  const el = target as HTMLElement | null;
  if (!el) return null;
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement) {
    if (el.readOnly || el.disabled || !TEXT_INPUT_TYPES.has(el.type)) return null;
    return el;
  }
  if (el.isContentEditable) return el.closest<HTMLElement>("[contenteditable]") ?? el;
  return null;
}

function selectAll(el: Editable): void {
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try {
      el.select();
    } catch {
      /* number input vb. select desteklemeyebilir */
    }
    return;
  }
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Metni mevcut seçim/caret konumuna ekler; React kontrollü input'lar için
 *  prototip value setter + 'input' event ile değişikliği yakalatır. */
function pasteInto(el: Editable, text: string): void {
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    try {
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
    } catch {
      /* number input setSelectionRange desteklemez */
    }
    return;
  }
  try {
    document.execCommand("insertText", false, text);
  } catch {
    /* yut */
  }
}

const MENU_W = 170;
const ITEM_H = 34;

export function CopyContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return; // başka bir menü (Radix/nav) işledi
      const selection = getSelectedText(e.target);
      const editable = getEditable(e.target);
      if (!selection.trim() && !editable) return; // ne seçim ne editable → dokunma
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, selection, editable });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.("[data-copy-menu]")) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menu, close]);

  const onCopy = useCallback(async () => {
    if (!menu) return;
    await copyText(menu.selection);
    toast.success("Kopyalandı");
    close();
  }, [menu, close]);

  const onPaste = useCallback(async () => {
    const el = menu?.editable;
    if (!el) return;
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = null;
    }
    if (text == null) {
      toast.error("Pano okunamadı");
    } else if (text) {
      pasteInto(el, text);
    }
    close();
  }, [menu, close]);

  const onSelectAll = useCallback(() => {
    if (menu?.editable) selectAll(menu.editable);
    close();
  }, [menu, close]);

  if (!menu) return null;

  const hasCopy = Boolean(menu.selection.trim());
  const hasEditable = Boolean(menu.editable);
  const itemCount = (hasCopy ? 1 : 0) + (hasEditable ? 2 : 0);

  // Menüyü viewport içinde tut.
  const left = Math.min(menu.x, window.innerWidth - MENU_W - 8);
  const top = Math.min(menu.y, window.innerHeight - (itemCount * ITEM_H + 12) - 8);

  return createPortal(
    <div
      data-copy-menu=""
      className="fixed z-[100] min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {hasCopy && <MenuItem icon={Copy} label="Kopyala" onSelect={onCopy} />}
      {hasEditable && (
        <>
          {hasCopy && <div className="my-1 h-px bg-border" />}
          <MenuItem icon={ClipboardPaste} label="Yapıştır" onSelect={onPaste} />
          <MenuItem icon={TextCursorInput} label="Tümünü Seç" onSelect={onSelectAll} />
        </>
      )}
    </div>,
    document.body,
  );
}

function MenuItem({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: typeof Copy;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      // mousedown'da preventDefault → input odağı/seçimi kaybolmadan işlem yapılır
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </button>
  );
}
