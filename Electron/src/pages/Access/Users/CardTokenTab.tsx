import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { IdCard, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useEnabledLoginMethods } from "@/hooks/usePricingEnabled";
import { printDocumentArea } from "@/lib/print";
import { adminUserService } from "@/services/adminUserService";
import { MethodDisabledNotice } from "./MethodDisabledNotice";

interface Props {
  userId: string;
  username: string;
  fullName: string;
}

/**
 * QR personel kartı — mobil kartla giriş için ("QR Personel Kartı" yöntemi etkinken).
 * Kart QR'ı HER ZAMAN görünür (yalnız yönetici görür); yenilemek isteyince TEYİT
 * alınır (eski kart anında ölür — kayıp kart senaryosu). Açık JWT oturumları
 * etkilenmez. QR içeriği "TEKSU:<userId>:<token>".
 */
export function CardTokenTab({ userId, username, fullName }: Props) {
  const qc = useQueryClient();
  const methodEnabled = useEnabledLoginMethods().includes("card");
  const areaRef = useRef<HTMLDivElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const credQ = useQuery({
    queryKey: ["admin-user-credentials", userId],
    queryFn: () => adminUserService.getCredentials(userId),
  });
  const cardCode = credQ.data?.data.cardCode ?? null;

  const rotate = useMutation({
    mutationFn: () => adminUserService.rotateCardToken(userId),
    onSuccess: (res) => {
      setConfirmOpen(false);
      toast.success(
        res.data.rotated
          ? "Kart YENİLENDİ — eski kart artık geçersiz, yenisini basıp teslim edin"
          : "Personel kartı oluşturuldu — yazdırıp teslim edin",
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
            Kartla giriş, Genel Ayarlar → Oturum & Güvenlik'te "QR Personel Kartı" yöntemi
            etkinken çalışır. Kart kaybolursa "Yenile" — eski kart anında geçersiz olur.
          </p>
        </div>
      </div>

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
              <RefreshCcw className="h-3.5 w-3.5" /> Yenile
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
        title="Personel kartını yenile"
        description={`${fullName} için yeni bir kart üretilecek. Eski kart ANINDA geçersiz olur — kullanıcı yeni kartı almadan kartla giremez. Açık oturumları etkilenmez. Devam edilsin mi?`}
        confirmLabel="Yenile"
        destructive
        isPending={rotate.isPending}
        onConfirm={() => rotate.mutate()}
      />
    </div>
  );
}
