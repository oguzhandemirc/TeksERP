import { useState } from "react";
import { type UseFormReturn } from "react-hook-form";
import { Ruler } from "lucide-react";
import { FieldGrid } from "@/components/forms/WideFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
import { formatQty } from "@/lib/format";
import { suggestWarpEnds } from "@/pages/Operations/WarpPlan/service";
import { parseInput } from "@/pages/Operations/WarpPlan/warp-plan-model";
import { useReedUnit } from "@/hooks/useReedUnit";
import { reedDentsPerCm, reedUnitLabel } from "@/lib/reed-unit";
import type { WarpSpecFormValues } from "./schema";

type Form = UseFormReturn<WarpSpecFormValues>;

/** Örnek yer tutucu: "ör." önekli ve soluk — dolu değer sanılmasın (B18/5). */
const EXAMPLE_PH = "placeholder:text-muted-foreground/50";

export function IdentityFields({ form, excludeId }: { form: Form; excludeId?: string }) {
  const e = form.formState.errors;
  return (
    <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <FormField label="Kod" htmlFor="code" error={e.code} required>
        <Input id="code" {...form.register("code")} className={EXAMPLE_PH} placeholder="ör. UA6007-Ç" />
      </FormField>
      <FormField label="Çözgü kartı adı" htmlFor="name" error={e.name} required>
        <Input id="name" autoFocus {...form.register("name")} className={EXAMPLE_PH} placeholder="ör. UA6007 çözgüsü" />
        {/* Mükerreri REDDETMEK yerine ÖNLEMEK — yazarken benzerleri gösterir; `excludeId` kendi ikizini dışlar. */}
        <SimilarNamesWarning entity="warp-specs" name={form.watch("name") ?? ""} excludeId={excludeId} />
      </FormField>
    </div>
  );
}

/** "Taraktan": tarak × tarak eni × dişe tel → toplam tel ÖNERİSİ (birim profildir). Tek satırda uygular, çok satırda yalnız gösterir. */
export function ReedHelper({ form }: { form: Form }) {
  const [note, setNote] = useState<string | null>(null);
  const reedUnit = useReedUnit();
  const run = async () => {
    const v = form.getValues();
    // Öneri ucu diş/cm ister; form firma biriminde taşır (saklama diş/10 cm).
    const reed = reedDentsPerCm(String(v.reedNo ?? ""), reedUnit);
    const width = parseInput(String(v.reedWidthCm ?? ""));
    const perDent = (v.endsPerDent ?? "").toString().trim() === "" ? 1 : parseInput(String(v.endsPerDent));
    if (!reed || !width || !perDent) return setNote("Önce tarak no ve tarak enini girin.");
    try {
      const r = await suggestWarpEnds({ kind: "REED", reedPerCm: reed, widthCm: width, endsPerDent: perDent });
      const ends = formatQty(r.endsCount, 0);
      if (v.yarns.length === 1) {
        form.setValue("yarns.0.endsCount", String(r.endsCount), { shouldDirty: true, shouldValidate: true });
        setNote(`${ends} tel yazıldı.`);
      } else setNote(`Taraktan toplam ${ends} tel çıkıyor — satırlara kendiniz paylaştırın.`);
    } catch {
      setNote(null); // apiClient hatayı zaten bildirdi
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button type="button" size="sm" variant="outline" onClick={() => void run()} title="tarak × tarak eni × dişe tel">
        <Ruler className="h-3.5 w-3.5" /> Taraktan tel öner
      </Button>
      {note ? <span className="text-muted-foreground" data-testid="reed-helper-note">{note}</span> : null}
    </div>
  );
}

/** Tarak ve dizilim: kısa sayısal alanlar ızgarada yan yana (geniş ekranda 4, dar ekranda 2 → 1 sütun). */
export function ReedFields({ form }: { form: Form }) {
  const e = form.formState.errors;
  const reedUnit = useReedUnit();
  return (
    <FieldGrid cols={4}>
      <FormField label="Kenar teli" htmlFor="selvedgeEnds" error={e.selvedgeEnds} info="Kenar telleri iplik satırlarındaki tel adetlerinin içindedir ve kg'a orada girer. Bu alan yalnız tarak planı çizimi ve devere talimatı içindir; ayrıca eklenmez.">
        <Input id="selvedgeEnds" {...form.register("selvedgeEnds")} inputMode="numeric" className={EXAMPLE_PH} placeholder="ör. 24" />
      </FormField>
      <FormField label={`Tarak no (${reedUnitLabel(reedUnit)})`} htmlFor="reedNo" error={e.reedNo}
        info="Birim firma ayarından gelir (Sistem → Özellik Anahtarları → Devere / Levent). Yalnız taraktan tel önerisinde kullanılır; kg'a ve maliyete girmez.">
        <Input id="reedNo" {...form.register("reedNo")} inputMode="decimal" className={EXAMPLE_PH} placeholder={reedUnit === "DENTS_PER_CM" ? "ör. 10" : "ör. 100"} />
      </FormField>
      <FormField label="Dişe tel" htmlFor="endsPerDent" error={e.endsPerDent} info="Taraktan tel önerisinde boşsa 1 sayılır.">
        <Input id="endsPerDent" {...form.register("endsPerDent")} inputMode="numeric" className={EXAMPLE_PH} placeholder="ör. 4" />
      </FormField>
      <FormField label="Tarak eni (cm)" htmlFor="reedWidthCm" error={e.reedWidthCm} info="Maliyette atkı boyu buradan alınır (ürünün maliyet yapısında “Atkı boyu” girilmediyse; o da yoksa ham en + kenar payı). Taraktan tel önerisinde ve tezgâh önerisinde de kullanılır. Çözgü kg'ına girmez.">
        <Input id="reedWidthCm" {...form.register("reedWidthCm")} inputMode="decimal" className={EXAMPLE_PH} placeholder="ör. 280" />
      </FormField>
      <FormField className="sm:col-span-2" label="Dizilim (talimat)" htmlFor="sequenceNote" error={e.sequenceNote} info="Devereciye giden talimat: ör. 2A 1B. Tekrar eden kısmı parantezle kısaltabilirsiniz: 5x(2A 1B) 4C. Kg ve maliyete girmez.">
        <Input id="sequenceNote" {...form.register("sequenceNote")} className={EXAMPLE_PH} placeholder="ör. 5x(2A 1B) 4C" />
      </FormField>
      <FormField label="Çekme (%)" htmlFor="takeUpPct" error={e.takeUpPct} info="Çözgü çekmesi (take-up): dokumada çözgünün kumaştan ne kadar uzun harcandığı. Çözgü ÷ kumaş oranı: çözgü = kumaş ÷ (1 − çekme). Boşsa tezgahtan doğan topun otomatik tüketimi çözgü = kumaş sayar ve uyarır.">
        <Input id="takeUpPct" {...form.register("takeUpPct")} inputMode="decimal" className={EXAMPLE_PH} placeholder="ör. 8" />
      </FormField>
      <FormField label="Fire (%)" htmlFor="wastePct" error={e.wastePct} info="Çözgü ipliği firesi; hesaptaki fireli kg'yı ve maliyeti etkiler: çözgü = kumaş ÷ (1 − çekme) ÷ (1 − fire). Ürünün maliyet yapısındaki fire bunu ezer; boşsa maliyet parametrelerindeki varsayılan kullanılır.">
        <Input id="wastePct" {...form.register("wastePct")} inputMode="decimal" className={EXAMPLE_PH} placeholder="ör. 3" />
      </FormField>
    </FieldGrid>
  );
}

export function NotesField({ form }: { form: Form }) {
  return (
    <FormField label="Not" htmlFor="notes" error={form.formState.errors.notes}>
      <Textarea id="notes" {...form.register("notes")} rows={2} className={EXAMPLE_PH} placeholder="ör. tahar planı, jakar koşumu…" />
    </FormField>
  );
}
