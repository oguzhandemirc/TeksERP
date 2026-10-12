import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { safeFormat } from "@/lib/format";
import { passwordPolicyViolation } from "@/lib/password-policy";
import {
  CREDENTIAL_RESET_KIND_LABELS,
  credentialResetService,
  type CredentialResetRequestItem,
} from "@/services/credentialResetService";

const QUERY_KEY = ["credential-reset-requests", "PENDING"] as const;

/**
 * Onay bekleyen kimlik sıfırlamaları — daha yetkili bir hesabın parola/PIN/kart/iki adımlı doğrulama
 * sıfırlamasını ikinci bir yönetici onaylar ve işlemi O uygular (sır yalnız onaylayana döner).
 * Bekleyen talep yoksa hiçbir şey çizilmez.
 */
export function PendingCredentialResets() {
  const qc = useQueryClient();
  const [approving, setApproving] = useState<CredentialResetRequestItem | null>(null);
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => credentialResetService.list("PENDING") });
  const reject = useMutation({
    mutationFn: (id: string) => credentialResetService.reject(id),
    onSuccess: (r) => {
      toast.success(r.status === "CANCELLED" ? "Talep geri çekildi" : "Talep reddedildi");
      void qc.invalidateQueries({ queryKey: ["credential-reset-requests"] });
    },
  });

  const rows = query.data ?? [];
  if (rows.length === 0 && !approving) return null;

  return (
    <div className="mx-3 my-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
      <div className="mb-2 flex items-center gap-2 font-medium">
        <ShieldCheck className="h-4 w-4 text-amber-600" /> Onay bekleyen kimlik sıfırlamaları ({rows.length})
      </div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3">
            <span className="flex-1">
              <b>{r.targetUser.fullName}</b> ({r.targetUser.username}) — {CREDENTIAL_RESET_KIND_LABELS[r.kind]} · talep eden{" "}
              {r.requestedBy.fullName} · {safeFormat(r.createdAt, "dd.MM.yyyy HH:mm")}
              {r.reason ? ` · "${r.reason}"` : ""}
              {r.expired ? " · süresi doldu" : ""}
            </span>
            {r.canApprove && (
              <Button size="sm" onClick={() => setApproving(r)}>
                Onayla
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={reject.isPending} onClick={() => reject.mutate(r.id)}>
              Reddet
            </Button>
          </li>
        ))}
      </ul>
      <ApproveCredentialResetDialog request={approving} onClose={() => setApproving(null)} />
    </div>
  );
}

/** Onay penceresi: parola türünde geçici parola sorar; PIN/kart sonucu yalnız burada, onaylayana gösterilir. */
function ApproveCredentialResetDialog({ request, onClose }: { request: CredentialResetRequestItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: (r: CredentialResetRequestItem) =>
      credentialResetService.approve(r.id, r.kind === "PASSWORD" ? { password } : {}),
    onSuccess: (data) => {
      const res = data.result;
      if (res?.pin) setResult(`Yeni hızlı PIN: ${res.pin} — kişiye bizzat iletin.`);
      else if (res?.cardCode) setResult("Yeni personel kartı üretildi — eski kart geçersiz. Kartı kullanıcının Personel Kartı sekmesinden yazdırın.");
      else setResult("Onaylandı ve uygulandı.");
      setPassword("");
      void qc.invalidateQueries({ queryKey: ["credential-reset-requests"] });
    },
  });
  const close = () => { setResult(null); setPassword(""); onClose(); };
  const pwError = request?.kind === "PASSWORD" && password ? passwordPolicyViolation(password) : null;

  return (
    <Dialog open={!!request} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{request ? CREDENTIAL_RESET_KIND_LABELS[request.kind] : ""} — onay</DialogTitle>
          <DialogDescription>
            {request
              ? `${request.targetUser.fullName} için ${request.requestedBy.fullName} tarafından istendi. Onayladığınızda işlem SİZİN adınıza uygulanır.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <p className="text-sm">{result}</p>
        ) : request?.kind === "PASSWORD" ? (
          <div className="space-y-1">
            <Input type="password" placeholder="Geçici şifre (kişi ilk girişte değiştirir)" value={password} onChange={(e) => setPassword(e.target.value)} />
            {pwError && <p className="text-xs text-destructive">{pwError}</p>}
          </div>
        ) : null}
        <DialogFooter>
          {result ? (
            <Button onClick={close}>Kapat</Button>
          ) : (
            <Button
              disabled={approve.isPending || (request?.kind === "PASSWORD" && (!password || !!pwError))}
              onClick={() => request && approve.mutate(request)}
            >
              {approve.isPending ? "Uygulanıyor..." : "Onayla ve uygula"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
