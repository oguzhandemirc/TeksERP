// =============================================================================
// SİPARİŞ KAPANIŞI — kalan iplik kalem kalem İADE / FİRE / DEVERECİDE KALIR → `POST /:id/settle` (plan E9, D7b)
// =============================================================================
// Açılışta `GET /:id/settlement-preview` sunucunun varsayılanını (`devere.settleDefault` kipi; varsayılan A1-a: fire = min(kalan, plan fire payı), fazlası kalır)
// getirir; satırlar onunla dolu ve o önizleme tazedir. Kullanıcı değiştirince "Önizle" (`POST …/settle/preview`) ister;
// girdi önizlemeden sonra değişirse "Kapat" kapanır. Tolerans aşımı yalnız uyarır, gerekçe İSTEĞE BAĞLI.
// =============================================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WideFormDialog } from "@/components/forms/WideFormDialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/info-popover";
import { flagSettingTrail } from "@/lib/flag-setting-path";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { apiErrorMessage } from "@/services/apiClient";
import { yarnNamesOf } from "./holding-model";
import { parseNum } from "./order-model";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import { buildSettleBody, draftsFromPlan, settleSuggestionText, type SettleLineDraft } from "./settle-model";
import { warpingSettleService } from "./settle-service";
import { SettleLinesTable, SettlePreviewView } from "./SettleParts";
import { useWarpingDispatches } from "./yarn-service";
import { ReasonSelect } from "./YarnReturnParts";
import type { WarpingOrder } from "./types";
import type { WarpingSettleFields, WarpingSettlePreview } from "./settle-types";

function PreviewNotes({ p }: { p: WarpingSettlePreview }) {
  return (
    <>
      {p.blockers.length > 0 && <Callout tone="danger"><ul className="list-disc pl-4">{p.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></Callout>}
      {p.warnings.length > 0 && <Callout tone="warning" title="Kontrol edin"><ul className="list-disc pl-4" aria-label="Uyarılar">{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Callout>}
    </>
  );
}

function useSettleForm(order: WarpingOrder, initial: WarpingSettlePreview) {
  const [drafts, setDrafts] = useState<SettleLineDraft[]>(() => draftsFromPlan(initial.plan.lines));
  const [reason, setReason] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const built = buildSettleBody(drafts, { reason, returnReasonCode: reasonCode });
  const dq = useWarpingDispatches(order.id);
  const exitNames = useMemo(() => new Map((dq.data ?? []).flatMap((d) => d.items.map((it) => [it.dispatchItemId, it.warehouseName ?? "çıkış deposu"] as const))), [dq.data]);
  const anyReturn = drafts.some((d) => (parseNum(d.returnKg) ?? 0) > 0);
  return { drafts, setDrafts, reason, setReason, reasonCode, setReasonCode, built, anyReturn, body: built.ok ? built.body : null, key: built.ok ? JSON.stringify(built.body) : null, exitNames };
}

// Geniş form iskeleti (WideFormDialog): kapanış tablosu yedi sütun + iade deposu taşıdığı için dar modalda yatay
// taşıyordu; gövde kendi kaydırıcısında, alt düğmeler hep görünür. Tablo yalnız çok dar ekranda kendi içinde kayar.
const DESCRIPTION = (
  <>Deverecide kalan iplik her satırda üçe bölünür: <b>iade</b> depoya döner, <b>fire</b> kayıp yazılır, <b>kalır</b> deverecide durur ve sonraki siparişe devreder. Satırlar fabrika ayarındaki öneriyle dolu gelir.</>
);

function SettleForm({ order, initial, onClose }: { order: WarpingOrder; initial: WarpingSettlePreview; onClose: () => void }) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const f = useSettleForm(order, initial);
  const names = useMemo(() => yarnNamesOf(order), [order]);
  const [preview, setPreview] = useState<{ key: string | null; data: WarpingSettlePreview }>(() => ({ key: f.key, data: initial }));
  const pv = useMutation({ mutationFn: (b: WarpingSettleFields) => warpingSettleService.preview(order.id, b), onSuccess: (data, b) => setPreview({ key: JSON.stringify(b), data }) });
  const save = useMutation({
    mutationFn: (b: WarpingSettleFields) => warpingSettleService.settle(order.id, { ...b, clientToken: attempt.token() }),
    onSuccess: (res) => { attempt.onSuccess(); toastServerSuccess(res, "Sipariş kapandı."); void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] }); onClose(); },
    onError: (e) => attempt.onFailure(e),
  });
  const fresh = preview.key !== null && preview.key === f.key;
  const over = fresh && preview.data.plan.overTolerance;
  const footer = (
    <>
      <Button variant="outline" onClick={onClose}>Vazgeç</Button>
      <Button variant="outline" disabled={!f.body || pv.isPending} onClick={() => f.body && pv.mutate(f.body)}>{pv.isPending ? "Önizleniyor…" : "Önizle"}</Button>
      <Button disabled={!fresh || !f.body || !preview.data.canSettle || save.isPending} onClick={() => f.body && save.mutate(f.body)}>{save.isPending ? "Kapatılıyor…" : "Siparişi kapat"}</Button>
    </>
  );
  return (
    <WideFormDialog open onOpenChange={(o) => !o && onClose()} title={`${order.orderNo} — siparişi kapat`} description={DESCRIPTION} footer={footer}>
      <div className="space-y-4 text-sm">
        {initial.plan.lines.length > 0 && (
          <p className="flex items-center gap-1 text-muted-foreground" data-testid="settle-suggestion">
            {settleSuggestionText(initial.plan.defaultMode)}
            <InfoPopover label="Önerinin kaynağı" desc={`Satırların ilk bölüşümü kapanıştaki kalan iplik önerisi ayarından gelir (${flagSettingTrail("devereSettleDefault")}). Satırları burada değiştirebilirsiniz; ayar yalnız ilk öneriyi belirler.`} />
          </p>
        )}
        <SettleLinesTable drafts={f.drafts} names={names} exitNames={f.exitNames} onChange={f.setDrafts} />
        <div className="grid gap-4 md:grid-cols-2">
          {f.anyReturn && <FormField label="İade sebebi" htmlFor="ws-return-reason" required><ReasonSelect id="ws-return-reason" value={f.reasonCode} onChange={f.setReasonCode} /></FormField>}
          <FormField label="Gerekçe" htmlFor="ws-reason" hint={over ? "Fire toleransı aşıyor — gerekçe yazmanız önerilir (zorunlu değil)." : "İsteğe bağlı."} className={f.anyReturn ? undefined : "md:col-span-2"}>
            <Input id="ws-reason" maxLength={300} value={f.reason} onChange={(e) => f.setReason(e.target.value)} />
          </FormField>
        </div>
        {!f.built.ok && <p className="text-destructive">{f.built.error}</p>}
        {fresh && <SettlePreviewView p={preview.data} names={names} />}
        {fresh && <PreviewNotes p={preview.data} />}
        {!fresh && <p className="text-muted-foreground">Girdi değişti — kapatmadan önce yeniden önizleyin.</p>}
      </div>
    </WideFormDialog>
  );
}

export function SettleDialog({ order, onClose }: { order: WarpingOrder; onClose: () => void }) {
  const q = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "settlement-preview", order.id], queryFn: () => warpingSettleService.defaultPreview(order.id), staleTime: 0, gcTime: 0 });
  if (q.data) return <SettleForm order={order} initial={q.data} onClose={onClose} />;
  return (
    <WideFormDialog open onOpenChange={(o) => !o && onClose()} title={`${order.orderNo} — siparişi kapat`} description={DESCRIPTION}
      footer={<Button variant="outline" onClick={onClose}>Vazgeç</Button>}>
      {q.isLoading && <p className="text-sm text-muted-foreground">Kalan iplik yükleniyor…</p>}
      {q.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
    </WideFormDialog>
  );
}
