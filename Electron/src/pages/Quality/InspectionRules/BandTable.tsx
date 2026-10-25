// Bant tablosu: üst sınır (son satır boş = sınırsız) · etiket · kabul · kalite derecesi (yalnız FACTORY).
// Dar ekranda her bant kart gibi alt alta dizilir; geniş ekranda tek satır.
import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import type { QualityGrade } from "@/pages/QualityGrades/types";
import { emptyBand, type BandRow } from "./ruleSetForm";
import type { RuleScope } from "./service";

interface Props { scope: RuleScope; bands: BandRow[]; onChange: (bands: BandRow[]) => void; disabled?: boolean }

export function BandTable({ scope, bands, onChange, disabled }: Props) {
  const withGrade = scope === "FACTORY";
  const patch = (i: number, p: Partial<BandRow>) => onChange(bands.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...bands];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  const span = withGrade ? "md:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,8rem)_minmax(0,1.4fr)_auto]" : "md:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,8rem)_auto]";
  return (
    <div className="space-y-2" data-testid="band-table">
      <div className={`hidden gap-2 px-1 text-xs font-medium uppercase text-muted-foreground md:grid ${span}`}>
        <span>Üst sınır</span><span>Etiket</span><span>Karar</span>{withGrade && <span>Kalite derecesi</span>}<span className="sr-only">Sıra</span>
      </div>
      {bands.map((b, i) => {
        const last = i === bands.length - 1;
        return (
          <div key={b.key} data-testid="band-row" className={`grid grid-cols-2 items-center gap-2 rounded-md border p-2 md:border-0 md:p-0 ${span}`}>
            <Input aria-label={`${i + 1}. bant üst sınırı`} inputMode="decimal" disabled={disabled} value={b.maxScore}
              placeholder={last ? "Sınırsız" : "ör. 20"} onChange={(e) => patch(i, { maxScore: e.target.value })} />
            <Input aria-label={`${i + 1}. bant etiketi`} maxLength={16} disabled={disabled} value={b.label}
              placeholder="ör. A" onChange={(e) => patch(i, { label: e.target.value })} />
            <div className="col-span-2 flex gap-1 md:col-span-1" role="group" aria-label={`${i + 1}. bant kararı`}>
              <Button type="button" size="sm" className="flex-1" disabled={disabled} variant={b.accepted ? "default" : "outline"} onClick={() => patch(i, { accepted: true })}>GEÇTİ</Button>
              <Button type="button" size="sm" className="flex-1" disabled={disabled} variant={!b.accepted ? "destructive" : "outline"} onClick={() => patch(i, { accepted: false })}>KALDI</Button>
            </div>
            {withGrade && (
              <div className="col-span-2 min-w-0 md:col-span-1">
                <EntityPickerModal<QualityGrade>
                  value={b.qualityGradeId}
                  onChange={(id) => patch(i, { qualityGradeId: id })}
                  service={qualityGradeService}
                  queryKey="quality-grades-four-point-band"
                  getLabel={(g) => g.name}
                  getSubLabel={(g) => g.code}
                  icon={Star}
                  disabled={disabled}
                  placeholder="Derece seç…"
                  title="Kalite derecesi seç"
                  description="Bu banda düşen topa önerilecek kalite derecesi."
                  countLabel="derece"
                />
              </div>
            )}
            <div className="col-span-2 flex justify-end gap-1 md:col-span-1">
              <Button type="button" size="icon" variant="ghost" aria-label="Yukarı taşı" disabled={disabled || i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" aria-label="Aşağı taşı" disabled={disabled || last} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" aria-label="Bandı sil" disabled={disabled || bands.length <= 1} onClick={() => onChange(bands.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Bantlar küçükten büyüğe sıralanır; son bandın üst sınırı boş bırakılır (sınırsız).</p>
        <Button type="button" size="sm" variant="outline" disabled={disabled || bands.length >= 20} onClick={() => onChange([...bands, emptyBand()])}><Plus className="mr-1 h-4 w-4" />Bant ekle</Button>
      </div>
    </div>
  );
}
