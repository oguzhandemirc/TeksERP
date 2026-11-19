// × yanındaki "Bölümleri göster/gizle" menüsü: tıklama/dokunma ile açılır (tablette hover yok), klavyeyle gezilir,
// Esc kapatır. Kilitli satır (zorunlu/hatalı) devre dışı onay kutusu + ⓘ gerekçe.
import { useId, useState } from "react";
import { Lock, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { cn } from "@/lib/utils";
import { isSectionHidden } from "./section-visibility";
import type { SectionEntry } from "./ModalSections";

interface Props {
  entries: readonly SectionEntry[];
  hidden: readonly string[];
  onToggle: (id: string, hidden: boolean) => void;
  onReset: () => void;
}

export function ModalSectionsMenu({ entries, hidden, onToggle, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const hiddenCount = entries.filter((e) => isSectionHidden(hidden, e.id, e.required || e.hasError)).length;
  const label = hiddenCount > 0 ? `Bölümleri göster/gizle (${hiddenCount} gizli)` : "Bölümleri göster/gizle";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          data-testid="modal-sections-trigger"
          className={cn(
            "relative inline-flex h-6 w-6 items-center justify-center rounded-md opacity-70 transition-opacity hover:bg-muted hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:opacity-100",
            hiddenCount > 0 && "text-primary opacity-100",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {hiddenCount > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
              {hiddenCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        aria-label="Bölümleri göster/gizle"
        // İlk odak ilk AÇILABİLİR onay kutusuna: varsayılan ilk odaklanabilir öğe kilitli satırın ⓘ'si olur ve balonu açardı.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("button[role='checkbox']:not([disabled])")?.focus();
        }}
      >
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Bu formda görünen bölümler</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Seçimin yalnız senin için ve her bilgisayarda saklanır.</p>
        </div>
        <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto p-2" data-testid="modal-sections-list">
          {entries.map((e) => {
            const locked = e.required || e.hasError;
            const visible = !isSectionHidden(hidden, e.id, locked);
            const cbId = `${baseId}-${e.id}`;
            return (
              <li key={e.id} className={cn("flex min-h-10 items-center gap-3 rounded-md px-2", !locked && "hover:bg-muted/60")}>
                <Checkbox
                  id={cbId}
                  checked={visible}
                  disabled={locked}
                  onCheckedChange={(c) => onToggle(e.id, c !== true)}
                  data-testid={`modal-section-toggle-${e.id}`}
                />
                <label htmlFor={cbId} className={cn("min-w-0 flex-1 truncate py-2 text-sm", locked ? "text-muted-foreground" : "cursor-pointer")}>
                  {e.title}
                </label>
                {locked ? (
                  <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" aria-hidden />
                    <InfoPopover
                      label={`${e.title}: neden gizlenemez`}
                      desc={e.required ? "Zorunlu alan içerir; bu bölüm gizlenemez." : "Bu bölümde düzeltilmesi gereken bir alan var; düzeltilene kadar görünür kalır."}
                    />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end border-t px-3 py-2">
          <Button type="button" variant="ghost" size="sm" disabled={hiddenCount === 0 && hidden.length === 0} onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" /> Varsayılana dön
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
