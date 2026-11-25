// Yapı sekmesi: kart verisi salt-okunur + maliyet ekleri formu (`PUT structures/:itemId`, tam küme; boş = varsayılan).
// Ölçülmüş çözgü firesi yalnız ÖNERİ: "Uygula" forma yazar, kaydetmek kullanıcının işidir.
// Düzen (B12): anlamlı gruplu kartlar, kısa alanlar dar ızgarada, kaydet çubuğu kaydırma bölgesinin dibine yapışık.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { finishingRateService } from "../FinishingRates/service";
import type { MeasuredWarpWaste } from "../shared/cost-types";
import { decToInput, fmtDecFull, fmtQtyDecFull, toDecimalText } from "../shared/format";
import { SOURCE_LABEL } from "../shared/labels";
import { CardSummary } from "./CardSummary";
import { ProcessesEditor } from "./ProcessesEditor";
import { NARROW_GRID, StructureNumberField, useStructureHintContext } from "./StructureNumberField";
import { FinishingCard, StructureSaveBar } from "./StructureParts";
import { StructurePickField } from "./StructurePickField";
import { isCostCurrency, showPickFields, useWeavingPickMethod, type PickPair } from "../shared/loom-pick";
import { WASTE_PRECEDENCE_TEXT } from "@/lib/waste-precedence";
import { STRUCTURE_MAX } from "./schema";
import { costItemService, STRUCTURE_KEYS, type CostItemDetail, type StructureKey } from "./service";

type Form = Record<StructureKey | "finishingRateCode" | "extraCostLabel" | "notes", string>;
const formOf = (d: CostItemDetail): Form => ({
  ...(Object.fromEntries(STRUCTURE_KEYS.map((k) => [k, decToInput(d.yapi?.[k] ?? null)])) as Record<StructureKey, string>),
  finishingRateCode: d.yapi?.finishingRateCode ?? "",
  extraCostLabel: d.yapi?.extraCostLabel ?? "",
  notes: d.yapi?.notes ?? "",
});

export function StructureTab({ detail, measured, flagged }: { detail: CostItemDetail; measured: MeasuredWarpWaste | null; flagged: Set<string> }) {
  const qc = useQueryClient();
  const canWrite = useRoleAccess().hasPermission("cost:write");
  const [initial] = useState<Form>(() => formOf(detail));
  const [f, setF] = useState<Form>(initial);
  const [initialProcs] = useState<string[]>(() => (detail.yapi?.processes ?? []).map((p) => p.rateCode));
  const [procs, setProcs] = useState<string[]>(initialProcs);
  const pickVisible = showPickFields(useWeavingPickMethod(), { rate: detail.yapi?.loomPickRate, currency: detail.yapi?.loomPickCurrency });
  const [initialPick] = useState<PickPair>(() => ({
    rate: decToInput(detail.yapi?.loomPickRate ?? null),
    currency: isCostCurrency(detail.yapi?.loomPickCurrency) ? detail.yapi.loomPickCurrency : "",
  }));
  const [pick, setPick] = useState<PickPair>(initialPick);
  const rates = useQuery({ queryKey: ["cost-finishing-rates", "active"], queryFn: () => finishingRateService.listActive() });  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify([f, procs, pick]) !== JSON.stringify([initial, initialProcs, initialPick]);
  const save = useMutation({
    mutationFn: () =>
      costItemService.putStructure(detail.urun.id, {
        ...(Object.fromEntries(STRUCTURE_KEYS.map((k) => [k, toDecimalText(f[k])])) as Record<StructureKey, string | null>),
        finishingRateCode: f.finishingRateCode || null,
        extraCostLabel: f.extraCostLabel.trim() || null,
        notes: f.notes.trim() || null,
        processes: procs.filter((c) => c !== f.finishingRateCode),
        ...(pickVisible ? { loomPick: { rate: toDecimalText(pick.rate), currency: pick.currency || null } } : {}),
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Maliyet yapısı kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["cost-items"] });
      void qc.invalidateQueries({ queryKey: ["cost-preview"] });
    },
  });
  const ctx = useStructureHintContext(f.finishingRateCode, rates.data);
  const num = (k: StructureKey, footer?: ReactNode) => (
    <StructureNumberField k={k} value={f[k]} onChange={(v) => set(k, v)} girdi={detail.girdi} disabled={!canWrite} flagged={flagged.has(k)} ctx={ctx} footer={footer} />
  );
  const pickDefault = detail.girdi.loomPick?.rate;
  const info = (desc: string, label: string) => <InfoPopover desc={desc} label={label} />;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <CardSummary g={detail.girdi} />
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Tezgâh" titleExtra={info("Boş bırakılan alan aktif parametre setinin değerini kullanır; gri yazı o değeri ve kaynağını gösterir.", "Tezgâh açıklaması")}>
          <div className={NARROW_GRID}>
            {num("loomRpm")}
            {num("efficiencyPct")}
            {pickVisible && <StructurePickField value={pick} onChange={setPick} disabled={!canWrite}
              placeholder={pickDefault && pickDefault.source !== "YAPI" ? `${fmtDecFull(pickDefault.amount, 4)} ${pickDefault.currency} · ${SOURCE_LABEL[pickDefault.source] ?? pickDefault.source}` : undefined} />}
          </div>
        </SectionCard>
        <SectionCard title="Boylar" titleExtra={info("Atkı boyu boşsa kartın tarak eninden, levent boyu boşsa parametre setinden gelir.", "Boylar açıklaması")}>
          <div className={NARROW_GRID}>
            {num("weftLengthCm")}
            {num("beamLengthM")}
          </div>
        </SectionCard>
        <SectionCard title="Fire ve çekme" titleExtra={info(`${WASTE_PRECEDENCE_TEXT} Ölçülmüş fire yalnız öneridir; Uygula forma yazar, kaydetmek sizin işinizdir.`, "Fire ve çekme açıklaması")}>
          <div className={NARROW_GRID}>
            {num("warpWastePct", measured && (
              <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                Ölçülen %{fmtQtyDecFull(measured.firePct, 2)} · {measured.leventSayisi} levent
                {canWrite && <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={() => set("warpWastePct", decToInput(measured.firePct))}>Uygula</Button>}
              </span>
            ))}
            {num("weftWastePct")}
            {num("fabricWastePct")}
            {num("lengthShrinkPct")}
          </div>
        </SectionCard>
        <FinishingCard rateCode={f.finishingRateCode} onRateCode={(v) => set("finishingRateCode", v)} label={f.extraCostLabel} onLabel={(v) => set("extraCostLabel", v)}
          rates={rates.data ?? []} disabled={!canWrite} flagged={flagged.has("finishingRateCode")} extraField={num("extraCostPerMTry")} />
        <ProcessesEditor codes={procs} onChange={setProcs} rates={rates.data ?? []} finishingCode={f.finishingRateCode} disabled={!canWrite} />
        <SectionCard title="Not">
          <label className="block text-sm"><span className="sr-only">Not</span>
            <Input aria-label="Not" disabled={!canWrite} maxLength={STRUCTURE_MAX.notes} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
        </SectionCard>
      </div>
      {canWrite && <StructureSaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} />}
    </div>
  );
}
