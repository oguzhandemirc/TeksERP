import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, IdCard, RefreshCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useEnabledLoginMethods } from "@/hooks/usePricingEnabled";
import { formatFactory } from "@/lib/factory-time";
import { printDocumentArea } from "@/lib/print";
import { adminUserService } from "@/services/adminUserService";
import { MethodDisabledNotice } from "./MethodDisabledNotice";

interface Props {
  userId: string;
  username: string;
  fullName: string;
}

/**
 * QR personel kartı — mobil kartla giriş için. Kart sırrı sunucuda geri çevrilemez ÖZET olarak
 * saklanır: QR yalnız basıldığı an (ve kısa basım penceresinde) görünür; kayıp ya da eski kartta
 * "Yeniden bas" yeni sır üretir, eski kart anında ölür. Açık oturumlar etkilenmez.
 */
export function CardTokenTab({ userId, username, fullName }: Props) {
  const qc = useQueryClient();
  const methodEnabled = useEnabledLoginMethods().includes("card");
  const areaRef = useRef<HTMLDivElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  const credQ = useQuery({
    queryKey: ["admin-user-credentials", userId],
    queryFn: () => adminUserService.getCredentials(userId),
  });
  const cred = credQ.data?.data;
  const cardSet = cred?.cardSet ?? false;
  // Yazdırılabilir QR yalnız elde düz kod varken: yeni basım ya da henüz dönüştürülmemiş eski kart.
  const cardCode = issued ?? cred?.cardCode ?? null;

  const rotate = useMutation({
    mutationFn: () => adminUserService.rotateCardToken(userId),
    onSuccess: (res) => {
      setConfirmOpen(false);
      setIssued(res.data.cardCode);
      toast.success(
        res.data.rotated
          ? "Kart YENİLENDİ — eski kart artık geçersiz, yenisini şimdi yazdırıp teslim edin"
          : "Personel kartı oluşturuldu — şimdi yazdırıp teslim edin",
      );
      void qc.invalidateQueries({ queryKey: ["admin-user-credentials", userId] });
    },
  });

  if (credQ.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      {!methodEnabled && <MethodDisabledNotice label="QR Personel Kartı" />}
      <div className="flex gap-3 rounded-md border bg-card p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <IdCard className="h-4 w-4" />
        </div>
        <div className="text-sm">
          <p className="font-medium">
            <span className="font-mono">{username}</span> için QR personel kartı
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Kartla giriş, Sistem → Şirket & Güvenlik → Oturum & Güvenlik'te "QR Personel Kartı" yöntemi
            etkinken çalışır. Kart kodu sunucuda geri çevrilemez saklanır: QR yalnız basıldığı an
            görünür. Kart kaybolursa "Yeniden bas" — eski kart anında geçersiz olur.
          </p>
        </div>
      </div>

      {cred && cardSet && cred.cardLegacy && !issued && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            Bu kart eski (kısa kodlu) biçimde basılmış — çalışmaya devam eder, ama kodu eski yedeklerde
            düz durduğu için <b>yeniden basmanız önerilir</b>.
          </span>
        </div>
      )}
      {cred && cardSet && !cred.cardKeyOk && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Bu kart bu sunucuda doğrulanamıyor (yedek başka sunucudan) — anahtarı geri yükleyin ya da yeniden basın.
        </div>
      )}

      {cardCode ? (
        <div className="space-y-3">
          <div
            ref={areaRef}
            className="print-area mx-auto flex w-full max-w-[260px] flex-col items-center gap-2 rounded-md border bg-white p-6 text-center text-black"
          >
            <QRCodeSVG value={cardCode} size={170} level="M" />
            <div className="text-base font-bold leading-tight">{fullName}</div>
            <div className="font-mono text-xs">@{username}</div>
            <div className="text-[10px] uppercase tracking-wide">Personel Kartı</div>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => printDocumentArea(areaRef.current)}>
              Yazdır
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmOpen(true)}
            >
              <RefreshCcw className="h-3.5 w-3.5" /> Yeniden bas
            </Button>
          </div>
          {issued && (
            <p className="text-center text-[11px] text-amber-600 dark:text-amber-400">
              Bu ekran kapandıktan kısa süre sonra QR bir daha gösterilmez — şimdi yazdırın.
            </p>
          )}
        </div>
      ) : cardSet ? (
        <div className="rounded-md border bg-muted/20 p-6 text-center text-sm">
          <div className="flex items-center justify-center gap-1.5 font-medium">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Kart tanımlı (kod gizli)
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {cred?.cardIssuedAt ? `Basım: ${formatFactory(cred.cardIssuedAt, "dd.MM.yyyy HH:mm")}` : "Önceki sürümden aktarıldı"}
          </div>
          <div className="mt-3">
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
              <RefreshCcw className="h-3.5 w-3.5" /> Yeniden bas
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Bu kullanıcının kartı yok.
          <div className="mt-3">
            <Button type="button" size="sm" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
              <IdCard className="h-3.5 w-3.5" /> {rotate.isPending ? "Oluşturuluyor…" : "Kart Oluştur"}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Personel kartını yeniden bas"
        description={`${fullName} için yeni bir kart üretilecek. Eski kart ANINDA geçersiz olur — kullanıcı yeni kartı almadan kartla giremez. Açık oturumları etkilenmez. Devam edilsin mi?`}
        confirmLabel="Yeniden bas"
        destructive
        isPending={rotate.isPending}
        onConfirm={() => rotate.mutate()}
      />
    </div>
  );
}
