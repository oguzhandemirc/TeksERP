// Çok partili belge (S1): "Bu belgede N parti var" — parti no + metre düzenlenir, sunucunun canlı uyarıları gösterilir,
// "Her parti ayrı iş emri | Tek iş emri" seçimi (varsayılan fabrika ayarı). Tek partili belgede çizilmez.
import { TERIM } from "@/lib/terim";
import { Input } from "@/components/ui/input";
import type { MultiPartyDraft, MultiPartyMode, NotePartiesView } from "./partyDraft";

interface Props {
  view: NotePartiesView;
  value: MultiPartyDraft;
  onChange: (next: MultiPartyDraft) => void;
  disabled?: boolean;
}

const IE = TERIM.terbiyeIsEmri;
const MODES: ReadonlyArray<{ value: MultiPartyMode; label: string }> = [
  { value: "PER_PARTY", label: `Her parti ayrı ${IE.tekilKucuk}` },
  { value: "SINGLE", label: `Tek ${IE.tekilKucuk} (partiler ayrı top)` },
];

export function PartyList({ view, value, onChange, disabled }: Props) {
  const setRow = (blockNo: number, patch: Partial<MultiPartyDraft["rows"][number]>) =>
    onChange({ ...value, rows: value.rows.map((r) => (r.blockNo === blockNo ? { ...r, ...patch } : r)) });
  return (
    <section className="flex flex-col gap-2 rounded border p-3" data-testid="oie-parties">
      <p className="text-sm font-medium">Bu belgede {value.rows.length} parti var</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr><th className="py-1">#</th><th>Parti no</th><th>Sipariş</th><th>Satır</th><th>Metre</th></tr>
        </thead>
        <tbody>
          {value.rows.map((r) => {
            const p = view.parties.find((x) => x.blockNo === r.blockNo);
            return (
              <tr key={r.blockNo} className="align-top" data-testid={`oie-party-${r.blockNo}`}>
                <td className="py-1 pr-2">{r.blockNo}</td>
                <td className="pr-2"><Input aria-label={`${r.blockNo}. parti no`} value={r.batchNo} disabled={disabled} onChange={(e) => setRow(r.blockNo, { batchNo: e.target.value })} /></td>
                <td className="pr-2 pt-2">{p?.orderNo ?? "—"}</td>
                <td className="pr-2 pt-2">{p ? `${p.lineCount}${p.declaredTopCount !== null ? ` / ${p.declaredTopCount} TOP` : ""}` : "—"}</td>
                <td>
                  <Input aria-label={`${r.blockNo}. parti metresi`} inputMode="decimal" value={r.meters ?? ""} disabled={disabled}
                    onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); setRow(r.blockNo, { meters: e.target.value.trim() && Number.isFinite(n) ? n : null }); }} />
                  {p?.warnings.map((w) => <p key={w} className="text-xs text-amber-800 dark:text-amber-300">{w}</p>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {view.warnings.length > 0 && <ul className="text-xs text-amber-800 dark:text-amber-300" data-testid="oie-party-warnings">{view.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      <div role="radiogroup" aria-label={`${IE.tekil} kipi`} className="flex flex-wrap gap-4 text-sm">
        {MODES.map((m) => (
          <label key={m.value} className="flex items-center gap-1">
            <input type="radio" name="oie-party-mode" value={m.value} checked={value.mode === m.value} disabled={disabled} onChange={() => onChange({ ...value, mode: m.value })} />
            {m.label}
          </label>
        ))}
      </div>
    </section>
  );
}
