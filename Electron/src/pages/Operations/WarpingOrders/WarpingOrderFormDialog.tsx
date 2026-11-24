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
import { Calculator, ClipboardList, Coins, Layers } from "lucide-react";
import { FormCard, WideFormColumns, WideFormDialog } from "@/components/forms/WideFormDialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { BeamLinesFieldset, OrderIdentityFields, OrderNotesField, OrderTermsFields, SalesOrderLinks } from "./OrderFormFields";
import { PlanPreview } from "./PlanPreview";
import {
  buildOrderBody,
  editModeOf,
  emptyOrderForm,
  formFromOrder,
  previewBody,
  rememberExtraOptions,
  trimNum,
  type ExtraOptionMemo,
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
  const [extraMemo, setExtraMemo] = useState<ExtraOptionMemo | null>(null);
  const nextMemo = rememberExtraOptions(extraMemo, s.warpSpecId, preview);
  if (nextMemo !== extraMemo) setExtraMemo(nextMemo);
  const extraOptions = mergeSpecs(nextMemo?.options ?? [], order?.extraSpecs ?? []);
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
    <WideFormDialog
      open
      sectionsKey="warping-order.form"
      onOpenChange={(o) => !o && onClose()}
      title={order ? `${order.orderNo} — düzenle` : "Yeni fason devere siparişi"}
      description={
        !order
          ? "Çözgü kartı ve levent adedi × boy (adet belli değilse toplam metre) girin; iplik başına kg sunucuda hesaplanır ve siparişle birlikte saklanır."
          : planLocked
            ? "Sevk başladı: yalnız termin, ücret, tolerans, müşteri siparişi ve not değişir."
            : "Çözgü kartı ve devereci değişmez; levent değişirse iplik planı yeniden hesaplanır."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={save.isPending} className="min-w-32">
            {save.isPending ? "Kaydediliyor…" : order ? "Kaydet" : "Siparişi aç"}
          </Button>
        </>
      }
    >
      <WideFormColumns
        sideWidth="wide"
        main={
          <>
            <FormCard sectionId="order" sectionRequired title="Sipariş" icon={ClipboardList}>
              <div className="space-y-4">
                <OrderIdentityFields s={s} up={up} identityLocked={Boolean(order)} />
                <SalesOrderLinks s={s} up={up} />
              </div>
            </FormCard>
            <FormCard sectionId="beams" sectionRequired title="Leventler" icon={Layers}>
              <BeamLinesFieldset s={s} up={up} planLocked={planLocked} extraOptions={extraOptions} />
            </FormCard>
          </>
        }
        side={
          <FormCard sectionId="plan" title="İplik planı" icon={Calculator}>
            <PlanPreview order={order} planLocked={planLocked} pq={pq} hasBody={previewBody(s) !== null} fresh={Boolean(fresh)} />
          </FormCard>
        }
        after={
          <>
            <FormCard sectionId="terms" sectionError={error !== null} title="Ücret, termin ve fire" icon={Coins}>
              <OrderTermsFields s={s} up={up} planLocked={planLocked} feeAutoFill={!order} defaultFixedWasteM={preview ? trimNum(preview.fixedWasteM) : null} />
              <div className="mt-4">
                <OrderNotesField s={s} up={up} />
              </div>
            </FormCard>
            {error && (
              <Callout tone="danger" className="text-sm">
                {error}
              </Callout>
            )}
          </>
        }
      />
    </WideFormDialog>
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
