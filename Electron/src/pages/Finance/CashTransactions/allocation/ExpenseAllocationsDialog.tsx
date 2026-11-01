// Kayıtlı masrafın bağları (D4-H3): aktif bağlar + tarihçe (damgalılar üstü çizili), yeni bağ ve kaldırma.
// Değişim tarihçe olarak görünür; bağ silinmez, kaldırma damgadır. Hatalar diyalog içinde (suppressErrorToast).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/PermissionGate";
import { useAttemptToken } from "@/lib/attemptToken";
import { formatFactory } from "@/lib/factory-time";
import { cashTxnErrorText, type CashTxnRow } from "../service";
import { AllocationFields } from "./AllocationFields";
import { createExpenseAllocation, listExpenseAllocations, revokeExpenseAllocation, type ExpenseAllocationRow } from "./allocationApi";
import { TARGET_TYPE_LABEL, buildAllocationBody, emptyAllocationDraft } from "./allocationRules";

const at = (iso: string) => formatFactory(iso, "dd.MM.yyyy HH:mm");

interface Props {
  row: CashTxnRow | null;
  onOpenChange: (open: boolean) => void;
}

function AllocationLine({ r, onRevoke }: { r: ExpenseAllocationRow; onRevoke: (r: ExpenseAllocationRow) => void }) {
  const revoked = !!r.revokedAt;
  return (
    <li className={`flex items-start justify-between gap-2 py-1.5 text-sm ${revoked ? "text-muted-foreground" : ""}`}>
      <div>
        <span className={revoked ? "line-through" : "font-medium"}>{r.targetLabel}</span>
        <span className="ml-2">%{r.sharePct}</span>
        <div className="text-xs text-muted-foreground">
          {TARGET_TYPE_LABEL[r.targetType]} · {at(r.createdAt)} {r.createdByName ?? ""}
          {revoked && ` · kaldırıldı ${at(r.revokedAt as string)} ${r.revokedByName ?? ""} — ${r.revokeReason ?? ""}`}
        </div>
      </div>
      {!revoked && (
        <PermissionGate permission="finance:payment">
          <Button variant="outline" size="sm" onClick={() => onRevoke(r)}>Kaldır</Button>
        </PermissionGate>
      )}
    </li>
  );
}

export function ExpenseAllocationsDialog({ row, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(emptyAllocationDraft);
  const [revokeTarget, setRevokeTarget] = useState<ExpenseAllocationRow | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const attempt = useAttemptToken();
  const key = ["expense-allocations", row?.id];
  const listQ = useQuery({ queryKey: key, queryFn: () => listExpenseAllocations(row!.id), enabled: !!row });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const body = buildAllocationBody(draft);

  const addM = useMutation({
    mutationFn: () => createExpenseAllocation(row!.id, body!, attempt.token()),
    onSuccess: (r) => { attempt.onSuccess(); toast.success(r.message ?? "Masraf bağlandı."); setDraft(emptyAllocationDraft()); setError(null); refresh(); },
    onError: (e) => { attempt.onFailure(e); setError(cashTxnErrorText(e, "Bağ kaydedilemedi.")); },
  });
  const revokeM = useMutation({
    mutationFn: () => revokeExpenseAllocation(revokeTarget!.id, reason.trim()),
    onSuccess: (r) => { toast.success(r.message ?? "Bağ kaldırıldı."); setRevokeTarget(null); setReason(""); setError(null); refresh(); },
    onError: (e) => setError(cashTxnErrorText(e, "Bağ kaldırılamadı.")),
  });

  const data = listQ.data;
  const cancelled = row?.status === "CANCELLED";
  return (
    <Dialog open={!!row} onOpenChange={(o) => !addM.isPending && !revokeM.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Masraf bağları — {row?.docNo}</DialogTitle>
          <DialogDescription>
            Bağlı pay %{data?.activePct ?? "…"} · kalan %{data?.remainingPct ?? "…"}. Bağlanmayan pay genel giderde kalır. Kaldırılan bağ tarihçede durur.
          </DialogDescription>
        </DialogHeader>
        {listQ.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
        {data && data.rows.length === 0 && <p className="text-sm text-muted-foreground">Bu masrafın bağı yok.</p>}
        {data && data.rows.length > 0 && (
          <ul className="max-h-64 divide-y overflow-y-auto">
            {data.rows.map((r) => <AllocationLine key={r.id} r={r} onRevoke={(x) => { setRevokeTarget(x); setError(null); }} />)}
          </ul>
        )}
        {revokeTarget && (
          <div className="flex items-end gap-2 rounded-md bg-muted/50 p-2">
            <div className="flex-1">
              <p className="text-xs">"{revokeTarget.targetLabel}" bağını kaldırma gerekçesi</p>
              <Input className="mt-1" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Vazgeç</Button>
            <Button disabled={reason.trim().length < 3 || revokeM.isPending} onClick={() => revokeM.mutate()}>Kaldır</Button>
          </div>
        )}
        {!cancelled && (
          <PermissionGate permission="finance:payment">
            <AllocationFields value={draft} onChange={setDraft} remainingPct={data?.remainingPct} />
          </PermissionGate>
        )}
        {error && <p className="whitespace-pre-line text-sm font-medium text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Kapat</Button>
          {!cancelled && (
            <PermissionGate permission="finance:payment">
              <Button disabled={!body || addM.isPending} onClick={() => addM.mutate()}>{addM.isPending ? "Kaydediliyor…" : "Bağla"}</Button>
            </PermissionGate>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
