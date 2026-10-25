import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CatalogCube } from "../custom-api";
import { allowedDimensions } from "../builder-model";
import { CHART_OPTIONS, KIND_LABEL, PERIOD_UNITS, WIDTH_OPTIONS, type DefinitionBlock, type DefinitionQuery, type LayoutItem } from "./layout-model";

interface Props {
  block: DefinitionBlock;
  item: LayoutItem;
  cube: CatalogCube | undefined;
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

const SPLIT_KINDS = new Set(["grafik", "tablo", "varyant", "donem"]);

/** Seçili bölümün ayarları: içerik (ölçü, kırılım, grafik türü…) + yerleşim (genişlik, sayfa kesmesi). */
export function BlockProperties({ block, item, cube, canRemove, onChange, onWidth, onPageBreak, onRemove }: Props) {
  const q = block.sorgu;
  const setQuery = (patch: Partial<DefinitionQuery>) => q && onChange({ sorgu: { ...q, ...patch } });
  const measures = cube?.olculer ?? [];
  const dims = q ? allowedDimensions(cube, q.olculer).filter((d) => d.tur === "kategori") : [];
  const dimOptions = [...(block.tur === "tablo" || block.tur === "donem" ? [{ value: "", label: "Kırılımsız" }] : []), ...dims.map((d) => ({ value: d.kimlik, label: d.ad }))];

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
      {q && measures.length > 0 ? (
        <Field label="Ölçü">
          <Choice options={measures.map((m) => ({ value: m.kimlik, label: m.ad }))} value={q.olculer[0]} onPick={(v) => setQuery({ olculer: [v] })} />
        </Field>
      ) : null}
      {q && SPLIT_KINDS.has(block.tur) ? (
        <Field label="Kırılım">
          {dimOptions.length ? (
            <Choice options={dimOptions} value={q.boyutlar?.[0] ?? ""} onPick={(v) => setQuery({ boyutlar: v ? [v] : [] })} />
          ) : (
            <p className="text-xs text-muted-foreground">Bu ölçü kırılamıyor.</p>
          )}
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
