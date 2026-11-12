// Kayıt kalıbı — sağdan YAN PANEL (hızlı bakış). Liste görünür ve tıklanabilir kalır (modal değil);
// Esc / dışarı tık kapatır, ↑/↓ önceki-sonraki kayıt, "Tam sayfa" kayıt sayfasına geçer.
import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEscapeTarget } from "@/components/ui/escape-stack";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { cn } from "@/lib/utils";
import { isOutsidePanel, isTypingTarget } from "./record-nav";

export interface RecordSidePanelProps {
  /** Ekran okuyucu adı ("Cari: ÖRNEK PERDE"). */
  label: string;
  onClose: () => void;
  /** Kimlik bölgesi (avatar + ad + rozetler) — panelin üstü. */
  header: ReactNode;
  /** Önceki/sonraki kayıt (↑/↓); yoksa düğme pasif. */
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  /** Tam kayıt sayfası — verilmezse düğme yok. */
  onOpenFull?: (() => void) | null;
  /** Alt şerit: hızlı eylemler (izni olmayan çizilmez — çağıranın işi). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Klavye + dışarı tık + Esc — yalnız etkin sekmede dinler (arka sekmedeki panel tuş çalmaz). */
function usePanelInputs(p: Pick<RecordSidePanelProps, "onClose" | "onPrev" | "onNext">, active: boolean) {
  const ref = useRef(p);
  ref.current = p;
  useEscapeTarget(true, () => ref.current.onClose(), () => active);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // defaultPrevented: odaktaki liste (DataTable `activeRowId`) tuşu kendisi işledi.
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      if (document.querySelector("[role='dialog'][data-state='open']")) return;
      const go = e.key === "ArrowDown" ? ref.current.onNext : ref.current.onPrev;
      if (!go) return;
      e.preventDefault();
      go();
    };
    const onDown = (e: PointerEvent) => {
      // Yalnız birincil tuş (sağ tık bağlam menüsü paneli kapatmasın).
      if (!(e.button > 0) && isOutsidePanel(e.target)) ref.current.onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [active]);
}

export function RecordSidePanel({ label, onClose, header, onPrev, onNext, onOpenFull, footer, children, className }: RecordSidePanelProps) {
  const active = useIsTabActive();
  usePanelInputs({ onClose, onPrev, onNext }, active);
  return (
    <aside
      data-record-side-panel=""
      aria-label={label}
      className={cn(
        // Genişte listenin yanına yapışık tam boy bölme (tam genişlik liste ile aynı yüzey); darda üste binen çekmece gölgelidir.
        "record-side-panel flex h-full w-[min(32rem,calc(100vw-2rem))] shrink-0 flex-col overflow-hidden border-l border-card-border bg-card text-card-foreground max-[1180px]:shadow-card",
        className,
      )}
    >
      <div className="flex items-start gap-3 border-b border-border/70 px-[var(--space-card)] pb-4 pt-[var(--space-card)]">
        <div className="min-w-0 flex-1">{header}</div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onPrev ?? undefined} disabled={!onPrev} aria-label="Önceki kayıt" title="Önceki kayıt (↑)">
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNext ?? undefined} disabled={!onNext} aria-label="Sonraki kayıt" title="Sonraki kayıt (↓)">
            <ChevronDown className="h-4 w-4" />
          </Button>
          {onOpenFull && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenFull} aria-label="Tam sayfa aç" title="Tam sayfa aç">
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Kapat" title="Kapat (Esc)">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-[var(--space-gap)] overflow-y-auto px-[var(--space-card)] py-4">{children}</div>
      {footer && <div className="border-t border-border/70 px-[var(--space-card)] py-3">{footer}</div>}
    </aside>
  );
}

/** Liste + panel yerleşimi: genişte yan yana tam alanı kaplar (liste daralır), darda panel listenin ÜSTÜNE biner. */
export function RecordSplit({ list, panel }: { list: ReactNode; panel: ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-1 border-t border-card-border">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{list}</div>
      {panel && <div className="flex min-h-0 max-[1180px]:absolute max-[1180px]:inset-y-0 max-[1180px]:right-0 max-[1180px]:z-30">{panel}</div>}
    </div>
  );
}
