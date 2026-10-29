// Kılavuzlu hücre girişi: needsReview hücresi kırpık + büyük sayısal klavye; kayıt sonrası OTOMATİK sonraki hücre.
// Kuyruk açılışta dondurulur (satır kaydı `needsReview`ı düşürür; canlı kuyruk kendi altından kayardı).
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CellCrop } from "./CellCrop";
import { NumericKeypad } from "./NumericKeypad";
import { buildReviewQueue, cellPatch, fieldRect, parseTrNumber, type CellPatch, type ReviewItem } from "./review-queue";
import type { DeliveryNoteLine } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lines: DeliveryNoteLine[];
  scanId: string | null;
  onSave: (item: ReviewItem, patch: CellPatch) => Promise<unknown>;
}

const FIELD_LABEL = { meters: "Metre", weightKg: "Kilo" } as const;
const toTr = (v: string | null) => (v ? String(Number(v)).replace(".", ",") : "");

export function CellReviewDialog({ open, onOpenChange, lines, scanId, onSave }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- kuyruk açılışta donar (bilinçli)
  const queue = useMemo(() => (open ? buildReviewQueue(lines) : []), [open]);
  const [pos, setPos] = useState(0);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const item = queue[pos] ?? null;
  const line = item ? lines.find((l) => l.id === item.lineId) : undefined;
  useEffect(() => {
    if (open) setPos(0);
  }, [open]);
  useEffect(() => {
    setValue(item && line ? toTr(item.field === "meters" ? line.meters : line.weightKg) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız hücre değişince doldurulur
  }, [item?.lineId, item?.field]);
  const parsed = parseTrNumber(value);
  const submit = async () => {
    if (!item || parsed === null || busy) return;
    setBusy(true);
    try {
      await onSave(item, cellPatch(queue, pos, parsed));
      if (pos + 1 >= queue.length) onOpenChange(false);
      else setPos(pos + 1);
    } catch {
      /* hata toast'u apiClient'ta; hücre yerinde kalır */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hücre gözden geçirme</DialogTitle>
          <DialogDescription>
            {item ? `${pos + 1} / ${queue.length} — Blok ${item.blockNo}, satır ${item.lineNo}: ${FIELD_LABEL[item.field]}` : "Gözden geçirilecek hücre kalmadı."}
          </DialogDescription>
        </DialogHeader>
        {item && line && (
          <div className="flex flex-col gap-3">
            <CellCrop scanId={scanId} rect={fieldRect(line, item.field)} />
            <Input
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              className="h-14 text-center text-3xl tabular-nums"
              aria-label={FIELD_LABEL[item.field]}
              aria-invalid={value !== "" && parsed === null}
            />
            {value !== "" && parsed === null && <p className="text-xs text-destructive">Sıfırdan büyük bir sayı girin (ondalık virgülle).</p>}
            <NumericKeypad value={value} onChange={setValue} onSubmit={() => void submit()} disabled={busy} />
            <Button variant="ghost" size="sm" onClick={() => (pos + 1 >= queue.length ? onOpenChange(false) : setPos(pos + 1))}>
              Bu hücreyi atla
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
