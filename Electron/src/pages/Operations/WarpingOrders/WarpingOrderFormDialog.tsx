// =============================================================================
// FASON DEVERE SİPARİŞİ — yeni / düzenle diyaloğu (plan E5)
// =============================================================================
// Kaydetmeden önce plan tablosu canlı önizlemeden (`POST /preview`, yazmaz). Plan kg'ı SUNUCUDA hesaplanır ve donar.
// `clientToken` mantıksal deneme başına (`useAttemptToken`): belirsiz hatada yapışır, kesin 4xx'te yenilenir.
// Düzenleme: OPEN → plan + meta; IN_PROGRESS (sevkli) → yalnız meta (plan anahtarı gönderilmez).
// Hata toast'ı apiClient interceptor'ında; burada ikinci toast YOK.
// =============================================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { apiErrorMessage } from "@/services/apiClient";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { OrderFormFields } from "./OrderFormFields";
import { PlanTable } from "./PlanTable";
import {
  buildOrderBody,
  editModeOf,
  emptyOrderForm,
  fmtM,
  formFromOrder,
  previewBody,
  trimNum,
  type WarpingOrderFormState,
} from "./order-model";
import { useWarpingPreview, warpingOrderService, WARPING_ORDERS_QUERY_KEY } from "./service";
import type { SpecRef, WarpingOrder } from "./types";

interface Props {
  /** Düzenlenecek sipariş; yoksa yeni. */
  order?: WarpingOrder;
  /** Yeni siparişte dolu gelecek alanlar (Çözgü Hesabı'ndan). */
  seed?: Partial<WarpingOrderFormState>;
  onClose: () => void;
  onSaved: (id: string) => void;
}

export function WarpingOrderFormDialog({ order, seed, onClose, onSaved }: Props) {
  const mode = order ? editModeOf(order.status) : "create";
  const [s, setS] = useState<WarpingOrderFormState>(() =>
    order ? formFromOrder(order) : emptyOrderForm(stripNull(seed)),
  );
  const [error, setError] = useState<string | null>(null);
  const up = (patch: Partial<WarpingOrderFormState>) => {
    setError(null);
    setS((x) => ({ ...x, ...patch }));
  };
  const planLocked = mode === "edit-meta";
  const pq = useWarpingPreview(planLocked ? null : previewBody(s));
  const preview = pq.data?.data;
  const fresh = preview && preview.warpSpec.id === s.warpSpecId;
  const extraOptions = mergeSpecs(preview?.suggestedExtraSpecs ?? [], order?.extraSpecs ?? []);
  const attempt = useAttemptToken();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: ReturnType<typeof buildOrderBody> & { ok: true }) =>
      order
        ? warpingOrderService.update(order.id, body.body)
        : warpingOrderService.create(body.body, attempt.token()),
    onSuccess: (res) => {
      attempt.onSuccess();
      toastServerSuccess(res, order ? "Sipariş güncellendi." : "Sipariş açıldı.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onSaved(res.data.id);
    },
    onError: (e) => attempt.onFailure(e),
  });
  if (mode === null) return null;
  const submit = () => {
    const r = buildOrderBody(s, mode);
    if (!r.ok) return setError(r.error);
    save.mutate(r);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{order ? `${order.orderNo} — düzenle` : "Yeni fason devere siparişi"}</DialogTitle>
          <DialogDescription>
            {!order
              ? "Çözgü kartı ve levent adedi × boy girin; iplik başına kg sunucuda hesaplanır ve siparişle birlikte saklanır."
              : planLocked
                ? "Sevk başladı: yalnız termin, ücret, tolerans, müşteri siparişi ve not değişir."
                : "Çözgü kartı ve devereci değişmez; levent değişirse iplik planı yeniden hesaplanır."}
          </DialogDescription>
        </DialogHeader>
        <OrderFormFields
          s={s}
          up={up}
          identityLocked={Boolean(order)}
          planLocked={planLocked}
          extraOptions={extraOptions}
          defaultFixedWasteM={preview ? trimNum(preview.fixedWasteM) : null}
        />
        <section className="space-y-2" aria-label="Plan önizlemesi" aria-busy={pq.isFetching}>
          <h3 className="text-sm font-medium">İplik planı</h3>
          {planLocked && order ? (
            <PlanTable yarns={order.yarns} hasWaste={order.hasWaste} totals={order.totals} />
          ) : pq.isError ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {apiErrorMessage(pq.error)}
            </p>
          ) : !previewBody(s) ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Plan için çözgü kartı seçin ve her levent satırına adet ile boy yazın.
            </p>
          ) : !fresh ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Hesaplanıyor…
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {preview.beamCount} levent · {fmtM(preview.targetLengthM)} m çözgü
                {preview.stock.known ? "" : " · iplik stoğu bilinmiyor (iplik modülü kapalı)"}
              </p>
              <PlanTable
                yarns={preview.yarns}
                hasWaste={preview.hasWaste}
                totals={preview.totals}
                showStock={preview.stock.known}
              />
            </>
          )}
        </section>
        {error && (
          <Callout tone="danger" className="text-sm">
            {error}
          </Callout>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Kaydediliyor…" : order ? "Kaydet" : "Siparişi aç"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function mergeSpecs(a: SpecRef[], b: SpecRef[]): SpecRef[] {
  const out = [...a];
  for (const x of b) if (!out.some((y) => y.id === x.id)) out.push(x);
  return out;
}

function stripNull(seed?: Partial<WarpingOrderFormState>): Partial<WarpingOrderFormState> | undefined {
  if (!seed) return undefined;
  return Object.fromEntries(
    Object.entries(seed).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<WarpingOrderFormState>;
}
