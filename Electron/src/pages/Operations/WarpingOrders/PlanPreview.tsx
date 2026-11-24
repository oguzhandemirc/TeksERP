// Sipariş formunun "İplik planı" kartı: kilitliyse kayıtlı plan, değilse sunucu önizlemesi (yazmaz).
// Kayıtlı plan fire kaynağını saklamaz → sipariş sayfasıyla AYNI `useOrderWasteSource` (açık görünümle aynı etiket).
import { apiErrorMessage } from "@/services/apiClient";
import { PlanTable } from "./PlanTable";
import { fmtM, isBeamCountOpen } from "./order-model";
import type { useWarpingPreview } from "./service";
import type { WarpingOrder } from "./types";
import { useOrderWasteSource } from "./useOrderWasteSource";

interface Props {
  order?: WarpingOrder;
  planLocked: boolean;
  pq: ReturnType<typeof useWarpingPreview>;
  hasBody: boolean;
  fresh: boolean;
}

function LockedPlan({ order }: { order: WarpingOrder }) {
  const sourceOf = useOrderWasteSource(order);
  return <PlanTable yarns={order.yarns} hasWaste={order.hasWaste} totals={order.totals} sourceOf={sourceOf} />;
}

/** Plan önizlemesi; iplik ADI birincil (PlanTable). */
export function PlanPreview({ order, planLocked, pq, hasBody, fresh }: Props) {
  const preview = pq.data?.data;
  return (
    <section className="space-y-2" aria-label="Plan önizlemesi" aria-busy={pq.isFetching}>
      {planLocked && order ? (
        <LockedPlan order={order} />
      ) : pq.isError ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {apiErrorMessage(pq.error)}
        </p>
      ) : !hasBody ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Plan için çözgü kartı seçin ve her levent satırına adet ile boy (ya da adet belli değilse toplam metre) yazın.</p>
      ) : !fresh || !preview ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Hesaplanıyor…</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {isBeamCountOpen(preview) ? `Hedef ${fmtM(preview.targetLengthM)} m · adet belli değil` : `${preview.beamCount} levent · ${fmtM(preview.targetLengthM)} m çözgü`}
            {preview.stock.known ? "" : " · iplik stoğu bilinmiyor (iplik modülü kapalı)"}
          </p>
          <PlanTable yarns={preview.yarns} hasWaste={preview.hasWaste} totals={preview.totals} showStock={preview.stock.known} />
        </>
      )}
    </section>
  );
}
