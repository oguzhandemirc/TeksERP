// Levent kabul satırının GÖVDE hücresi (devere ek E2; backend B3 `beamBodyId | newBody`). Yalnız
// `devere.beamBodyMode≠OFF` iken çizilir. QR/no okut (Enter → `/resolve`): kayıtlıysa gövdeye bağlanır, tanımsızsa
// "yeni gövde" olur (sahip Bizim / bu devereci). Uygunluk kararı sunucuda (önizleme 409 BEAM_BODY_*); burada yalnız
// açıkça dolu/terminal gövdeyi eklemeden söyleriz.
import { useState } from "react";
import { ScanLine, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorMessage } from "@/services/apiClient";
import { ownerText } from "@/pages/BeamBodies/model";
import type { BeamBody } from "@/pages/BeamBodies/types";
import { warpingReceiveDocService } from "./receive-doc-service";
import type { ReceiveBodyDraft } from "./receive-model";

/** Kabulde bağlanabilen gövde: aktif ve boş (depoda ya da deverecide). Dolu/bakım/hurda/iade bağlanamaz. */
const RECEIVABLE = new Set(["EMPTY_STOCK", "AT_SUBCONTRACTOR"]);

function existingOf(b: BeamBody): ReceiveBodyDraft | string {
  if (!b.isActive || !RECEIVABLE.has(b.status)) return `${b.bodyNo} şu an “${b.statusLabel}” — yalnız boş gövde dolu leventle dönebilir.`;
  return { kind: "existing", id: b.id, bodyNo: b.bodyNo, hint: ownerText(b.owner) };
}

export function ReceiveBodyCell({ row, value, subcontractorId, onChange }: { row: number; value: ReceiveBodyDraft | null | undefined; subcontractorId: string | null; onChange: (v: ReceiveBodyDraft | null) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const scan = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    try {
      const b = await warpingReceiveDocService.resolveBody(c);
      if (b === null) {
        onChange({ kind: "new", bodyNo: c, ownerKind: "OURS", subcontractorId });
      } else {
        const v = existingOf(b);
        if (typeof v === "string") toast.error(v);
        else onChange(v);
      }
      setCode("");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Gövde okunamadı."));
    } finally {
      setBusy(false);
    }
  };

  if (!value) {
    return (
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          aria-label={`${row}. levent gövde okut`}
          className="h-8 pl-7 font-mono"
          placeholder="QR / no, Enter"
          maxLength={32}
          value={code}
          disabled={busy}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => void scan()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void scan();
            }
          }}
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-sm">{value.bodyNo}</span>
      {value.kind === "existing" ? (
        <span className="truncate text-xs text-muted-foreground" title={value.hint}>· {value.hint}</span>
      ) : (
        <>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">(yeni)</span>
          <Select value={value.ownerKind} onValueChange={(k) => onChange({ ...value, ownerKind: k as "OURS" | "WARPER" })}>
            <SelectTrigger className="h-7 w-28 text-xs" aria-label={`${row}. levent yeni gövde sahibi`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="OURS">Bizim</SelectItem>
              <SelectItem value="WARPER" disabled={!subcontractorId}>Devereci</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}
      <button type="button" className="ml-auto rounded p-0.5 hover:bg-muted" aria-label={`${row}. levent gövdesini kaldır`} onClick={() => onChange(null)}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
