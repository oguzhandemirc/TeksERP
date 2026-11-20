// =============================================================================
// DEVERECİDEN İPLİK İADESİ (+ FİRE) — tutma satırından kısmi kg → `POST /:id/yarn-returns` (D6b-2, iade-fire 11-19)
// =============================================================================
// İade kg + isteğe bağlı "kullanılamaz (fire)" kg; sebep açılır listeden ZORUNLU, fire gerekçesi serbest metin. Canlı
// özet girişten; tolerans ve "sipariş kapanır" bilgisi önizleme ucundan (`…/yarn-returns/preview`). Tolerans aşımı
// engellemez, onay kutusu ister. Token MANTIKSAL DENEME başına (`useAttemptToken`); başarı tostu sunucu mesajı.
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { checkReturn, kgInput, remainingAsWaste, yarnTitle, type ReturnCheck, type YarnNames } from "./holding-model";
import { warpingHoldingService } from "./holding-service";
import { fmtKg } from "./order-model";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import { PieceCountFields, ReasonSelect, ReturnPreviewNotes, ReturnSummary, ReturnWarehouseField } from "./YarnReturnParts";
import { pieceCountFields, type PickedRef } from "./dispatch-model";
import type { WarpingYarnHolding } from "./holding-types";

interface Props {
  orderId: string;
  holding: WarpingYarnHolding;
  names: YarnNames;
  exitWarehouseName: string | null;
  onClose: () => void;
}

/** Önizleme — geçerli girdinin 300 ms durulmuş hâliyle; `fresh` = görünen önizleme şu anki girdiye ait. */
function useReturnPreview(orderId: string, holding: WarpingYarnHolding, check: ReturnCheck) {
  const key = check.ok ? `${check.qty}|${check.waste}` : null;
  const settled = useDebouncedValue(key);
  const q = useQuery({
    // Sipariş önbellek ön ekinin DIŞINDA: kayıt sonrası toplu tazeleme, kapanan pencerenin önizlemesini (artık tutma yok → 404) yeniden çağırmasın.
    queryKey: ["warping-return-preview", orderId, holding.dispatchItemId, settled],
    queryFn: () => {
      const [qty, waste] = settled!.split("|").map(Number);
      return warpingHoldingService.returnPreview(orderId, { dispatchItemId: holding.dispatchItemId, qtyKg: qty!, wasteKg: waste || null });
    },
    enabled: settled !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return { data: q.data, fresh: key !== null && settled === key && q.isSuccess, key };
}

function useReturnForm(holding: WarpingYarnHolding) {
  const [kg, setKg] = useState(kgInput(Number(holding.holdingKg)));
  const [wasteKg, setWasteKg] = useState("");
  const [wasteReason, setWasteReason] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [warehouse, setWarehouse] = useState<PickedRef | null>(null);
  const [packageCount, setPackageCount] = useState("");
  const [bobbinCount, setBobbinCount] = useState("");
  const pieces = pieceCountFields(packageCount, bobbinCount);
  const check = checkReturn(kg, wasteKg, holding.holdingKg);
  const fillWaste = remainingAsWaste(kg, holding.holdingKg);
  return { kg, setKg, wasteKg, setWasteKg, wasteReason, setWasteReason, reasonCode, setReasonCode, warehouse, setWarehouse, check, fillWaste, packageCount, setPackageCount, bobbinCount, setBobbinCount, pieces };
}

export function YarnReturnDialog({ orderId, holding, names, exitWarehouseName, onClose }: Props) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const f = useReturnForm(holding);
  const pv = useReturnPreview(orderId, holding, f.check);
  const [ackKey, setAckKey] = useState<string | null>(null);
  const ack = ackKey !== null && ackKey === pv.key; // onay girdiye bağlı: girdi değişince düşer
  const title = yarnTitle(names, holding.yarnItemId);
  const exitName = exitWarehouseName ?? "çıkış deposu";
  const save = useMutation({
    mutationFn: (c: { qty: number; waste: number }) => warpingHoldingService.returnYarn(orderId, {
      dispatchItemId: holding.dispatchItemId, qtyKg: c.qty, reasonCode: f.reasonCode, ...(f.warehouse ? { warehouseId: f.warehouse.id } : {}),
      ...(c.waste > 0 ? { wasteKg: c.waste, wasteReason: f.wasteReason.trim() || null } : {}), ...f.pieces, clientToken: attempt.token(),
    }),
    onSuccess: (res) => {
      attempt.onSuccess();
      toastServerSuccess(res, "İade alındı.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onClose();
    },
    onError: (e) => attempt.onFailure(e),
  });
  const waste = f.check.ok ? f.check.waste : 0;
  // Fire varsa tolerans önizlemesi görülmeden kaydedilmez; aşımda onay kutusu şart.
  const previewOk = waste === 0 || (pv.fresh && (!pv.data!.overTolerance || ack));
  const ok = f.check.ok && f.reasonCode !== "" && previewOk && f.pieces !== null;
  const qtyErr = !f.check.ok && f.check.field === "qty" && f.check.error ? { message: f.check.error } : undefined;
  const wasteErr = !f.check.ok && f.check.field === "waste" && f.check.error ? { message: f.check.error } : undefined;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {title.primary} — devereciden iade al{title.secondary && <span className="ml-2 text-sm font-normal text-muted-foreground">{title.secondary}</span>}
          </DialogTitle>
          <DialogDescription>
            {holding.dispatchNo} · {holding.lotNo ? `lot ${holding.lotNo}` : "lotsuz"} · deverecide <b>{fmtKg(holding.holdingKg)} kg</b>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="İade kg" htmlFor="wr-kg" required error={qtyErr} info="Depoya geri giren iplik. İade depoya ayrı satırla girer; sevk rakamı değişmez, iade sonradan geri alınabilir.">
              <Input id="wr-kg" inputMode="decimal" autoFocus value={f.kg} onChange={(e) => f.setKg(e.target.value)} />
            </FormField>
            <FormField label="Kullanılamaz (fire) kg" htmlFor="wr-waste" error={wasteErr}
              info="Depoya dönmeyen, kullanılamaz iplik. Kapanış firesiyle aynı deftere yazılır; iade geri alınırsa bu fire de geri alınır. Boş = yalnız iade.">
              <div className="flex gap-2">
                <Input id="wr-waste" inputMode="decimal" placeholder="Boş = yok" value={f.wasteKg} onChange={(e) => f.setWasteKg(e.target.value)} />
                <Button type="button" variant="outline" className="shrink-0" disabled={f.fillWaste === null} onClick={() => f.fillWaste !== null && f.setWasteKg(f.fillWaste)}>
                  Kalanın hepsini fire yaz
                </Button>
              </div>
            </FormField>
            <FormField label="İade sebebi" htmlFor="wr-reason" required><ReasonSelect id="wr-reason" value={f.reasonCode} onChange={f.setReasonCode} /></FormField>
            <ReturnWarehouseField exitName={exitName} value={f.warehouse} onChange={f.setWarehouse} />
            <PieceCountFields packageCount={f.packageCount} bobbinCount={f.bobbinCount} onPackage={f.setPackageCount} onBobbin={f.setBobbinCount} />
            {waste > 0 && (
              <FormField label="Fire gerekçesi" htmlFor="wr-waste-reason" className="col-span-2" info="İsteğe bağlı; kapanış firesindeki gerekçeyle aynı serbest metin.">
                <Input id="wr-waste-reason" maxLength={300} placeholder="Ör. kopuk, ıslak, karışmış bobin" value={f.wasteReason} onChange={(e) => f.setWasteReason(e.target.value)} />
              </FormField>
            )}
          </div>
          {f.check.ok && <ReturnSummary qty={f.check.qty} waste={f.check.waste} keep={f.check.keep} warehouseName={f.warehouse?.label ?? exitName} />}
          {!f.check.ok && f.check.field === "total" && <p role="alert" className="text-destructive">{f.check.error}</p>}
          {f.check.ok && !holding.own && <p className="text-muted-foreground">Kalem başka siparişten aktarımla geldi — iade asıl siparişe geri aktarım belgesi de yazar.</p>}
          {pv.fresh && pv.data && <ReturnPreviewNotes p={pv.data} ack={ack} onAck={(v) => setAckKey(v ? pv.key : null)} />}
          {f.check.ok && waste > 0 && !pv.fresh && <p className="text-muted-foreground">Fire toleransı denetleniyor…</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!ok || save.isPending} onClick={() => f.check.ok && save.mutate({ qty: f.check.qty, waste: f.check.waste })}>
            {save.isPending ? "Kaydediliyor…" : "İadeyi kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
