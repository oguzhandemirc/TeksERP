// =============================================================================
// FASONDAKİ İPLİK — satırdan "İade al" / "Başka siparişe aktar"
// =============================================================================
// Yeni yazma yüzeyi YOK: devere sipariş sayfasının MEVCUT pencereleri (`YarnReturnDialog`, `TransferDialog`) ve uçları
// çağrılır, içleri değişmez. Satır (fasoncu × iplik × lot × sahip) birden çok siparişe dağılabilir → önce sipariş, iade
// için birden çok sevk kalemi varsa kalem seçilir. Pencere kapanınca Fasondaki İplik sorgusu tazelenir.
// =============================================================================
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmtFactoryDate } from "@/lib/factory-time";
import { apiErrorMessage } from "@/services/apiClient";
import { kg } from "../Yarn/qty";
import { holdsYarn, yarnNamesOf } from "../WarpingOrders/holding-model";
import { useWarpingHoldings } from "../WarpingOrders/holding-service";
import { useWarpingOrder } from "../WarpingOrders/service";
import { TransferDialog } from "../WarpingOrders/TransferDialog";
import { useWarpingDispatches } from "../WarpingOrders/yarn-service";
import { YarnReturnDialog } from "../WarpingOrders/YarnReturnDialog";
import type { WarpingYarnHolding } from "../WarpingOrders/holding-types";
import type { YarnRowAction } from "./columns";
import { CARRIED_LABEL, yarnLabel, type YarnAtSubLine } from "./model";
import { YARN_AT_SUB_QUERY_KEY } from "./service";

export interface RowActionTarget {
  row: YarnAtSubLine;
  action: YarnRowAction;
}

const ACTION_TITLE: Record<YarnRowAction, string> = { return: "iade al", transfer: "başka siparişe aktar" };

/** Satırın tuttuğu kalemler: aynı iplik + lot + sahip, bugün deverecide > 0. */
export function matchingHoldings(rows: readonly WarpingYarnHolding[], r: Pick<YarnAtSubLine, "yarnItemId" | "lotId" | "ownerCustomerId">): WarpingYarnHolding[] {
  return rows.filter((h) => h.yarnItemId === r.yarnItemId && (h.lotId ?? null) === (r.lotId ?? null) && (h.ownerCustomerId ?? null) === (r.ownerCustomerId ?? null) && Number(h.holdingKg) > 0);
}

interface ChoiceItem { key: string; title: string; hint: string }

function ChoiceDialog({ title, description, items, onPick, onClose }: { title: string; description: string; items: ChoiceItem[]; onPick: (key: string) => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border" role="list">
          {items.map((it) => (
            <li key={it.key}>
              <button type="button" className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={() => onPick(it.key)}>
                <span className="font-mono text-sm font-medium">{it.title}</span>
                <span className="text-xs text-muted-foreground">{it.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter><Button variant="outline" onClick={onClose}>Vazgeç</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoDialog({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </DialogHeader>
        <DialogFooter><Button variant="outline" onClick={onClose}>Kapat</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderAction({ orderId, row, action, onClose }: { orderId: string; row: YarnAtSubLine; action: YarnRowAction; onClose: () => void }) {
  const order = useWarpingOrder(orderId);
  const holdings = useWarpingHoldings(orderId);
  const dispatches = useWarpingDispatches(orderId);
  const [itemId, setItemId] = useState<string | null>(null);
  const title = `${yarnLabel(row)} — ${ACTION_TITLE[action]}`;
  if (order.isError || holdings.isError) return <InfoDialog title={title} text={apiErrorMessage(order.error ?? holdings.error)} onClose={onClose} />;
  if (!order.data || !holdings.data) return <InfoDialog title={title} text="Sipariş ve deverecideki kalemler yükleniyor…" onClose={onClose} />;
  const o = order.data;
  if (!holdsYarn(o.status)) return <InfoDialog title={title} text={`${o.orderNo} şu an iplik tutmuyor; işlem sipariş sayfasından yapılır.`} onClose={onClose} />;
  const names = yarnNamesOf(o);
  const match = matchingHoldings(holdings.data, row);
  if (match.length === 0) return <InfoDialog title={title} text={`${o.orderNo} bu iplikten (${row.lotNo ? `lot ${row.lotNo}` : "lotsuz"}) artık tutmuyor — liste tazelenince satır güncellenir.`} onClose={onClose} />;
  if (action === "transfer") return <TransferDialog order={o} holdings={match} names={names} onClose={onClose} />;
  const picked = match.length === 1 ? match[0] : match.find((h) => h.dispatchItemId === itemId);
  if (!picked) {
    return (
      <ChoiceDialog title={title} description={`${o.orderNo} bu ipliği birden çok sevk kaleminde tutuyor — hangisinden iade alınacak?`}
        items={match.map((h) => ({ key: h.dispatchItemId, title: h.dispatchNo, hint: `${h.own ? `${fmtFactoryDate(h.dispatchedAt)} sevki` : "aktarımla gelen"} · deverecide ${kg(h.holdingKg)}` }))}
        onPick={setItemId} onClose={onClose} />
    );
  }
  const exit = dispatches.data?.flatMap((d) => d.items).find((i) => i.dispatchItemId === picked.dispatchItemId)?.warehouseName ?? null;
  return <YarnReturnDialog orderId={o.id} holding={picked} names={names} exitWarehouseName={exit} onClose={onClose} />;
}

export function RowActionHost({ target, onClose }: { target: RowActionTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const { row, action } = target;
  const [orderId, setOrderId] = useState<string | null>(row.orders.length === 1 ? row.orders[0]!.warpingOrderId : null);
  const close = () => {
    void qc.invalidateQueries({ queryKey: [YARN_AT_SUB_QUERY_KEY] });
    onClose();
  };
  if (!orderId) {
    return (
      <ChoiceDialog title={`${yarnLabel(row)} — ${ACTION_TITLE[action]}`} description={`Bu iplik ${row.orders.length} siparişe sayılıyor — işlem hangi siparişin ipliğinde yapılacak?`}
        items={row.orders.map((o) => ({ key: o.warpingOrderId, title: o.orderNo, hint: `${kg(o.kg)}${o.status === "COMPLETED" ? ` · ${CARRIED_LABEL}` : ""}` }))}
        onPick={setOrderId} onClose={onClose} />
    );
  }
  return <OrderAction orderId={orderId} row={row} action={action} onClose={close} />;
}
