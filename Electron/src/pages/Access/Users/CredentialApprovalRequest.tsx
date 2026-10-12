import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAttemptToken } from "@/lib/attemptToken";
import {
  credentialResetService,
  needsApprovalError,
  type CredentialResetKind,
} from "@/services/credentialResetService";

interface Props {
  /** Doğrudan işlemin son hatası — yalnız "onay gerekli" ise kutu çizilir. */
  error: unknown;
  userId: string;
  kind: CredentialResetKind;
}

/**
 * Hedef hesap işlemi yapandan daha yetkiliyse doğrudan sıfırlama 403 döner; işlem ikinci bir
 * yöneticinin onayıyla yapılır. Kutu talebi açar; onay "Kullanıcılar" ekranındaki bekleyenler kartından.
 */
export function CredentialApprovalRequest({ error, userId, kind }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  const attempt = useAttemptToken();

  const create = useMutation({
    mutationFn: () =>
      credentialResetService.create({ targetUserId: userId, kind, reason: reason.trim() || null, clientToken: attempt.token() }),
    onSuccess: () => {
      setSent(true);
      attempt.onSuccess();
      toast.success("Onay talebi oluşturuldu — ikinci bir yönetici Kullanıcılar ekranından onaylayınca uygulanır.");
      void qc.invalidateQueries({ queryKey: ["credential-reset-requests"] });
    },
    onError: (e) => attempt.onFailure(e),
  });

  if (!needsApprovalError(error)) return null;

  return (
    <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950/40">
      <div className="flex gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p>
          Bu hesap sizden daha yetkili. Kimliğini teslim eden bu işlem <b>ikinci bir yöneticinin onayıyla</b> yapılır:
          talep açın, bu hesabın yetkilerini taşıyan başka bir yönetici onaylayınca uygulanır.
        </p>
      </div>
      {sent ? (
        <p className="text-muted-foreground">Talep gönderildi — onay bekleniyor.</p>
      ) : (
        <div className="flex gap-2">
          <Input
            placeholder="Gerekçe (isteğe bağlı) — ör. telefonunu kaybetti"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Gönderiliyor..." : "Onay talebi oluştur"}
          </Button>
        </div>
      )}
    </div>
  );
}
