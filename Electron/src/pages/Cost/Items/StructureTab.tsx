// Yapı sekmesi: kart verisi salt-okunur + maliyet ekleri formu (`PUT structures/:itemId`, tam küme; boş = varsayılan).
// Ölçülmüş çözgü firesi yalnız ÖNERİ: "Uygula" forma yazar, kaydetmek kullanıcının işidir.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { cn } from "@/lib/utils";
import { finishingRateService } from "../FinishingRates/service";
import type { MeasuredWarpWaste } from "../shared/cost-types";
import { decToInput, fmtDecFull, toDecimalText } from "../shared/format";
import { CardSummary } from "./CardSummary";
import { ProcessesEditor } from "./ProcessesEditor";
import { StructurePickField } from "./StructurePickField";
import { isCostCurrency, showPickFields, useWeavingPickMethod, type PickPair } from "../shared/loom-pick";
import { STRUCTURE_FIELDS, STRUCTURE_MAX } from "./schema";
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
  const [f, setF] = useState<Form>(() => formOf(detail));
  const [procs, setProcs] = useState<string[]>(() => (detail.yapi?.processes ?? []).map((p) => p.rateCode));
  const pickVisible = showPickFields(useWeavingPickMethod(), { rate: detail.yapi?.loomPickRate, currency: detail.yapi?.loomPickCurrency });
  const [pick, setPick] = useState<PickPair>(() => ({
    rate: decToInput(detail.yapi?.loomPickRate ?? null),
    currency: isCostCurrency(detail.yapi?.loomPickCurrency) ? detail.yapi.loomPickCurrency : "",
  }));
  const rates = useQuery({ queryKey: ["cost-finishing-rates", "active"], queryFn: finishingRateService.listActive });
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));
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
  return (
    <div className="space-y-4">
      <CardSummary g={detail.girdi} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STRUCTURE_FIELDS.map((fd) => (
          <label key={fd.key} className="text-sm" data-field={fd.key}>
            <span className="text-muted-foreground">{fd.label} ({fd.unit})</span>
            <Input aria-label={`${fd.label} (${fd.unit})`} disabled={!canWrite} inputMode="decimal" placeholder="varsayılan"
              className={cn("mt-1 text-right tabular-nums", flagged.has(fd.key) && "ring-2 ring-destructive")} value={f[fd.key]} onChange={(e) => set(fd.key, e.target.value)} />
            {fd.key === "warpWastePct" && measured && (
              <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                Ölçülmüş %{fmtDecFull(measured.firePct, 2)} · {measured.leventSayisi} levent
                {canWrite && <Button type="button" size="sm" variant="ghost" className="h-6" onClick={() => set("warpWastePct", decToInput(measured.firePct))}>Uygula</Button>}
              </span>
            )}
          </label>
        ))}
        <label className="text-sm" data-field="finishingRateCode">
          <span className="text-muted-foreground">Fason tarifesi</span>
          <select aria-label="Fason tarifesi" disabled={!canWrite} value={f.finishingRateCode} onChange={(e) => set("finishingRateCode", e.target.value)}
            className={cn("mt-1 h-9 w-full rounded-md border bg-background px-2", flagged.has("finishingRateCode") && "ring-2 ring-destructive")}>
            <option value="">Ham satış (terbiye yok)</option>
            {(rates.data ?? []).map((r) => <option key={r.id} value={r.code}>{r.code} — {r.name} ({fmtDecFull(r.pricePerM)} {r.currency}/m)</option>)}
            {f.finishingRateCode && !(rates.data ?? []).some((r) => r.code === f.finishingRateCode) && <option value={f.finishingRateCode}>{f.finishingRateCode} (aktif değil)</option>}
          </select>
        </label>
        {pickVisible && <StructurePickField value={pick} onChange={setPick} disabled={!canWrite} />}
        <label className="text-sm"><span className="text-muted-foreground">Ek kalem etiketi</span>
          <Input className="mt-1" disabled={!canWrite} maxLength={STRUCTURE_MAX.extraCostLabel} value={f.extraCostLabel} onChange={(e) => set("extraCostLabel", e.target.value)} /></label>
        <label className="text-sm sm:col-span-2"><span className="text-muted-foreground">Not</span>
          <Input className="mt-1" disabled={!canWrite} maxLength={STRUCTURE_MAX.notes} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
      </div>
      <ProcessesEditor codes={procs} onChange={setProcs} rates={rates.data ?? []} finishingCode={f.finishingRateCode} disabled={!canWrite} />
      {canWrite && <Button onClick={() => save.mutate()} disabled={save.isPending}>Yapıyı kaydet</Button>}
    </div>
  );
}
