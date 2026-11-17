// =============================================================================
// DEVERECİDEN İPLİK İADESİ — tutma satırından kısmi kg → `POST /:id/yarn-returns` (D6b-2)
// =============================================================================
// Sebep ZORUNLU (`YARN_SUBCONTRACT_RETURN` kataloğu, çip düğmeleri — açılır liste yok); depo varsayılan sevkin
// çıkış deposu, çok depolu kurulumda modal seçiciyle değişir. Aktarımla gelen kalemde iade asıl siparişe geri
// aktarım belgesi de yazar (sunucu). Ön bilgi satırı "ne olacak"ı söyler; karar sunucuda.
// =============================================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { cn } from "@/lib/utils";
import { toastServerSuccess } from "@/lib/serverNotes";
import { reasonPresetService } from "@/pages/ReasonPresets/service";
import { checkKg, yarnCode, type YarnNames } from "./holding-model";
import { warpingHoldingService } from "./holding-service";
import { fmtKg } from "./order-model";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import { SourcePicker } from "./YarnSourcePickers";
import type { PickedRef } from "./dispatch-model";
import type { WarpingYarnHolding } from "./holding-types";

function ReasonChips({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const q = useQuery({ queryKey: ["reason-presets", "YARN_SUBCONTRACT_RETURN", "devere"], queryFn: () => reasonPresetService.list(false) });
  const reasons = useMemo(() => (q.data ?? []).filter((p) => p.kind === "YARN_SUBCONTRACT_RETURN" && p.isActive), [q.data]);
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Sebepler yükleniyor…</p>;
  if (reasons.length === 0) return <Callout tone="warning">Katalogda “Fasondan iplik dönüşü” sebebi yok — Tanımlar › Sebep Kataloğu’ndan ekleyin.</Callout>;
  return (
    <div role="radiogroup" aria-label="İade sebebi" className="flex flex-wrap gap-2">
      {reasons.map((r) => (
        <button key={r.code} type="button" role="radio" aria-checked={value === r.code} onClick={() => onChange(r.code)}
          className={cn("rounded-full border px-3 py-1 text-sm hover:bg-muted", value === r.code && "border-primary bg-primary/10 font-medium text-primary")}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

function ReturnWarehouseField({ exitName, value, onChange }: { exitName: string; value: PickedRef | null; onChange: (v: PickedRef | null) => void }) {
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  if (!multiWarehouse) return null;
  return (
    <FormField label="İade deposu" hint={`Boş bırakılırsa sevkin çıkış deposu (${exitName}).`}>
      <SourcePicker title="İade deposu" description="İplik bu depoya geri girer." placeholder={`Çıkış deposu — ${exitName}`} ariaLabel="İade deposu seç"
        value={value} onChange={onChange} clearable queryKey={["warping-return", "warehouses", warehouses.length]} emptyText="Aktif depo yok."
        load={async () => warehouses.map((w) => ({ id: w.id, label: w.name, hint: w.code, balanceKg: null }))} />
    </FormField>
  );
}

interface Props {
  orderId: string;
  holding: WarpingYarnHolding;
  names: YarnNames;
  exitWarehouseName: string | null;
  onClose: () => void;
}

export function YarnReturnDialog({ orderId, holding, names, exitWarehouseName, onClose }: Props) {
  const qc = useQueryClient();
  const [kg, setKg] = useState(String(Number(holding.holdingKg)).replace(".", ","));
  const [reasonCode, setReasonCode] = useState("");
  const [warehouse, setWarehouse] = useState<PickedRef | null>(null);
  const check = checkKg(kg, holding.holdingKg);
  const code = yarnCode(names, holding.yarnItemId);
  const exitName = exitWarehouseName ?? "çıkış deposu";
  const save = useMutation({
    mutationFn: (qty: number) => warpingHoldingService.returnYarn(orderId, { dispatchItemId: holding.dispatchItemId, qtyKg: qty, reasonCode, ...(warehouse ? { warehouseId: warehouse.id } : {}) }),
    onSuccess: (res) => {
      toastServerSuccess(res, "İade alındı.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onClose();
    },
  });
  const ok = check.ok && reasonCode !== "";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{code} — devereciden iade al</DialogTitle>
          <DialogDescription>
            {holding.dispatchNo} · {holding.lotNo ? `lot ${holding.lotNo}` : "lotsuz"} · deverecide {fmtKg(holding.holdingKg)} kg. İade depoya ayrı satırla girer; sevk rakamı değişmez, iade sonradan geri alınabilir.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <FormField label="İade kg" htmlFor="wr-kg" required error={!check.ok && check.error ? { message: check.error } : undefined}>
            <Input id="wr-kg" inputMode="decimal" autoFocus value={kg} onChange={(e) => setKg(e.target.value)} />
          </FormField>
          <FormField label="Sebep" required><ReasonChips value={reasonCode} onChange={setReasonCode} /></FormField>
          <ReturnWarehouseField exitName={exitName} value={warehouse} onChange={setWarehouse} />
          {check.ok && (
            <Callout tone="info">
              {fmtKg(check.qty)} kg {code} depoya girer (<b>{warehouse?.label ?? exitName}</b>); deverecide {fmtKg(holding.holdingKg)} → {fmtKg(Number(holding.holdingKg) - check.qty)} kg.
              {!holding.own && " Kalem başka siparişten aktarımla geldi — iade asıl siparişe geri aktarım belgesi de yazar."}
            </Callout>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!ok || save.isPending} onClick={() => check.ok && save.mutate(check.qty)}>
            {save.isPending ? "Kaydediliyor…" : "İadeyi kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
