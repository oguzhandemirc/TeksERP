import { useCallback, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// =============================================================================
// GENİŞLEYEN SATIR — ortak DataTable yeteneği
// =============================================================================
// Satırın altında tam genişlik ayrıntı hücresi. Açık küme satır KİMLİĞİYLE tutulur: sıralama,
// sütun gizleme ve veri tazelemesi açık durumu bozmaz. Denetimli (`expandedIds` + `onExpandedChange`)
// ya da denetimsiz (tablo içi durum). `renderSubRow` düğmesiz, HER ZAMAN açık alt satırdır (ör. hata ipucu).
// =============================================================================

export interface RowExpandProps<T> {
  /** Ayrıntı gövdesi — verilirse başa aç/kapa düğmeli sütun eklenir. */
  renderExpanded?: (row: T) => ReactNode;
  /** Satır açılabilir mi (verilmezse hepsi). Açılamayan satırda düğme çizilmez. */
  canExpand?: (row: T) => boolean;
  /** Denetimli açık küme (satır kimlikleri). Verilmezse tablo kendi tutar. */
  expandedIds?: ReadonlySet<string>;
  onExpandedChange?: (ids: Set<string>) => void;
  /** Düğmesiz, her zaman açık alt satır; `null` → yok. Satırın `rowClassName`ini paylaşır, tıklaması satırı açar. */
  renderSubRow?: (row: T) => ReactNode;
}

/** Açık küme — denetimliyse dışarıdaki, değilse iç durum. `toggle(id, open?)` KARARLI referans (memo'lu satırlar
 *  yalnız açık durumu değişince yeniden çizilsin); güncel küme ref'ten okunur. */
export function useRowExpansion(expandedIds?: ReadonlySet<string>, onExpandedChange?: (ids: Set<string>) => void) {
  const [inner, setInner] = useState<ReadonlySet<string>>(() => new Set());
  const current = expandedIds ?? inner;
  const live = useRef({ current, controlled: Boolean(expandedIds), onExpandedChange });
  live.current = { current, controlled: Boolean(expandedIds), onExpandedChange };
  const toggle = useCallback((id: string, open?: boolean) => {
    const { current: base, controlled, onExpandedChange: notify } = live.current;
    const want = open ?? !base.has(id);
    if (want === base.has(id)) return;
    const next = new Set(base);
    if (want) next.add(id);
    else next.delete(id);
    live.current = { ...live.current, current: next };
    notify?.(next);
    if (!controlled) setInner(next);
  }, []);
  return { expanded: current, toggle };
}

/** Başlıktaki boş aç/kapa sütunu. */
export function ExpandHeadCell() {
  return <TableHead className="w-8 px-1" aria-label="Ayrıntı" />;
}

/** Satır başındaki aç/kapa düğmesi (`aria-expanded`); açılamayan satırda boş hücre. */
export function ExpandToggleCell({ can, open, onToggle, controls }: { can: boolean; open: boolean; onToggle: () => void; controls: string }) {
  return (
    <TableCell className="w-8 px-1">
      {can ? (
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-expanded={open}
          aria-controls={open ? controls : undefined}
          aria-label={open ? "Ayrıntıyı kapat" : "Ayrıntıyı aç"}
          title={open ? "Ayrıntıyı kapat (←)" : "Ayrıntıyı aç (→)"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
        </button>
      ) : null}
    </TableCell>
  );
}

/** Tam genişlik ayrıntı / alt satır. Ayrıntı satırı satır seçimi ve tıklamasından bağımsızdır. */
export function ExpandedRow({ id, colSpan, className, onClick, children }: { id?: string; colSpan: number; className?: string; onClick?: () => void; children: ReactNode }) {
  return (
    <TableRow id={id} data-expanded-row="" className={cn("hover:bg-transparent", onClick && "cursor-pointer", className)} onClick={onClick}>
      <TableCell colSpan={colSpan} className="whitespace-normal p-0">
        {children}
      </TableCell>
    </TableRow>
  );
}

/** Odaklı satırda →/← aç/kapa (Enter/Space satır açılışına ait kalır). İşlediyse true. */
export function expandKey(key: string, can: boolean, open: boolean, toggle: (open: boolean) => void): boolean {
  if (!can) return false;
  if (key === "ArrowRight" && !open) toggle(true);
  else if (key === "ArrowLeft" && open) toggle(false);
  else return false;
  return true;
}
