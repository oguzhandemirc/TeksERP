import { useState } from "react";
import { ChevronsUpDown, Tags } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PropertyChipsField } from "./PropertyChipsField";

interface Props {
  /** Seçili Item ID — boşsa tetik pasif ("önce ürün seç"). */
  itemId: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * Modal çoklu özellik seçici — tetik buton (seçili sayısını gösterir) → modal
 * içinde [[PropertyChipsField]] (ürünün izinli özellikleri, tıkla-seç). Renk
 * seçici (ColorPickerModal) ile AYNI tetik görsel dili → yan yana tutarlı durur.
 */
export function PropertyPickerModal({ itemId, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const hasItem = Boolean(itemId);
  const triggerText = !hasItem
    ? "Önce ürün seç"
    : value.length > 0
      ? `${value.length} özellik seçili`
      : "Özellik seç...";

  return (
    <>
      <button
        type="button"
        disabled={disabled || !hasItem}
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <Tags className="h-4 w-4 shrink-0 text-primary" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            value.length === 0 && "text-xs text-muted-foreground",
          )}
        >
          {triggerText}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Özellikler</DialogTitle>
            <DialogDescription>
              Topun fiilen sahip olduğu özellikleri seç — tıklayarak ekle/çıkar.
            </DialogDescription>
          </DialogHeader>
          <PropertyChipsField itemId={itemId} value={value} onChange={onChange} allowQuickAdd />
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)}>
              Tamam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
