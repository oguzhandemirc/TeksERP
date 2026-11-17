import { useState } from "react";
import { type UseFormReturn } from "react-hook-form";
import { Ruler } from "lucide-react";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
import { formatQty } from "@/lib/format";
import { suggestWarpEnds } from "@/pages/Operations/WarpPlan/service";
import { parseInput } from "@/pages/Operations/WarpPlan/warp-plan-model";
import { warpSpecFormSchema, type WarpSpecFormValues } from "./schema";
import { buildDefaults } from "./payload";
import { YarnRowsEditor } from "./YarnRowsEditor";
import { WarpPreviewStrip } from "./WarpPreviewStrip";
import type { WarpSpec } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WarpSpec | null;
  /** "Kopyala": aynı reçeteden yeni kart taslağı (kayıt OLUŞTURMA olarak gider). */
  draft?: WarpSpecFormValues | null;
  onSubmit: (values: WarpSpecFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

/** Faz 4 take-up (%): çözgü ÷ kumaş; boş = bilinmiyor (otomatik tüketim çözgü = kumaş sayar, uyarır). */
function TakeUpField({ form }: { form: UseFormReturn<WarpSpecFormValues> }) {
  return (
    <FormField label="Take-up (%)" htmlFor="takeUpPct" error={form.formState.errors.takeUpPct} hint="Çözgü ÷ kumaş oranı: çözgü = kumaş ÷ (1 − take-up). Boşsa tezgahtan doğan topun otomatik tüketimi çözgü = kumaş sayar ve uyarır.">
      <Input id="takeUpPct" {...form.register("takeUpPct")} inputMode="decimal" placeholder="ör. 8" />
    </FormField>
  );
}

/** SY-C1 kart firesi (%): bu çözgüyü kullanan her desenin maliyetinde, ürün maliyet yapısı boşsa geçerli. */
function WasteField({ form }: { form: UseFormReturn<WarpSpecFormValues> }) {
  return (
    <FormField label="Fire (%)" htmlFor="wastePct" error={form.formState.errors.wastePct} hint="Çözgü ipliği firesi; maliyette çözgü = kumaş ÷ (1 − take-up) ÷ (1 − fire). Ürünün maliyet yapısındaki fire bunu ezer; boşsa maliyet parametrelerindeki varsayılan kullanılır.">
      <Input id="wastePct" {...form.register("wastePct")} inputMode="decimal" placeholder="ör. 3" />
    </FormField>
  );
}

/** "Taraktan": tarak × tarak eni × dişe tel → toplam tel ÖNERİSİ (birim profildir). Tek satırda uygular, çok satırda yalnız gösterir. */
function ReedHelper({ form }: { form: UseFormReturn<WarpSpecFormValues> }) {
  const [note, setNote] = useState<string | null>(null);
  const run = async () => {
    const v = form.getValues();
    const reed = parseInput(String(v.reedNo ?? ""));
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
        <Ruler className="h-3.5 w-3.5" /> Taraktan
      </Button>
      {note ? <span className="text-muted-foreground" data-testid="reed-helper-note">{note}</span> : null}
    </div>
  );
}

export function WarpSpecFormDialog({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }: Props) {
  return (
    <EntityFormDialog<WarpSpecFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Çözgü Kartını Düzenle" : draft ? "Çözgü Kartını Kopyala" : "Yeni Çözgü Kartı"}
      schema={warpSpecFormSchema}
      defaultValues={initial ? buildDefaults(initial) : (draft ?? buildDefaults(null))}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          <FormField label="Kod" htmlFor="code" error={form.formState.errors.code} required>
            <Input id="code" {...form.register("code")} placeholder="UA6007-Ç" />
          </FormField>

          <FormField label="Çözgü kartı adı" htmlFor="name" error={form.formState.errors.name} required>
            <Input id="name" autoFocus {...form.register("name")} placeholder="UA6007 çözgüsü" />
            {/* Mükerreri REDDETMEK yerine ÖNLEMEK — yazarken benzerleri gösterir; `excludeId` kendi ikizini dışlar. */}
            <SimilarNamesWarning entity="warp-specs" name={form.watch("name") ?? ""} excludeId={initial?.id} />
          </FormField>

          <YarnRowsEditor />
          <WarpPreviewStrip />

          <FormField label="Dizilim (talimat)" htmlFor="sequenceNote" error={form.formState.errors.sequenceNote} hint="Devereciye giden talimat: ör. 2A 1B. Hesaba girmez.">
            <Input id="sequenceNote" {...form.register("sequenceNote")} placeholder="2A 1B" />
          </FormField>

          <FormField label="Kenar teli" htmlFor="selvedgeEnds" error={form.formState.errors.selvedgeEnds}>
            <Input id="selvedgeEnds" {...form.register("selvedgeEnds")} inputMode="numeric" placeholder="24" />
          </FormField>

          <FormField label="Tarak no" htmlFor="reedNo" error={form.formState.errors.reedNo} hint="Birimi fabrikanın kendi kullanımıdır (diş/cm ya da diş/10 cm); hesaba girmez.">
            <Input id="reedNo" {...form.register("reedNo")} inputMode="decimal" placeholder="14" />
          </FormField>

          <FormField label="Dişe tel" htmlFor="endsPerDent" error={form.formState.errors.endsPerDent}>
            <Input id="endsPerDent" {...form.register("endsPerDent")} inputMode="numeric" placeholder="4" />
          </FormField>

          <FormField label="Tarak eni (cm)" htmlFor="reedWidthCm" error={form.formState.errors.reedWidthCm}>
            <Input id="reedWidthCm" {...form.register("reedWidthCm")} inputMode="decimal" placeholder="280" />
          </FormField>
          <ReedHelper form={form} />
          <TakeUpField form={form} />
          <WasteField form={form} />

          <FormField label="Not" htmlFor="notes" error={form.formState.errors.notes}>
            <Textarea id="notes" {...form.register("notes")} rows={2} placeholder="Tahar planı, jakar koşumu…" />
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
