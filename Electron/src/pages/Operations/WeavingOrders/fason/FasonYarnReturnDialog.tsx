// =============================================================================
// FASON DOKUMA (G1p) — İPLİK DÖNÜŞÜ (SUBCONTRACT_RETURN) ve dönüş STORNOSU (SUBCONTRACT_RETURN_CANCEL)
// =============================================================================
// Dönüş: sevkteki iplik kaleminden kısmi kg; sebep kodu ZORUNLU (`YARN_SUBCONTRACT_RETURN` kataloğu);
// depo varsayılan çıkışınki (fason başka depoya teslim edebilir — H2). ÖNİZLEME: gövde gönderilmeden
// "ne olacak" satırı (hangi depoya kaç kg döner, kalemde kaç kg kalır). Storno: dönüş satırı seçilir,
// gerekçe ≥ 3; önizleme aynı biçimde (depodan −kg, fasonda +kg).
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { reasonPresetService } from "@/pages/ReasonPresets/service";
import { formatKg } from "@/pages/Operations/WarpBeams/types";
import { openYarnItems, openYarnReturns } from "./fason-summary";
import type { FasonYarnReturnBody } from "./service";
import type { FasonDispatch, FasonYarnItem } from "./types";

interface ReturnProps {
  target: FasonDispatch;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (b: { dispatchId: string; dispatchItemId: string } & FasonYarnReturnBody) => void;
}

export function FasonYarnReturnDialog({ target, isPending, onClose, onConfirm }: ReturnProps) {
  const items = openYarnItems(target);
  const [itemId, setItemId] = useState(items[0]?.dispatchItemId ?? "");
  const [kg, setKg] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  const presets = useQuery({ queryKey: ["reason-presets", "YARN_SUBCONTRACT_RETURN", "fason"], queryFn: () => reasonPresetService.list(false) });
  const reasons = useMemo(() => (presets.data ?? []).filter((p) => p.kind === "YARN_SUBCONTRACT_RETURN" && p.isActive), [presets.data]);
  const item = items.find((it) => it.dispatchItemId === itemId) ?? null;
  const n = Number(kg);
  const exceeds = item !== null && Number.isFinite(n) && n > item.remainingKg;
  const ok = item !== null && kg.trim() !== "" && Number.isFinite(n) && n > 0 && !exceeds && reasonCode !== "";
  const targetWh = warehouses.find((w) => w.id === (warehouseId || item?.warehouseId))?.name ?? "çıkış deposu";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sevk {target.dispatchNo} — iplik döndü</DialogTitle>
          <DialogDescription>Dönüş depoya +kg yazar; toplam dönüş gideni aşamaz. Sebep zorunludur; dönüş satırı sonradan storno edilebilir.</DialogDescription>
        </DialogHeader>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu sevkte fasonda kalan iplik yok.</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>İplik kalemi</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger><SelectValue placeholder="Kalem seç" /></SelectTrigger>
                <SelectContent>
                  {items.map((it) => (
                    <SelectItem key={it.dispatchItemId} value={it.dispatchItemId}>{it.item.code} · kalan {formatKg(it.remainingKg)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fyr-kg">Dönen kg</Label>
              <Input id="fyr-kg" type="number" min={0.001} step="0.001" value={kg} onChange={(e) => setKg(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1">
              <Label>Sebep</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger><SelectValue placeholder={reasons.length ? "Sebep seç" : "Katalogda dönüş sebebi yok"} /></SelectTrigger>
                <SelectContent>
                  {reasons.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {multiWarehouse && (
              <div className="space-y-1">
                <Label>Dönüş deposu (boş = çıkış deposu)</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger><SelectValue placeholder="Çıkış deposu" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {exceeds && <Callout tone="warning">Dönen kg kalemde kalanı ({formatKg(item?.remainingKg)}) aşıyor.</Callout>}
            {ok && item && (
              <Callout tone="info">
                Önizleme: <b>{formatKg(n)}</b> {item.item.code} → <b>{targetWh}</b> deposuna döner; fasonda kalan {formatKg(item.remainingKg)} → {formatKg(item.remainingKg - n)}.
              </Callout>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Vazgeç</Button>
          <Button disabled={!ok || isPending} onClick={() => onConfirm({ dispatchId: target.id, dispatchItemId: itemId, qtyKg: n, reasonCode, ...(warehouseId ? { warehouseId } : {}) })}>Dönüşü kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CancelProps {
  target: FasonDispatch;
  item: FasonYarnItem;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (b: { dispatchId: string; dispatchItemId: string; movementId: string; reason: string }) => void;
}

/** Dönüş STORNOSU — açık dönüş satırı seçilir; storno edilmiş satırlar (aynı depo/lot/sebep net'i) listelenmez. */
export function FasonYarnReturnCancelDialog({ target, item, isPending, onClose, onConfirm }: CancelProps) {
  const openReturns = useMemo(() => openYarnReturns(item), [item]);
  const [movementId, setMovementId] = useState(openReturns[0]?.movementId ?? "");
  const [reason, setReason] = useState("");
  const { warehouses } = useMultiWarehouse();
  const row = openReturns.find((r) => r.movementId === movementId) ?? null;
  const whName = warehouses.find((w) => w.id === row?.warehouseId)?.name ?? "depo";
  const ok = row !== null && reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item.item.code} — dönüşü geri al</DialogTitle>
          <DialogDescription>Storno depodan −kg yazar, iplik yeniden fasonda sayılır. Dönüş satırı silinmez; karşı satır yazılır.</DialogDescription>
        </DialogHeader>
        {openReturns.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geri alınacak açık dönüş yok.</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Dönüş satırı</Label>
              <Select value={movementId} onValueChange={setMovementId}>
                <SelectTrigger><SelectValue placeholder="Satır seç" /></SelectTrigger>
                <SelectContent>
                  {openReturns.map((r) => (
                    <SelectItem key={r.movementId} value={r.movementId}>{formatKg(r.qtyKg)} · {r.reasonCode ?? "—"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fyrc-reason">Gerekçe (en az 3 karakter)</Label>
              <Textarea id="fyrc-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
            </div>
            {row && (
              <Callout tone="info">
                Önizleme: <b>{formatKg(row.qtyKg)}</b> {whName} deposundan düşer; fasonda kalan {formatKg(item.remainingKg)} → {formatKg(item.remainingKg + row.qtyKg)}.
              </Callout>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ok || isPending} onClick={() => onConfirm({ dispatchId: target.id, dispatchItemId: item.dispatchItemId, movementId, reason: reason.trim() })}>Dönüşü geri al</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
