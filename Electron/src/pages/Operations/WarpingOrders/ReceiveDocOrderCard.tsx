// Dönüş kabul belgesinde SİPARİŞ KARTI (devere ek E2): deverecinin bir açık siparişi + o siparişe yerleşen levent
// satırları. Satırı olmayan kart belgeye girmez. "Plana göre doldur" sipariş planındaki adet × boyu getirir;
// yeniden sarım sütunu (C2) yalnız siparişin etkin "yeniden sarılsın" reddi varsa çizilir.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListPlus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/services/apiClient";
import { toast } from "sonner";
import { fmtM } from "./order-model";
import { draftsFromPlan, emptyBeamDraft, isBlankDraft, type ReceiveBeamDraft } from "./receive-model";
import { ReceiveBeamsTable, type ReceiveTableOptions } from "./ReceiveParts";
import { reworkCandidates } from "./rejection-model";
import { useWarpingRejections } from "./rejection-service";
import { WARPING_ORDERS_QUERY_KEY, warpingOrderService } from "./service";
import { WARPING_STATUS_META, type WarpingOrderRow } from "./types";

function CardTable({ orderId, drafts, onChange, options }: { orderId: string; drafts: ReceiveBeamDraft[]; onChange: (d: ReceiveBeamDraft[]) => void; options: ReceiveTableOptions }) {
  const rj = useWarpingRejections(orderId);
  return <ReceiveBeamsTable drafts={drafts} onChange={onChange} reworks={reworkCandidates(rj.data?.data ?? [])} options={{ ...options, minRows: 0 }} />;
}

export function ReceiveDocOrderCard({ order, drafts, onChange, options }: { order: WarpingOrderRow; drafts: ReceiveBeamDraft[]; onChange: (d: ReceiveBeamDraft[]) => void; options: ReceiveTableOptions }) {
  const qc = useQueryClient();
  const [filling, setFilling] = useState(false);
  const filled = drafts.filter((d) => !isBlankDraft(d)).length;
  const fillFromPlan = async () => {
    setFilling(true);
    try {
      const o = await qc.fetchQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "detail", order.id], queryFn: () => warpingOrderService.get(order.id), staleTime: 30_000 });
      onChange(draftsFromPlan(o.beamLines));
    } catch (e) {
      toast.error(apiErrorMessage(e, "Sipariş planı okunamadı."));
    } finally {
      setFilling(false);
    }
  };
  const meta = WARPING_STATUS_META[order.status];
  return (
    <section className="rounded-xl border border-card-border bg-card shadow-card" aria-label={`Sipariş ${order.orderNo}`}>
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <span className="font-semibold">{order.orderNo}</span>
        <span className="text-sm text-muted-foreground">{order.warpSpec.name}</span>
        <Badge className={`font-normal ${meta.badgeClass}`}>{meta.label}</Badge>
        <span className="text-xs text-muted-foreground">hedef {fmtM(order.targetLengthM)} m{order.beamCount ? ` · ${order.beamCount} levent` : ""}</span>
        <span className="ml-auto text-xs text-muted-foreground">{filled > 0 ? `bu kabulde ${filled} levent` : "bu irsaliyede yok"}</span>
      </header>
      <div className="px-4 py-3">
        {drafts.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onChange([emptyBeamDraft()])}><Plus className="mr-1 h-4 w-4" /> Levent ekle</Button>
            <Button size="sm" variant="outline" disabled={filling} onClick={() => void fillFromPlan()}><ListPlus className="mr-1 h-4 w-4" /> {filling ? "Getiriliyor…" : "Plana göre doldur"}</Button>
            <span className="text-xs text-muted-foreground">Bu siparişten levent gelmediyse boş bırakın — belgeye girmez.</span>
          </div>
        ) : (
          <CardTable orderId={order.id} drafts={drafts} onChange={onChange} options={options} />
        )}
      </div>
    </section>
  );
}
