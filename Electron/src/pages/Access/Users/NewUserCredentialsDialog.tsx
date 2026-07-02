import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, KeySquare, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { printDocumentArea } from "@/lib/print";
import { useEnabledLoginMethods } from "@/hooks/usePricingEnabled";
import { adminUserService } from "@/services/adminUserService";

interface Props {
  /** Oluşturulan kullanıcı; null ise dialog kapalı. */
  user: { id: string; username: string; fullName: string } | null;
  /** Formda girilen şifre — "Kullanıcı + Şifre" yöntemi etkinse hatırlatılır (geri okunamaz). */
  password?: string;
  onOpenChange: (open: boolean) => void;
  /** "PIN/kartı yönet" → kullanıcı detay panelini aç. */
  onManage: () => void;
}

/**
 * Yeni kullanıcı oluşturulunca açılan "kimlik kartı" — başarı onayı + ETKİN giriş
 * yöntemlerinin kimlikleri (yalnız ne aktifse): Kullanıcı+Şifre → hatırlatma,
 * QR kart → QR, Hızlı PIN → PIN. Hiç mobil yöntem etkin değilken AccessUsersPage
 * bu modalı hiç açmaz (toast yeter).
 */
export function NewUserCredentialsDialog({ user, password, onOpenChange, onManage }: Props) {
  const areaRef = useRef<HTMLDivElement>(null);
  const enabled = useEnabledLoginMethods();
  const showList = enabled.includes("list");
  const showCard = enabled.includes("card");
  const showPin = enabled.includes("pin");

  const credQ = useQuery({
    queryKey: ["admin-user-credentials", user?.id],
    queryFn: () => adminUserService.getCredentials(user!.id),
    enabled: !!user && (showCard || showPin),
  });
  const cred = credQ.data?.data;
  const loadingCred = (showCard || showPin) && credQ.isLoading;

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 animate-in zoom-in-50 duration-300" />
            Kullanıcı oluşturuldu
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{user?.fullName}</span> için etkin
            giriş yöntemlerinin kimlikleri hazır. Yazdırıp teslim edin.
          </DialogDescription>
        </DialogHeader>

        {loadingCred ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div
            ref={areaRef}
            className="print-area mx-auto flex w-full max-w-[300px] flex-col items-center gap-3 rounded-md border bg-white p-6 text-center text-black"
          >
            {showCard &&
              (cred?.cardCode ? (
                <>
                  <QRCodeSVG value={cred.cardCode} size={168} level="M" />
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                    QR Personel Kartı
                  </div>
                </>
              ) : (
                <div className="text-sm text-neutral-500">QR kart üretilmedi.</div>
              ))}

            {showPin && (
              <div className={`w-full ${showCard ? "border-t pt-3" : ""}`}>
                <div className="text-xs text-neutral-500">Hızlı PIN</div>
                {cred?.quickPin ? (
                  <div className="font-mono text-3xl font-bold tracking-[0.3em]">{cred.quickPin}</div>
                ) : (
                  <div className="text-sm italic text-neutral-500">üretilmedi</div>
                )}
              </div>
            )}

            {showList && (
              <div className={`w-full ${showCard || showPin ? "border-t pt-3" : ""}`}>
                <div className="text-xs text-neutral-500">Kullanıcı + Şifre ile giriş</div>
                <div className="font-mono text-sm font-semibold">@{user?.username}</div>
                {password ? (
                  <div className="font-mono text-lg font-bold tracking-wider">{password}</div>
                ) : (
                  <div className="text-xs italic text-neutral-500">şifre belirlendi</div>
                )}
              </div>
            )}

            <div className="mt-1 text-sm font-bold">{user?.fullName}</div>
          </div>
        )}

        <div className="rounded-md border bg-muted/20 p-2 text-center text-xs text-muted-foreground">
          <KeySquare className="mr-1 inline h-3 w-3" />
          Bu kimlikleri istediğiniz zaman Kullanıcı → Hızlı PIN / Personel Kartı
          sekmelerinden görebilir ve yenileyebilirsiniz.
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={onManage}>
            <Settings2 className="h-4 w-4" /> PIN / kartı yönet
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => printDocumentArea(areaRef.current)}
              disabled={loadingCred}
            >
              Yazdır
            </Button>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Tamam
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
