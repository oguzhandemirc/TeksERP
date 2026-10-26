import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CHART_OPTIONS, KIND_LABEL, NARRATIVE_RULE_OPTIONS, PERIOD_UNITS, WIDTH_OPTIONS, type DefinitionBlock, type LayoutItem } from "./layout-model";

interface Props {
  block: DefinitionBlock;
  item: LayoutItem;
  canRemove: boolean;
  onChange: (patch: Partial<DefinitionBlock>) => void;
  onWidth: (w: number) => void;
  onPageBreak: (on: boolean) => void;
  onRemove: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">{label}</legend>
      {children}
    </fieldset>
  );
}

/** Kısa seçenek listesi düğme grubu (açılır kutu yok — kullanıcı tercihi). */
function Choice<T extends string | number>({ options, value, onPick }: { options: ReadonlyArray<{ value: T; label: string }>; value: T | undefined; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onPick(o.value)}
          className={cn("rounded-md border px-2.5 py-1 text-xs transition-colors", value === o.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Hangi gözlemler + en çok kaç cümle; en az bir kural seçili kalır (sunucu boş listeyi reddeder). */
function NarrativeSettings({ block, onChange }: { block: DefinitionBlock; onChange: Props["onChange"] }) {
  const rules = Array.isArray(block.kurallar) ? (block.kurallar as string[]) : [];
  const toggle = (r: string) => {
    const next = rules.includes(r) ? rules.filter((x) => x !== r) : NARRATIVE_RULE_OPTIONS.map((o) => o.deger).filter((x) => x === r || rules.includes(x));
    if (next.length > 0) onChange({ kurallar: next });
  };
  return (
    <>
      <Field label="Neler söylensin">
        <div className="flex flex-col gap-1.5">
          {NARRATIVE_RULE_OPTIONS.map((o) => (
            <label key={o.deger} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={rules.includes(o.deger)} disabled={rules.length === 1 && rules.includes(o.deger)} onChange={() => toggle(o.deger)} />
              {o.etiket}
            </label>
          ))}
        </div>
      </Field>
      <Field label="En çok kaç cümle">
        <Choice options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} value={(block.enFazla as number | undefined) ?? 3} onPick={(v) => onChange({ enFazla: v })} />
      </Field>
    </>
  );
}

/** Seçili bölümün sunum ayarları (grafik türü, genişlik, sayfa kesmesi…); ölçü/kırılım/süzgeç Kuyular'da (R2-VERI). */
export function BlockProperties({ block, item, canRemove, onChange, onWidth, onPageBreak, onRemove }: Props) {

  return (
    <section aria-label="Bölüm ayarları" className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">{KIND_LABEL[block.tur] ?? block.tur}</h2>
        <p className="text-xs text-muted-foreground">Değişiklik önizlemeye birkaç saniye içinde yansır.</p>
      </div>
      <Field label="Başlık">
        <Input value={block.baslik ?? ""} maxLength={120} placeholder={KIND_LABEL[block.tur]} onChange={(e) => onChange({ baslik: e.target.value.trim() ? e.target.value : undefined })} />
      </Field>
      {block.tur === "metin" ? (
        <Field label="Metin">
          <Textarea rows={5} maxLength={2000} value={typeof block.metin === "string" ? block.metin : ""} onChange={(e) => onChange({ metin: e.target.value })} />
        </Field>
      ) : null}
      {block.tur === "grafik" ? (
        <Field label="Grafik türü">
          <Choice options={CHART_OPTIONS.map((c) => ({ value: c.deger, label: c.etiket }))} value={block.gorsel as string} onPick={(v) => onChange({ gorsel: v })} />
        </Field>
      ) : null}
      {block.tur === "varyant" ? (
        <Field label="Kaç değer">
          <Choice options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))} value={block.ilkN as number} onPick={(v) => onChange({ ilkN: v })} />
        </Field>
      ) : null}
      {block.tur === "anlati" ? <NarrativeSettings block={block} onChange={onChange} /> : null}
      {block.tur === "donem" ? (
        <>
          <Field label="Dönem birimi">
            <Choice options={PERIOD_UNITS.map((u) => ({ value: u.deger, label: u.etiket }))} value={block.birim as string} onPick={(v) => onChange({ birim: v })} />
          </Field>
          <Field label="Kaç dönem">
            <Choice options={[2, 3, 4, 6, 12].map((n) => ({ value: n, label: String(n) }))} value={block.adet as number} onPick={(v) => onChange({ adet: v })} />
          </Field>
        </>
      ) : null}
      <Field label="Genişlik">
        <Choice options={WIDTH_OPTIONS.map((o) => ({ value: o.w, label: o.label }))} value={item.w} onPick={onWidth} />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={Boolean(item.sayfaKesmesi)} onChange={(e) => onPageBreak(e.target.checked)} />
        <span>
          PDF'te yeni sayfadan başlasın
          <span className="block text-xs text-muted-foreground">Ekranda kesik çizgiyle gösterilir.</span>
        </span>
      </label>
      <Button type="button" variant="outline" size="sm" className="gap-1.5 self-start text-destructive" disabled={!canRemove} onClick={onRemove}>
        <Trash2 className="h-4 w-4" /> Bölümü kaldır
      </Button>
      {!canRemove ? <p className="text-xs text-muted-foreground">Raporda en az bir bölüm kalmalı.</p> : null}
    </section>
  );
}
