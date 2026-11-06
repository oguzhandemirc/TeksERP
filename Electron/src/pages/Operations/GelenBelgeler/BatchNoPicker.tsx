// "Parti no" kartı (PER_DOCUMENT): belgedeki adaylar radyo (etiket + değer + tür), elle yaz. Aday listesi ve ilk seçim
// sunucudan (A; hatırlanan anahtar orada önce gelir); seçim başlık PATCH'iyle yazılır, hatırlama onayda öğrenilir (B).
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BATCH_KIND_LABEL } from "./partiMetre";
import { isMultiParty, useNoteParties } from "./useNoteParties";
import type { BatchNoCandidate, DeliveryNoteDetail, HeaderPatch } from "./types";

interface Props {
  note: DeliveryNoteDetail;
  editable: boolean;
  onPatch: (p: HeaderPatch) => void;
}

/** VarChar(64) = backend Zod sınırı. */
const MAX = 64;

function CandidateRow({ c, checked, editable, onPick }: { c: BatchNoCandidate; checked: boolean; editable: boolean; onPick: () => void }) {
  return (
    <label className={`flex cursor-pointer flex-col gap-1 rounded border p-2 text-sm ${checked ? "border-primary bg-primary/5" : ""}`} data-testid="batch-candidate" data-key={c.key}>
      <span className="flex flex-wrap items-center gap-2">
        <input type="radio" name="batch-no" checked={checked} disabled={!editable} onChange={onPick} aria-label={`${c.label}: ${c.value}`} />
        <span className="text-muted-foreground">{c.label}</span>
        <span className="font-semibold tabular-nums">{c.value}</span>
        <Badge variant="muted">{BATCH_KIND_LABEL[c.kind] ?? c.kind}</Badge>
      </span>
    </label>
  );
}

export function BatchNoPicker({ note, editable, onPatch }: Props) {
  // Çok partili belgede tek parti no anlamsız: her partinin numarası Partiler kartında (onayda parti başına yazılır).
  const multi = isMultiParty(useNoteParties(note.id).data);
  if (multi) return <MultiPartyBatchNo />;
  return <SingleBatchNo note={note} editable={editable} onPatch={onPatch} />;
}

function MultiPartyBatchNo() {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border p-3" data-testid="batch-no-card" data-multi="1">
      <p className="text-sm font-medium">Parti no</p>
      <span className="text-xs text-muted-foreground" data-testid="batch-no-multi">Bu belgede birden çok parti var — numaralar Partiler kartında.</span>
    </div>
  );
}

function SingleBatchNo({ note, editable, onPatch }: Props) {
  const cands = note.batchNoCandidates ?? [];
  const manual = note.ourBatchNoKey === "MANUAL";
  const blurManual = (v: string) => {
    const next = v.trim() || null;
    if (next === (manual ? (note.ourBatchNo ?? null) : null)) return;
    // Anahtarsız gönderim = elle (sunucu `MANUAL` yazar; `MANUAL` istemciden gönderilemez); null temizler.
    onPatch({ ourBatchNo: next });
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="batch-no-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Parti no</p>
        <span className="text-sm font-semibold" data-testid="batch-no-value">{note.ourBatchNo ?? "—"}</span>
      </div>
      {editable && !note.ourBatchNo && <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="batch-no-empty">Parti no seçin — boş kalırsa parti numarası seriden doğar.</p>}
      {cands.map((c) => (
        <CandidateRow key={c.key} c={c} editable={editable} checked={!manual && note.ourBatchNoKey === c.key} onPick={() => onPatch({ ourBatchNo: c.value, ourBatchNoKey: c.key })} />
      ))}
      {/* Elle giriş ve "seçin" yönergesi yalnız düzenlenebilir taslakta; kapanmış belgede değer başlıkta okunur. */}
      {editable && (
        <div key={`manual:${note.updatedAt}`} className="flex flex-col gap-1">
          <Label>Elle yaz</Label>
          <Input aria-label="Parti no (elle)" maxLength={MAX} defaultValue={manual ? (note.ourBatchNo ?? "") : ""} placeholder="Belgede yoksa ya da farklıysa yazın" onBlur={(e) => blurManual(e.target.value)} />
        </div>
      )}
    </div>
  );
}
