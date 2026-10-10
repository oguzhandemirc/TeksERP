import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, MonitorSmartphone, ShieldCheck, ShieldOff, ShieldPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { adminUserService } from "@/services/adminUserService";
import { buildTotpEnrollHash, buildTotpEnrollUrl } from "@/lib/totp-enroll-url";
import { useAuthStore } from "@/store/auth";
import { factoryLocaleDateString, factoryLocaleTimeString } from "@/lib/factory-time";
import { TWO_FACTOR_HINT } from "@/lib/totp-auth";

interface Props {
  userId: string;
  username: string;
}

/**
 * İKİ ADIMLI DOĞRULAMA — yönetici yüzeyi.
 *
 * ⚠️ BURADA QR GÖSTERİLMEZ. Yönetici bir pencere açar; kullanıcı QR'ı kurulum
 * sayfasında KENDİ telefonuyla okur — bağlantıyla (yalnız web: mutlak adres varsa)
 * ya da "Bu bilgisayarda aç" ile. Başka kullanıcı için bu bilgisayarda açmak
 * yöneticinin oturumunu ÖNCE kapatır: ekran o kullanıcıya bırakılır, sonunda
 * giriş ekranına döner — yöneticinin açık kabuğuna değil.
 *
 * ⚠️ Kurulumun TEK yolu budur. "Kullanıcı parolasıyla kendi kursun" bilinçli
 * olarak reddedildi: parola sızmışsa saldırgan 2FA'yı kendi telefonuna bağlar
 * ve meşru sahibi kilitler — yani 2FA'nın koruduğu tek senaryo kapanırdı.
 */
export function TwoFactorTab({ userId, username }: Props) {
  const qc = useQueryClient();
  const [link, setLink] = useState<{ token: string; url: string | null; expiresAt: string } | null>(
    null,
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmOpenHere, setConfirmOpenHere] = useState(false);
  const isSelf = useAuthStore((s) => s.user?.userId === userId);
  const logout = useAuthStore((s) => s.logout);

  const openHere = (token: string) => {
    const hash = buildTotpEnrollHash(token);
    if (isSelf) {
      window.location.hash = hash;
      return;
    }
    void logout().then(() => (window.location.hash = hash));
  };

  const statusQ = useQuery({
    queryKey: ["admin-user-totp", userId],
    queryFn: () => adminUserService.getTotpStatus(userId),
  });

  const openMut = useMutation({
    mutationFn: () => adminUserService.openTotpWindow(userId),
    onSuccess: (res) => {
      const token = res.data.token;
      setLink({ token, url: buildTotpEnrollUrl(token), expiresAt: res.data.expiresAt });
      toast.success("Kurulum hazır — 15 dakika geçerli");
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
              ? ` · ${factoryLocaleDateString(status.enabledAt, "tr-TR")}`
              : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            {TWO_FACTOR_HINT}
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
          {link.url ? (
            <>
              <p className="text-sm font-medium">
                Bu bağlantıyı <span className="font-semibold">{username}</span> kullanıcısına
                iletin ya da kurulumu bu bilgisayarda açın
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
                    void navigator.clipboard.writeText(link.url ?? "");
                    toast.success("Bağlantı kopyalandı");
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Kopyala
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm font-medium">
              Kurulumu bu bilgisayarda açın;{" "}
              <span className="font-semibold">{username}</span> karekodu kendi telefonundaki
              doğrulama uygulamasıyla okutur
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => (isSelf ? openHere(link.token) : setConfirmOpenHere(true))}
          >
            <MonitorSmartphone className="mr-1.5 h-4 w-4" />
            Bu bilgisayarda kurulumu aç
          </Button>
          <p className="text-xs text-muted-foreground">
            {factoryLocaleTimeString(link.expiresAt, "tr-TR")}'e kadar geçerli ve{" "}
            <span className="font-medium">tek kullanımlıktır</span>. Süresi geçerse yeniden
            üretin — eskisi kendiliğinden geçersiz olur.
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
          {status?.enabled ? "Yeniden kur" : "Kurulumu başlat"}
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
          "Yeniden kurmak için kurulumu yeniden başlatmalısınız."
        }
        confirmLabel="Sıfırla"
        cancelLabel="Vazgeç"
        isPending={resetMut.isPending}
        onConfirm={() => resetMut.mutate()}
      />

      <ConfirmDialog
        open={confirmOpenHere}
        onOpenChange={setConfirmOpenHere}
        title="Kurulum bu bilgisayarda açılsın mı?"
        description={
          `Oturumunuz kapanacak ve ekran ${username} kullanıcısının kurulumuna geçecek. ` +
          "Kullanıcı karekodu kendi telefonuyla okutup kurulumu tamamlar; sonra giriş " +
          "ekranına dönülür ve siz yeniden giriş yaparsınız."
        }
        confirmLabel="Oturumu kapat ve aç"
        cancelLabel="Vazgeç"
        onConfirm={() => {
          setConfirmOpenHere(false);
          if (link) openHere(link.token);
        }}
      />
    </div>
  );
}
