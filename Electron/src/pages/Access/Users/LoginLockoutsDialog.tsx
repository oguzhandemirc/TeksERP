import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { safeFormat } from "@/lib/format";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { LOGIN_LOCKOUT_METHOD_LABELS, loginLockoutService } from "@/services/loginLockoutService";

const QUERY_KEY = ["login-lockouts"] as const;

/**
 * Kilitli giriş kovaları (VDS denetimi O4): çok sayıda hatalı denemeyle kilitlenen IP / kullanıcı / cihaz.
 * Kilit kendiliğinden açılır; yönetici beklemeden kaldırabilir (Sistem Kayıtları'na yazılır).
 */
export function LoginLockoutsButton() {
  const [open, setOpen] = useState(false);
  const tabActive = useIsTabActive();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: loginLockoutService.list,
    refetchInterval: tabActive ? (open ? 15_000 : 60_000) : false,
  });
  const count = query.data?.length ?? 0;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <LockOpen className="mr-1 h-4 w-4" /> Giriş kilitleri
        {count > 0 && <Badge variant="destructive" className="ml-1">{count}</Badge>}
      </Button>
      <LoginLockoutsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function LoginLockoutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: loginLockoutService.list, enabled: open });
  const release = useMutation({
    mutationFn: (id: string) => loginLockoutService.release(id),
    onSuccess: () => {
      toast.success("Giriş kilidi kaldırıldı");
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  const rows = query.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Giriş kilitleri</DialogTitle>
          <DialogDescription>
            Çok sayıda hatalı denemeyle geçici olarak kilitlenen adres, kullanıcı ya da cihazlar. Kilit süresi dolunca kendiliğinden
            açılır; tanıdığınız bir kişiyse beklemeden kaldırabilirsiniz. Kaldırma Sistem Kayıtları'na yazılır.
          </DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Şu an kilitli giriş yok.</p>
        ) : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                <span className="min-w-0 flex-1 break-all">
                  <b>{r.label ?? `Kilit ${r.id.slice(0, 8)} (sunucu yeniden başladı, türü bilinmiyor — süresi dolunca kendiliğinden açılır)`}</b>
                  <span className="block text-xs text-muted-foreground">
                    {LOGIN_LOCKOUT_METHOD_LABELS[r.method]} · açılış {safeFormat(r.blockedUntil, "dd.MM.yyyy HH:mm")} · ceza turu{" "}
                    {r.penaltyRounds}
                  </span>
                </span>
                <Button size="sm" variant="outline" disabled={release.isPending || !r.releasable} onClick={() => release.mutate(r.id)}>
                  Kaldır
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
