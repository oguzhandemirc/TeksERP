// Toplu duruş penceresinin parçaları: zaman seçimi ("Şimdi" / "Daha önce"), sebep listesi (pencere içinde, açılır
// kutu YOK) ve önizleme tablosu (etkilenen HER tezgah adıyla, satır başına işaret, engelli satır sebebiyle).
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimeInput } from "@/components/forms/DateTimeInput";
import { formatFactory } from "@/lib/factory-time";
import type { ReasonPreset } from "@/pages/ReasonPresets/service";
import type { BulkStopAction, BulkStopPreviewRow } from "./stopService";

export interface TimeValue {
  now: boolean;
  /** "Daha önce" seçiliyken `datetime-local` biçiminde değer. */
  local: string;
}

function Choice({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={`rounded border px-3 py-1.5 text-sm ${checked ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}

export function TimeChoice({ label, value, onChange }: { label: string; value: TimeValue; onChange: (v: TimeValue) => void }) {
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={label} className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}:</span>
        <Choice checked={value.now} onClick={() => onChange({ ...value, now: true })}>
          Şimdi
        </Choice>
        <Choice checked={!value.now} onClick={() => onChange({ ...value, now: false })}>
          Daha önce
        </Choice>
      </div>
      {!value.now && <DateTimeInput aria-label={label} value={value.local} onChange={(local) => onChange({ now: false, local })} />}
    </div>
  );
}

/** Sebep kodu; `""` = sebep sonra girilecek (duruş yine açılır, sınıflama borcu doğar). */
export function ReasonList({ presets, value, onChange }: { presets: readonly ReasonPreset[]; value: string; onChange: (code: string) => void }) {
  const rows = [{ code: "", label: "Sebep sonra girilecek" }, ...presets.map((p) => ({ code: p.code, label: p.label }))];
  return (
    <div role="radiogroup" aria-label="Duruş sebebi" className="max-h-48 overflow-auto rounded border">
      {rows.map((r) => (
        <button
          key={r.code || "__yok__"}
          type="button"
          role="radio"
          aria-checked={value === r.code}
          onClick={() => onChange(r.code)}
          className={`block w-full border-b px-3 py-1.5 text-left text-sm last:border-b-0 ${value === r.code ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

const OUTCOME_TEXT: Record<BulkStopAction, string> = { OPEN: "Duruş açılacak", CLOSE: "Duruş kapanacak", REVOKE: "Duruş geri alınacak" };

interface TableProps {
  rows: readonly BulkStopPreviewRow[];
  picked: ReadonlySet<string>;
  onToggle: (machineId: string, on: boolean) => void;
  reasonLabel: (code: string | null) => string;
}

export function StopPreviewTable({ rows, picked, onToggle, reasonLabel }: TableProps) {
  return (
    <div className="max-h-[45vh] overflow-auto rounded border">
      <table className="w-full text-sm" aria-label="Etkilenecek tezgahlar">
        <thead className="sticky top-0 bg-muted text-left">
          <tr>
            <th className="w-8 p-2" />
            <th className="p-2">Tezgah</th>
            <th className="p-2">Açık duruş</th>
            <th className="p-2">Ne olacak</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const can = r.outcome !== "BLOCKED";
            return (
              <tr key={r.machineId} data-row={r.machineId} className={can ? "border-t" : "border-t text-muted-foreground"}>
                <td className="p-2">
                  <Checkbox aria-label={r.machineCode} checked={can && picked.has(r.machineId)} disabled={!can} onCheckedChange={(v) => onToggle(r.machineId, v === true)} />
                </td>
                <td className="p-2">
                  <div className="font-medium">{r.machineCode}</div>
                  <div className="text-xs text-muted-foreground">{r.machineName}</div>
                </td>
                <td className="p-2">{r.current ? `${formatFactory(r.current.startedAt, "dd.MM HH:mm")} · ${reasonLabel(r.current.reasonCode)}` : "Yok"}</td>
                <td className="p-2">{r.block ? r.block.message : OUTCOME_TEXT[r.outcome as BulkStopAction]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
