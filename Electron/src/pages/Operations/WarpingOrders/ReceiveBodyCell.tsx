// Levent kabul satırının GÖVDE hücresi (devere ek E2; backend B3 `beamBodyId | newBody`). Yalnız
// `devere.beamBodyMode≠OFF` iken çizilir. QR/no okut (Enter → `/resolve`) ya da D3 "Listeden seç": deverecide duran
// gövdelerimiz, bu siparişle gidenler önce. Seçim opsiyoneldir; gönderilenden farklı gövde "farklı gövde" diye işaretlenir.
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
import { isDifferentBody, optionHint, sentBodiesText, type ReceiveBodyOption, type ReceiveBodyOptions } from "./receive-body-options";

/** Kabulde bağlanabilen gövde: aktif ve boş (depoda ya da deverecide). Dolu/bakım/hurda/iade bağlanamaz. */
const RECEIVABLE = new Set(["EMPTY_STOCK", "AT_SUBCONTRACTOR"]);

function existingOf(b: BeamBody): ReceiveBodyDraft | string {
  if (!b.isActive || !RECEIVABLE.has(b.status)) return `${b.bodyNo} şu an “${b.statusLabel}” — yalnız boş gövde dolu leventle dönebilir.`;
  return { kind: "existing", id: b.id, bodyNo: b.bodyNo, hint: ownerText(b.owner) };
}

const fromOption = (o: ReceiveBodyOption): ReceiveBodyDraft => ({ kind: "existing", id: o.id, bodyNo: o.bodyNo, hint: optionHint(o) });

export interface ReceiveBodyCellProps {
  row: number;
  value: ReceiveBodyDraft | null | undefined;
  subcontractorId: string | null;
  onChange: (v: ReceiveBodyDraft | null) => void;
  /** D3: sunucunun seçenek listesi (sipariş başı); yoksa yalnız okutma. */
  choices?: ReceiveBodyOptions;
  /** Bu satırda önerilecekler (başka satırda seçilenler düşülmüş). */
  available?: ReceiveBodyOption[];
}

function BodyPicker({ row, available, onPick }: { row: number; available: ReceiveBodyOption[]; onPick: (o: ReceiveBodyOption) => void }) {
  return (
    <Select value="" onValueChange={(id) => { const o = available.find((x) => x.id === id); if (o) onPick(o); }}>
      <SelectTrigger className="h-8 w-32 shrink-0 text-xs" aria-label={`${row}. levent gövde listeden seç`}><SelectValue placeholder="Listeden seç" /></SelectTrigger>
      <SelectContent>
        {available.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            <span className="font-mono">{o.bodyNo}</span>
            <span className={o.sentWithOrder ? "ml-2 text-xs text-emerald-700 dark:text-emerald-400" : "ml-2 text-xs text-muted-foreground"}>{optionHint(o)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const DifferentBadge = ({ choices }: { choices: ReceiveBodyOptions | undefined }) => (
  <span className="shrink-0 rounded bg-amber-100 px-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" title={`Bu siparişle gönderilen: ${sentBodiesText(choices)} — gönderilen gövde deverecide kalmış görünür.`}>
    farklı gövde
  </span>
);

export function ReceiveBodyCell({ row, value, subcontractorId, onChange, choices, available = [] }: ReceiveBodyCellProps) {
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
        else {
          onChange(v);
          // S3 esnek eşleşme: okunan no gövde no'dan farklıysa operatör hangi gövdenin seçildiğini görsün.
          if (b.bodyNo.toLowerCase() !== c.toLowerCase()) toast.info(`"${c}" → ${b.bodyNo} gövdesi seçildi (esnek gövde no).`);
        }
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
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
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
        {available.length > 0 && <BodyPicker row={row} available={available} onPick={(o) => onChange(fromOption(o))} />}
      </div>
    );
  }
  const different = isDifferentBody(value, choices);
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-sm">{value.bodyNo}</span>
      {different && <DifferentBadge choices={choices} />}
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
