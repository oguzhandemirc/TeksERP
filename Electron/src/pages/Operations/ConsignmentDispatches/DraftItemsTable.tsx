// Taslak kalemleri + sunucu önizlemesi: her satırın yanında önizlemenin engel nedeni (yazmadan ölçülür).
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { blockedReasonText, fmtQty, KIND_LABEL } from "./consignmentText";
import { previewLineFor, type DraftItem } from "./draft";
import type { ConsignmentDispatchPreview } from "./types";

interface Props {
  items: DraftItem[];
  preview: ConsignmentDispatchPreview | undefined;
  onRemove: (key: string) => void;
}

export function DraftItemsTable({ items, preview, onRemove }: Props) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        Henüz kalem yok — levent ya da iplik lotu ekleyin.
      </p>
    );
  }
  return (
    <div className="max-h-[40vh] overflow-auto border-y">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2 text-left">Tür</th>
            <th className="p-2 text-left">Kalem</th>
            <th className="p-2 text-right">Miktar</th>
            <th className="p-2 text-left">Durum</th>
            <th className="p-2" aria-label="Çıkar" />
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const line = previewLineFor(preview, items, it.key);
            const reason = blockedReasonText(line?.blockedReason);
            return (
              <tr key={it.key} className="border-t" data-testid={`draft-row-${it.key}`}>
                <td className="p-2">{KIND_LABEL[it.input.kind]}</td>
                <td className="p-2">
                  <div className="font-medium">{it.label}</div>
                  <div className="text-xs text-muted-foreground">{it.sub}</div>
                </td>
                <td className="p-2 text-right tabular-nums">{line ? fmtQty(line.qty, line.unit) : "…"}</td>
                <td className="p-2 text-xs">
                  {!line ? (
                    <span className="text-muted-foreground">Ölçülüyor…</span>
                  ) : reason ? (
                    <span className="text-destructive">{reason}</span>
                  ) : (
                    <span className="text-emerald-700 dark:text-emerald-400">Uygun</span>
                  )}
                </td>
                <td className="p-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`${it.label} kalemini çıkar`}
                    onClick={() => onRemove(it.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
