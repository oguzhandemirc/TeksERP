// Düzelt + kâğıttan giriş ortak gövdesi: uzunluk, en, hata tablosu ve sunucu önizlemesi.
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorText } from "@/lib/api-error";
import type { MeasureInput } from "./service";
import { DefectTableEditor } from "./DefectTableEditor";
import { WIDTH_SOURCE_LABEL, decimalInput, defectRowProblem, defectsPayload, numText, type DefectRow } from "./inspectionRules";
import { useInspectionPreview } from "./useInspectionPreview";

export interface MeasureState { rows: DefectRow[]; length: string; width: string }

/** Form geçerliyse gövde, değilse null (gönderilmez; önizleme de istenmez). */
export function measurePayload(m: MeasureState): MeasureInput | null {
  const length = decimalInput(m.length);
  const width = decimalInput(m.width);
  if (length === undefined || width === undefined || m.rows.some((r) => defectRowProblem(r))) return null;
  return { defects: defectsPayload(m.rows), inspectedLengthM: length, manualWidthCm: width };
}

interface Props { rollId: string | null; m: MeasureState; onChange: (m: MeasureState) => void; lengthHint?: string }

export function MeasureForm({ rollId, m, onChange, lengthHint }: Props) {
  const payload = measurePayload(m);
  const pv = useInspectionPreview(rollId, payload);
  const p = pv.data;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="insp-length">Muayene uzunluğu (m)</Label>
          <Input id="insp-length" inputMode="decimal" placeholder={lengthHint ?? "Boş = topun metrajı"} value={m.length} onChange={(e) => onChange({ ...m, length: e.target.value })} />
          {decimalInput(m.length) === undefined && <p className="text-xs text-destructive">Uzunluk sayı olmalı</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="insp-width">En (cm, elle)</Label>
          <Input id="insp-width" inputMode="decimal" placeholder="Boş = ürün kartı / topta ölçülen" value={m.width} onChange={(e) => onChange({ ...m, width: e.target.value })} />
          {decimalInput(m.width) === undefined && <p className="text-xs text-destructive">En sayı olmalı</p>}
        </div>
      </div>
      <DefectTableEditor rows={m.rows} onChange={(rows) => onChange({ ...m, rows })} />
      <div className="rounded-md border bg-muted/30 p-3 text-sm" data-testid="inspection-preview" aria-live="polite">
        {!rollId ? <p className="text-muted-foreground">Önizleme için top seçin.</p>
          : !payload ? <p className="text-muted-foreground">Formdaki işaretli alanları düzeltin.</p>
          : pv.isFetching && !p ? <p className="text-muted-foreground">Hesaplanıyor…</p>
          : pv.isError ? <p className="text-destructive">{apiErrorText(pv.error, "Önizleme alınamadı.")}</p>
          : p && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>Puan <b className="tabular-nums">{p.cappedPoints}</b>{p.cappedPoints !== p.totalPoints && <span className="text-muted-foreground"> (ham {p.totalPoints})</span>}</span>
              <span>/100 m² <b className="tabular-nums">{numText(p.pointsPer100M2)}</b></span>
              <span>En {numText(p.widthCm)} cm · {WIDTH_SOURCE_LABEL[p.widthSource]}</span>
              <span>Öneri {p.suggested ? <Badge variant={p.suggested.accepted ? "outline" : "destructive"}>{p.suggested.code ?? p.suggested.label}</Badge> : "—"}</span>
              {p.unplaced > 0 && <span className="text-xs text-muted-foreground">{p.unplaced} konumsuz hata</span>}
              <span className="w-full text-xs text-muted-foreground">Kural: {p.ruleSet?.name ?? "fabrika varsayılanı"}</span>
            </div>
          )}
      </div>
    </div>
  );
}
