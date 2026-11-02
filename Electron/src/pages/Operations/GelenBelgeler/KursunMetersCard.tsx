// "Kurşun metresi" kartı (PER_DOCUMENT): değer + kaynak, diğer kaynaklar ve giriş metresi bilgi; gözden geçirme açıksa
// kılavuzlu giriş (alan kırpığı + sayısal klavye). Değer ve kaynak sunucudan (A); panel öncelik kuralı kurmaz.
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CellCrop } from "./CellCrop";
import { NumericKeypad } from "./NumericKeypad";
import { parseTrNumber } from "./review-queue";
import { fmtMeters, KURSUN_SOURCE_LABEL, meterValue, sourceCandidate } from "./partiMetre";
import type { DeliveryNoteDetail, HeaderPatch } from "./types";

interface Props {
  note: DeliveryNoteDetail;
  editable: boolean;
  onPatch: (p: HeaderPatch) => Promise<unknown>;
}

const toTr = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

function OtherSources({ note }: { note: DeliveryNoteDetail }) {
  const c = note.kursunMeterCandidates;
  if (!c) return null;
  const rows: Array<[string, number | null]> = [
    ["Çıkış metresi", meterValue(c.output)],
    ["Toplam metre", meterValue(c.total)],
    ["Satır toplamı", meterValue(c.lineSum)],
    ["Giriş metresi (yalnız bilgi)", meterValue(c.input)],
  ];
  const shown = rows.filter(([, v]) => v !== null);
  if (shown.length === 0) return null;
  return (
    <ul className="text-xs text-muted-foreground" data-testid="kursun-sources">
      {shown.map(([k, v]) => <li key={k}>{k}: {fmtMeters(v)}</li>)}
    </ul>
  );
}

function ReviewDialog({ note, open, onOpenChange, onPatch }: Props & { open: boolean; onOpenChange: (o: boolean) => void }) {
  const current = meterValue(note.kursunMeters ?? null);
  const [value, setValue] = useState(toTr(current));
  const [busy, setBusy] = useState(false);
  const src = sourceCandidate(note.kursunMetersSource, note.kursunMeterCandidates);
  const parsed = parseTrNumber(value);
  const submit = async () => {
    if (parsed === null || busy) return;
    setBusy(true);
    try {
      // Aynı değer = okunanı onayla (kaynak korunur); farklı değer = elle (kaynak MANUAL) — ikisi de review'ı düşürür.
      await onPatch(parsed === current ? { kursunMetersReviewed: true } : { kursunMeters: parsed });
      onOpenChange(false);
    } catch {
      /* hata toast'u apiClient'ta; diyalog açık kalır */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kurşun metresi</DialogTitle>
          <DialogDescription>Belgedeki değerle karşılaştırın; doğruysa onaylayın, değilse düzeltin.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <CellCrop scanId={src?.scanId ?? null} rect={src?.rect ?? null} />
          <Input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} className="h-14 text-center text-3xl tabular-nums" aria-label="Kurşun metresi" aria-invalid={value !== "" && parsed === null} />
          {value !== "" && parsed === null && <p className="text-xs text-destructive">Sıfırdan büyük bir sayı girin (ondalık virgülle).</p>}
          <NumericKeypad value={value} onChange={setValue} onSubmit={() => void submit()} disabled={busy} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function KursunMetersCard({ note, editable, onPatch }: Props) {
  const [open, setOpen] = useState(false);
  const m = meterValue(note.kursunMeters ?? null);
  const review = note.kursunMetersReview === true;
  return (
    <div className={`flex flex-col gap-2 rounded-lg border p-3 ${review ? "border-amber-500" : ""}`} data-testid="kursun-meters-card" data-review={review ? "1" : "0"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Kurşun metresi</p>
        <span className="flex items-center gap-2">
          <span className="text-lg font-semibold tabular-nums" data-testid="kursun-meters-value">{m === null ? "—" : fmtMeters(m)}</span>
          {note.kursunMetersSource && <Badge variant="muted" data-testid="kursun-meters-source">{KURSUN_SOURCE_LABEL[note.kursunMetersSource]}</Badge>}
        </span>
      </div>
      {review && <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="kursun-meters-review">Gözden geçirilecek — el yazısı ya da kaynaklar çelişiyor.</p>}
      {m === null && <p className="text-xs text-destructive">Metre okunamadı — onaydan önce girin.</p>}
      <OtherSources note={note} />
      {editable && (
        <Button type="button" variant={review || m === null ? "default" : "outline"} size="sm" className="self-start" onClick={() => setOpen(true)} data-testid="kursun-meters-edit">
          {review ? "Gözden geçir" : m === null ? "Metre gir" : "Düzelt"}
        </Button>
      )}
      {open && <ReviewDialog note={note} editable={editable} onPatch={onPatch} open onOpenChange={setOpen} />}
    </div>
  );
}
