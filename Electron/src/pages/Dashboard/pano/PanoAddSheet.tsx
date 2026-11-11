import { Check, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { IconTile } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";
import type { PanoBoxDef } from "./box-types";
import { GROUP_LABEL, GROUP_ORDER, metaOf } from "./box-meta";
import { hasRenderer } from "./box-render";
import { PreviewSkeleton } from "./PanoBoxFrame";

const SIZE_LABEL: Record<PanoBoxDef["boyut"], string> = { kpi: "Gösterge", kucuk: "Küçük", orta: "Orta", genis: "Geniş" };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  available: PanoBoxDef[];
  added: ReadonlySet<string>;
  onToggle: (key: string, add: boolean) => void;
}

/** Kutu ekleme çekmecesi — gruplara ayrılmış katalog; ekli kutular işaretli, tıklayınca çıkarılır. */
export function PanoAddSheet({ open, onOpenChange, available, added, onToggle }: Props) {
  const drawable = available.filter((b) => hasRenderer(b.anahtar));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-card-border px-5 py-4">
          <SheetTitle>Kutu ekle</SheetTitle>
          <SheetDescription>Panoda görmek istediğin kutuları seç. Yalnız eklediğin kutuların verisi yüklenir.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {GROUP_ORDER.map((g) => {
            const list = drawable.filter((b) => b.grup === g);
            if (list.length === 0) return null;
            return (
              <section key={g} aria-label={GROUP_LABEL[g]}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{GROUP_LABEL[g]}</h3>
                <ul className="space-y-2">
                  {list.map((b) => <BoxOption key={b.anahtar} def={b} on={added.has(b.anahtar)} onToggle={onToggle} />)}
                </ul>
              </section>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BoxOption({ def, on, onToggle }: { def: PanoBoxDef; on: boolean; onToggle: (key: string, add: boolean) => void }) {
  const meta = metaOf(def.anahtar);
  return (
    <li>
      <button type="button" aria-pressed={on} onClick={() => onToggle(def.anahtar, !on)}
        className={cn("flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          on ? "border-primary/50 bg-primary/5" : "border-card-border hover:border-primary/30 hover:bg-muted/40")}>
        <IconTile icon={meta.icon} tone={meta.tone} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{def.baslik}</span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{SIZE_LABEL[def.boyut]}</span>
          </span>
          <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground" title={def.aciklama}>{def.aciklama}</span>
        </span>
        <span className="hidden w-16 shrink-0 rounded-md border border-card-border bg-card p-1.5 sm:block" aria-hidden><PreviewSkeleton kind={meta.preview} /></span>
        <span className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full", on ? "bg-primary text-primary-foreground" : "border border-card-border text-muted-foreground")}>
          {on ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          <span className="sr-only">{on ? "Ekli — çıkar" : "Ekle"}</span>
        </span>
      </button>
    </li>
  );
}
