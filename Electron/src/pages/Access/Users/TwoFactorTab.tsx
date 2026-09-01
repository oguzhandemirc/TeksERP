import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, ShieldCheck, ShieldOff, ShieldPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { adminUserService } from "@/services/adminUserService";
import { buildTotpEnrollUrl } from "@/lib/totp-enroll-url";

interface Props {
  userId: string;
  username: string;
}

/**
 * İKİ ADIMLI DOĞRULAMA — yönetici yüzeyi.
 *
 * ⚠️ BURADA QR GÖSTERİLMEZ. Yönetici bir BAĞLANTI üretir, kullanıcı QR'ı KENDİ
 * penceresinde okur. Sebep: sırrı yöneticinin ekranında göstermenin hiçbir
 * faydası yok ama omuz sörfü / ekran paylaşımı riski var — ve o sır, o hesabın
 * ikinci faktörünün tamamıdır.
 *
 * ⚠️ Kurulumun TEK yolu budur. "Kullanıcı parolasıyla kendi kursun" bilinçli
 * olarak reddedildi: parola sızmışsa saldırgan 2FA'yı kendi telefonuna bağlar
 * ve meşru sahibi kilitler — yani 2FA'nın koruduğu tek senaryo kapanırdı.
 */
export function TwoFactorTab({ userId, username }: Props) {
  const qc = useQueryClient();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const statusQ = useQuery({
    queryKey: ["admin-user-totp", userId],
    queryFn: () => adminUserService.getTotpStatus(userId),
  });

  const openMut = useMutation({
    mutationFn: () => adminUserService.openTotpWindow(userId),
    onSuccess: (res) => {
      setLink({ url: buildTotpEnrollUrl(res.data.token), expiresAt: res.data.expiresAt });
      toast.success("Kurulum bağlantısı hazır — 15 dakika geçerli");
    },
  });

  const resetMut = useMutation({
    mutationFn: () => adminUserService.resetTotp(userId),
    onSuccess: () => {
      setConfirmReset(false);
      setLink(null);
      toast.success("İki adımlı doğrulama sıfırlandı — kullanıcı yeniden giriş yapmalı");
      void qc.invalidateQueries({ queryKey: ["admin-user-totp", userId] });
    },
  });

  if (statusQ.isLoading) return <Skeleton className="h-56 w-full" />;
  const status = statusQ.data?.data;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-md border bg-card p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          {status?.enabled ? (
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          ) : (
            <ShieldOff className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="text-sm">
          <p className="font-medium">
            {status?.enabled ? "Kurulu" : "Kurulu değil"}
            {status?.enabled && status.enabledAt
              ? ` · ${new Date(status.enabledAt).toLocaleDateString("tr-TR")}`
              : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            İki adımlı doğrulama yalnız <span className="font-medium">uzaktan</span>{" "}
            (fabrika dışından) girişlerde istenir. Fabrika ağındaki panel ve
            tabletler bundan etkilenmez.
          </p>
          {status?.enabled && (
            <p className="mt-1 text-muted-foreground">
              Kalan kurtarma kodu:{" "}
              <span
                className={
                  status.remainingRecoveryCodes <= 2 ? "font-medium text-amber-600" : "font-medium"
                }
              >
                {status.remainingRecoveryCodes}
              </span>
              {status.remainingRecoveryCodes <= 2 &&
                " — azaldı, sıfırlayıp yeniden kurmayı düşünün"}
            </p>
          )}
        </div>
      </div>

      {link ? (
        <div className="space-y-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4">
          <p className="text-sm font-medium">
            Bu bağlantıyı <span className="font-semibold">{username}</span> kullanıcısına iletin
          </p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-3 py-2 text-xs">
              {link.url}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(link.url);
                toast.success("Bağlantı kopyalandı");
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Kopyala
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(link.expiresAt).toLocaleTimeString("tr-TR")}'e kadar geçerli ve{" "}
            <span className="font-medium">tek kullanımlıktır</span>. Süresi geçerse yeni bir
            bağlantı üretin — eskisi kendiliğinden geçersiz olur.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => openMut.mutate()}
          disabled={openMut.isPending}
        >
          <ShieldPlus className="mr-1.5 h-4 w-4" />
          {status?.enabled ? "Yeniden kur (bağlantı üret)" : "Kurulum bağlantısı üret"}
        </Button>
        {status?.enabled && (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirmReset(true)}
            disabled={resetMut.isPending}
          >
            <ShieldOff className="mr-1.5 h-4 w-4" />
            Sıfırla
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="İki adımlı doğrulama sıfırlansın mı?"
        description={
          `${username} kullanıcısının 2FA kaydı ve kullanılmamış kurtarma kodları silinecek. ` +
          "Açık oturumları kapanacak ve yeniden giriş yapması gerekecek. " +
          "Sıfırlandıktan sonra UZAKTAN GİREMEZ — yeni bir kurulum bağlantısı üretmelisiniz."
        }
        confirmLabel="Sıfırla"
        cancelLabel="Vazgeç"
        isPending={resetMut.isPending}
        onConfirm={() => resetMut.mutate()}
      />
    </div>
  );
}
