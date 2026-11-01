// "Üretime gönder" önizleme diyaloğu (SY-M3, tasarım §14.5/§14.8): önizleme → per-kayıt seçim → Oluştur.
// TEK MANTIKSAL DENEME = TEK `clientToken` (kk1.md): belirsiz hatada aynı token yeniden gider, kesin 4xx'te
// yenilenir. 409 (satır bu arada planlanmış / öneri bayat) cümlesi diyalogda KALIR; kullanıcı önizlemeyi yeniler.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAttemptToken } from "@/lib/attemptToken";
import { apiErrorMessage } from "@/services/apiClient";
import type { OrderLine } from "../types";
import { productionProposalService } from "./service";
import { buildApplyBody, conflictLineIds, initialSelection, isConflict, toggled, type ProposalSelection } from "./selection";
import { BeamSection, ExcludedSection, WeavingSection, WorkOrderSection, type LineLabel } from "./ProposalSections";
import type { ProposalApplyResult } from "./types";

export const PRODUCTION_PROPOSAL_QUERY_KEY = "production-proposal";
const EMPTY: ProposalSelection = { weaving: new Set(), workOrders: new Set(), plannedM: new Map() };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber?: string;
  lines?: readonly OrderLine[];
}

function useLineLabel(lines: readonly OrderLine[] | undefined): LineLabel {
  return useMemo(() => {
    const byId = new Map((lines ?? []).map((l, i) => [l.id, `#${i + 1} ${l.item?.name ?? ""}${l.color ? ` / ${l.color.name}` : ""}`.trim()]));
    return (id: string) => byId.get(id) ?? "satır";
  }, [lines]);
}

function useProposalFlow(open: boolean, orderId: string) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [sel, setSel] = useState<ProposalSelection>(EMPTY);
  const [result, setResult] = useState<ProposalApplyResult | null>(null);
  const preview = useQuery({ queryKey: [PRODUCTION_PROPOSAL_QUERY_KEY, orderId], queryFn: () => productionProposalService.preview(orderId), enabled: open, staleTime: 0, gcTime: 0, retry: false });

  useEffect(() => {
    if (!open) return;
    setResult(null);
    attempt.renew();
  }, [open, attempt]);
  useEffect(() => {
    if (preview.data) setSel(initialSelection(preview.data));
  }, [preview.data]);

  const apply = useMutation({
    mutationFn: () => {
      const body = preview.data ? buildApplyBody(preview.data, sel, attempt.token()) : null;
      if (!body) throw new Error("Seçim geçersiz");
      return productionProposalService.apply(orderId, body);
    },
    onError: (e) => attempt.onFailure(e),
    onSuccess: (r) => {
      attempt.onSuccess();
      setResult(r.data);
      for (const key of ["orders", "weaving-orders", "work-orders"]) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
  const refresh = () => {
    apply.reset();
    attempt.renew();
    void preview.refetch();
  };
  const canApply = preview.data != null && buildApplyBody(preview.data, sel, "-") != null;
  return { preview, sel, setSel, result, apply, refresh, canApply };
}

export function ProductionProposalDialog({ open, onOpenChange, orderId, orderNumber, lines }: Props) {
  const f = useProposalFlow(open, orderId);
  const lineLabel = useLineLabel(lines);
  const p = f.preview.data;
  const empty = p != null && p.weavingOrders.length + p.workOrders.length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Üretime gönder{orderNumber ? ` — ${orderNumber}` : p ? ` — ${p.orderNumber}` : ""}</DialogTitle>
          <DialogDescription>{f.result ? "Sonuç" : "Oluşturulacak kayıtları gözden geçirin; istemediğinizin işaretini kaldırın."}</DialogDescription>
        </DialogHeader>
        {f.result ? (
          <ResultList result={f.result} />
        ) : f.preview.isLoading ? (
          <p className="text-sm text-muted-foreground">Öneri hazırlanıyor…</p>
        ) : f.preview.isError ? (
          <p role="alert" className="text-sm text-destructive">{apiErrorMessage(f.preview.error, "Üretim önerisi alınamadı")}</p>
        ) : p ? (
          <div className="space-y-4">
            {empty && <p className="text-sm text-muted-foreground">Bu sipariş için oluşturulacak yeni kayıt yok.</p>}
            <WeavingSection rows={p.weavingOrders} sel={f.sel} canCreate={p.canCreate.weaving} lineLabel={lineLabel}
              onToggle={(k) => f.setSel((s) => ({ ...s, weaving: toggled(s.weaving, k) }))}
              onPlannedM={(k, t) => f.setSel((s) => ({ ...s, plannedM: new Map(s.plannedM).set(k, t) }))} />
            <WorkOrderSection rows={p.workOrders} sel={f.sel} canCreate={p.canCreate.workOrder} lineLabel={lineLabel}
              onToggle={(k) => f.setSel((s) => ({ ...s, workOrders: toggled(s.workOrders, k) }))} />
            <BeamSection rows={p.weavingOrders} />
            <ExcludedSection rows={p.excluded} lineLabel={lineLabel} />
          </div>
        ) : null}
        {f.apply.isError && <ApplyError error={f.apply.error} lineLabel={lineLabel} />}
        <DialogFooter>
          {f.result ? (
            <Button onClick={() => onOpenChange(false)}>Kapat</Button>
          ) : (
            <>
              <Button variant="outline" onClick={f.refresh} disabled={f.apply.isPending || f.preview.isFetching}>Önizlemeyi yenile</Button>
              <Button onClick={() => f.apply.mutate()} disabled={!f.canApply || f.apply.isPending || (f.apply.isError && isConflict(f.apply.error))}>
                {f.apply.isPending ? "Oluşturuluyor…" : "Oluştur"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplyError({ error, lineLabel }: { error: unknown; lineLabel: LineLabel }) {
  const ids = conflictLineIds(error);
  return (
    <div role="alert" className="space-y-1 text-sm text-destructive">
      <p>
        {apiErrorMessage(error)}
        {isConflict(error) ? " Önizlemeyi yenileyip yeniden seçin." : " Aynı seçimle tekrar gönderebilirsiniz; çift kayıt açılmaz."}
      </p>
      {ids.length > 0 && <ul className="list-disc pl-5 text-xs">{ids.map((id) => <li key={id}>{lineLabel(id)}</li>)}</ul>}
    </div>
  );
}

function ResultList({ result }: { result: ProposalApplyResult }) {
  return (
    <div className="space-y-2 text-sm">
      {result.weavingOrders.length > 0 && <p>Dokuma iş emirleri: <span className="font-mono">{result.weavingOrders.map((w) => w.number).join(", ")}</span></p>}
      {result.workOrders.length > 0 && <p>Terbiye iş emirleri: <span className="font-mono">{result.workOrders.map((w) => w.number).join(", ")}</span></p>}
    </div>
  );
}
