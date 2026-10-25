// Elle yapı: çözgü (tel, çekme, iplik) + atkı (sıklık, ham en, 1..8 iplik ve paylar). Değerler metin kalır;
// iplik denye/fiyatı kart yerine elle yazılır — kayıt YAZILMAZ.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencySelect } from "../shared/CurrencySelect";
import { emptyYarn, MAX_WEFT_YARNS, type AdHocForm, type YarnForm } from "./calculator-body";

function Num({ label, value, onChange, field }: { label: string; value: string; onChange: (v: string) => void; field?: string }) {
  return (
    <label className="text-sm" data-field={field}>
      <span className="text-muted-foreground">{label}</span>
      <Input aria-label={label} inputMode="decimal" className="mt-1 text-right tabular-nums" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function YarnRow({ y, onChange, prefix, withPicks }: { y: YarnForm; onChange: (y: YarnForm) => void; prefix: string; withPicks: boolean }) {
  const set = (k: keyof YarnForm, v: string) => onChange({ ...y, [k]: v });
  return (
    <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
      <label className="col-span-2 text-sm sm:col-span-1"><span className="text-muted-foreground">{prefix} iplik adı</span>
        <Input aria-label={`${prefix} iplik adı`} className="mt-1" maxLength={100} value={y.name} onChange={(e) => set("name", e.target.value)} /></label>
      <Num label={`${prefix} denye`} value={y.denier} onChange={(v) => set("denier", v)} />
      <Num label={`${prefix} kg fiyatı`} value={y.pricePerKg} onChange={(v) => set("pricePerKg", v)} />
      <CurrencySelect label={`${prefix} para birimi`} value={y.currency} onChange={(c) => onChange({ ...y, currency: c })} />
      {withPicks && <Num label={`${prefix} pay`} value={y.picksInRepeat} onChange={(v) => set("picksInRepeat", v)} />}
    </div>
  );
}

export function AdHocFields({ value, onChange }: { value: AdHocForm; onChange: (a: AdHocForm) => void }) {
  const set = (k: keyof AdHocForm, v: string) => onChange({ ...value, [k]: v });
  const setWeft = (i: number, y: YarnForm) => onChange({ ...value, weftYarns: value.weftYarns.map((x, j) => (j === i ? y : x)) });
  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-md border p-3">
        <h3 className="text-sm font-medium">Çözgü</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Num label="Tel sayısı" value={value.endsCount} onChange={(v) => set("endsCount", v)} />
          <Num label="Çözgü çekmesi (%)" value={value.takeUpPct} onChange={(v) => set("takeUpPct", v)} />
        </div>
        <YarnRow y={value.warpYarn} onChange={(y) => onChange({ ...value, warpYarn: y })} prefix="Çözgü" withPicks={false} />
      </section>
      <section className="space-y-2 rounded-md border p-3">
        <h3 className="text-sm font-medium">Atkı</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Num label="Atkı sıklığı (atkı/cm)" value={value.picksPerCm} onChange={(v) => set("picksPerCm", v)} />
          <Num label="Ham en (cm)" value={value.rawWidthCm} onChange={(v) => set("rawWidthCm", v)} />
        </div>
        {value.weftYarns.map((y, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1"><YarnRow y={y} onChange={(n) => setWeft(i, n)} prefix={`Atkı ${i + 1}`} withPicks /></div>
            {value.weftYarns.length > 1 && (
              <Button type="button" size="icon" variant="ghost" aria-label={`Atkı ${i + 1} ipliğini çıkar`}
                onClick={() => onChange({ ...value, weftYarns: value.weftYarns.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
            )}
          </div>
        ))}
        {value.weftYarns.length < MAX_WEFT_YARNS && (
          <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...value, weftYarns: [...value.weftYarns, emptyYarn()] })}>
            <Plus className="mr-1 h-4 w-4" />Atkı ipliği ekle
          </Button>
        )}
      </section>
    </div>
  );
}
