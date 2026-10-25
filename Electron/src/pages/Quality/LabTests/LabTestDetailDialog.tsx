// Lab testi ayrıntısı — taslakta sonuç girilir; onay testi dondurur; iptal gerekçeli; taslak silinebilir.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { apiErrorText } from "@/lib/api-error";
import { fmtCalendarDay, fmtFactoryDateTime } from "@/lib/factory-time";
import { labTestService, labTestTypeService, type LabResultInput } from "./service";
import { STATUS_BADGE, STATUS_LABEL } from "./labTestRules";
import { LabResultsTable } from "./LabResultsTable";
import { LabResultEntry } from "./LabResultEntry";
import { LabVoidDialog } from "./LabVoidDialog";

interface Props { testId: string; onClose: () => void }

export function LabTestDetailDialog({ testId, onClose }: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const [voidOpen, setVoidOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const detail = useQuery({ queryKey: ["lab-tests", "detail", testId], queryFn: () => labTestService.get(testId) });
  const types = useQuery({ queryKey: ["lab-test-types", "all"], queryFn: () => labTestTypeService.list(false), staleTime: 60_000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["lab-tests"] });
  const run = useMutation({
    mutationFn: (op: () => Promise<unknown>) => op(),
    onSuccess: refresh,
  });
  const t = detail.data;
  const draft = t?.status === "DRAFT";
  const canWrite = hasPermission("labtest:write");
  const canApprove = hasPermission("labtest:approve");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{t?.testNo ?? "Lab testi"}</span>
            {t && <Badge variant={STATUS_BADGE[t.status]}>{STATUS_LABEL[t.status]}</Badge>}
          </DialogTitle>
          <DialogDescription>{draft ? "Taslak — sonuçlar düzenlenebilir. Onaylanınca test donar." : "Bu test donmuştur; sonuçları değiştirilemez."}</DialogDescription>
        </DialogHeader>
        {detail.isLoading ? <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          : detail.isError || !t ? <p className="text-sm text-destructive">{apiErrorText(detail.error, "Lab testi okunamadı.")}</p>
          : (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Row k="Konu" v={t.roll ? `Top ${t.roll.barcode ?? "—"}${t.batch ? ` (parti ${t.batch.batchNumber})` : ""}` : `Parti ${t.batch?.batchNumber ?? "—"}`} />
                <Row k="Kumaş" v={t.item ? `${t.item.code} · ${t.item.name}` : "—"} />
                {t.customer && <Row k="Karşılaştırma" v={`${t.customer.name} spesifikasyonu (yoksa test türü sınırı)`} />}
                <Row k="Test tarihi" v={fmtCalendarDay(t.testedOn)} />
                <Row k="Numune · Lab" v={[t.sampleCode, t.labName].filter(Boolean).join(" · ") || "—"} />
                {t.approvedAt && <Row k="Onay" v={`${fmtFactoryDateTime(t.approvedAt)} · ${t.approvedBy?.fullName ?? "—"}`} />}
                {t.voidedAt && <Row k="İptal" v={`${fmtFactoryDateTime(t.voidedAt)} · ${t.voidedBy?.fullName ?? "—"} — ${t.voidReason ?? ""}`} />}
                {t.note && <Row k="Not" v={t.note} />}
              </dl>
              <LabResultsTable results={t.results} types={types.data ?? []} busy={run.isPending}
                onDelete={draft && canWrite ? (typeId) => run.mutate(() => labTestService.deleteResult(t.id, typeId)) : undefined} />
              {draft && canWrite && (
                <LabResultEntry types={(types.data ?? []).filter((x) => x.isActive)} enteredTypeIds={new Set(t.results.map((r) => r.testTypeId))} busy={run.isPending}
                  onSave={(input: LabResultInput) => run.mutate(() => labTestService.saveResult(t.id, input))} />
              )}
              {confirmDelete && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p>Taslak <span className="font-mono">{t.testNo}</span> ve {t.results.length} sonucu kalıcı olarak silinecek. Taslak hiçbir deftere yazmadığı için silinebilir.</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>Vazgeç</Button>
                    <Button size="sm" variant="destructive" disabled={run.isPending} onClick={() => run.mutate(() => labTestService.removeDraft(t.id), { onSuccess: onClose })}>Taslağı sil</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        {t && (
          <DialogFooter className="flex-wrap gap-2">
            {draft && canWrite && !confirmDelete && <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Taslağı sil</Button>}
            {t.status !== "VOIDED" && canApprove && <Button variant="outline" onClick={() => setVoidOpen(true)}>İptal et…</Button>}
            {draft && canApprove && (
              <Button disabled={t.results.length === 0 || run.isPending} title={t.results.length === 0 ? "Sonuçsuz test onaylanamaz" : undefined}
                onClick={() => run.mutate(() => labTestService.approve(t.id), { onSuccess: () => toast.success(`${t.testNo} onaylandı.`) })}>Onayla</Button>
            )}
          </DialogFooter>
        )}
        {voidOpen && <LabVoidDialog testId={testId} open onOpenChange={setVoidOpen} onDone={refresh} />}
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (<div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>);
}
