// =============================================================================
// ELLE GEÇİŞ — boş gönder / boş döndü / bakıma al / bakımdan çıkar / hurdaya ayır (önizlemeli)
// =============================================================================
// Önizleme (`transition-preview`) YAZMAZ: hedef durum, yer ve uyarılar sunucudan gelir; panel kural hesaplamaz.
// Menüdeki seçenekler yalnız kolaylık süzgecidir (`MANUAL_FROM`), kesin karar sunucuda (409 BEAM_BODY_STATE).
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { toastServerSuccess } from "@/lib/serverNotes";
import { apiErrorMessage } from "@/services/apiClient";
import { BEAM_BODIES_QUERY_KEY, beamBodyService } from "./service";
import { SubcontractorPicker, WarehousePicker } from "./Pickers";
import { BEAM_BODY_STATUS_META, type BeamBody, type BeamBodyManualKind, type BeamBodyStatus, type BeamBodyTransitionInput } from "./types";

/** Backend `BEAM_BODY_MANUAL_TRANSITIONS.from` aynası — yalnız menüde hangi seçeneğin açık olacağı için. */
export const MANUAL_FROM: Record<BeamBodyManualKind, readonly BeamBodyStatus[]> = {
  SHIP_EMPTY: ["EMPTY_STOCK"],
  RETURN_EMPTY: ["AT_SUBCONTRACTOR"],
  MAINTENANCE_IN: ["EMPTY_STOCK"],
  MAINTENANCE_OUT: ["MAINTENANCE"],
  SCRAP: ["EMPTY_STOCK", "MAINTENANCE"],
};

export const MANUAL_LABELS: Record<BeamBodyManualKind, string> = {
  SHIP_EMPTY: "Devereciye boş gönder",
  RETURN_EMPTY: "Devereciden boş döndü",
  MAINTENANCE_IN: "Bakıma al",
  MAINTENANCE_OUT: "Bakımdan çıkar",
  SCRAP: "Hurdaya ayır",
};

export const manualKindsFor = (b: Pick<BeamBody, "status" | "isActive">): BeamBodyManualKind[] =>
  b.isActive ? (Object.keys(MANUAL_FROM) as BeamBodyManualKind[]).filter((k) => MANUAL_FROM[k].includes(b.status)) : [];

export function TransitionDialog({ body, kind, onClose }: { body: BeamBody; kind: BeamBodyManualKind; onClose: () => void }) {
  const qc = useQueryClient();
  const [subcontractorId, setSub] = useState<string | null>(null);
  const [warehouseId, setWh] = useState<string | null>(kind === "MAINTENANCE_IN" || kind === "MAINTENANCE_OUT" ? (body.place.warehouse?.id ?? null) : null);
  const [reason, setReason] = useState("");
  const input: BeamBodyTransitionInput = {
    kind,
    ...(kind === "SHIP_EMPTY" ? { subcontractorId } : {}),
    ...(kind === "RETURN_EMPTY" || kind === "MAINTENANCE_IN" || kind === "MAINTENANCE_OUT" ? { warehouseId } : {}),
    reason: reason.trim() || null,
  };
  const ready = (kind !== "SHIP_EMPTY" || Boolean(subcontractorId)) && (kind !== "SCRAP" || reason.trim().length >= 3);
  const settled = useDebouncedValue(ready ? JSON.stringify(input) : null, 300);
  const pv = useQuery({
    queryKey: [BEAM_BODIES_QUERY_KEY, "transition-preview", body.id, settled],
    queryFn: () => beamBodyService.transitionPreview(body.id, JSON.parse(settled!) as BeamBodyTransitionInput),
    enabled: settled !== null,
    retry: false,
    staleTime: 0,
  });
  const apply = useMutation({
    mutationFn: () => beamBodyService.transition(body.id, input),
    onSuccess: (res) => {
      toastServerSuccess(res, `${body.bodyNo}: ${MANUAL_LABELS[kind].toLowerCase()} yazıldı.`);
      void qc.invalidateQueries({ queryKey: [BEAM_BODIES_QUERY_KEY] });
      onClose();
    },
  });
  const plan = pv.data;
  const fresh = plan && settled === JSON.stringify(input);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{body.bodyNo} — {MANUAL_LABELS[kind]}</DialogTitle>
          <DialogDescription>Hareket gövdenin geçmişine yazılır; son hareket gerekirse “Geri al” ile ters kayıtla geri alınır.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {kind === "SHIP_EMPTY" && (
            <FormField label="Gönderildiği devereci" required>
              <SubcontractorPicker value={subcontractorId} onChange={setSub} />
            </FormField>
          )}
          {(kind === "RETURN_EMPTY" || kind === "MAINTENANCE_IN" || kind === "MAINTENANCE_OUT") && (
            <FormField label="Depo" info={kind === "RETURN_EMPTY" ? "Gövdenin geldiği depo; bilinmiyorsa boş bırakılabilir." : "Boş bırakılırsa gövde bulunduğu depoda kalır."}>
              <WarehousePicker value={warehouseId} onChange={setWh} />
            </FormField>
          )}
          <FormField label={kind === "SCRAP" ? "Hurda sebebi" : "Not"} required={kind === "SCRAP"} htmlFor="bb-tr-reason">
            <Textarea id="bb-tr-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "SCRAP" ? "Ör. flanş çatlak, mil eğik" : "İsteğe bağlı"} />
          </FormField>
          {pv.isError && <Callout tone="danger">{apiErrorMessage(pv.error)}</Callout>}
          {plan && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm" aria-label="Önizleme">
              <span>{BEAM_BODY_STATUS_META[plan.from]?.label ?? plan.from}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{plan.toLabel}</span>
            </div>
          )}
          {plan && plan.warnings.length > 0 && <Callout tone="warning">{plan.warnings.join(" ")}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant={kind === "SCRAP" ? "destructive" : "default"} disabled={!fresh || pv.isFetching || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? "Yazılıyor…" : MANUAL_LABELS[kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
