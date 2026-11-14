// Fabrika varsayılanı ve profil matrisinin ORTAK parçaları: arama çubuğu + katlanır grup başlığı.
// Grup ikonu/rengi tek kaynaktan (`groupLook`), grup sırası `groupKinds` → `NOTIFICATION_GROUP_ORDER`.
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { groupLook } from "@/lib/bildirim/format";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  query: string;
  onQuery: (q: string) => void;
  shown: number;
  total: number;
  onFoldAll: (fold: boolean) => void;
  className?: string;
}

export function KindSearchBar({ query, onQuery, shown, total, onFoldAll, className }: SearchBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative flex w-full max-w-xs items-center">
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Bildirim türü ara…"
          aria-label="Bildirim türü ara"
          className="h-8 pl-8 pr-8"
        />
        {query && (
          <button type="button" aria-label="Aramayı temizle" onClick={() => onQuery("")} className="absolute right-1.5 rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {query.trim() ? `${shown} / ${total} tür` : `${total} tür`}
      </span>
      <span className="ml-auto flex gap-1">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onFoldAll(false)}>
          <ChevronsUpDown className="mr-1 h-3.5 w-3.5" /> Tümünü genişlet
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onFoldAll(true)}>
          <ChevronsDownUp className="mr-1 h-3.5 w-3.5" /> Tümünü daralt
        </Button>
      </span>
    </div>
  );
}

interface HeaderProps {
  grup: string;
  count: number;
  summary: string;
  open: boolean;
  onToggle: () => void;
  /** Yoksa (salt okunur) toplu düğmeler çizilmez. */
  onBulk?: (to: "ACIK" | "KAPALI") => void;
  /** Arama varken toplu işlem yalnız görünen türlere uygulanır — düğme metni bunu söyler. */
  filtered: boolean;
  controls: string;
}

export function KindGroupHeader({ grup, count, summary, open, onToggle, onBulk, filtered, controls }: HeaderProps) {
  const look = groupLook(grup);
  const Ikon = look.ikon;
  const what = filtered ? "görünenleri" : "hepsini";
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/60"
      >
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md", look.renk)} aria-hidden>
          <Ikon className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold">{grup}</span>
        <span className="shrink-0 rounded-badge bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{count}</span>
        {summary && <span className="truncate text-xs font-normal text-muted-foreground">{summary}</span>}
      </button>
      {onBulk && (
        <span className="flex shrink-0 gap-0.5">
          <Button variant="ghost" size="sm" className="h-7 px-2" aria-label={`${grup}: ${what} aç`} onClick={() => onBulk("ACIK")}>
            {filtered ? "Görünenleri aç" : "Hepsini aç"}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" aria-label={`${grup}: ${what} kapat`} onClick={() => onBulk("KAPALI")}>
            {filtered ? "Görünenleri kapat" : "Hepsini kapat"}
          </Button>
        </span>
      )}
    </div>
  );
}
