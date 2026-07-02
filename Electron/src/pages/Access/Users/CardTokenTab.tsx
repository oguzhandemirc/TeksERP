import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { BadgeCheck, IdCard, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printDocumentArea } from "@/lib/print";
import { adminUserService } from "@/services/adminUserService";

interface Props {
  userId: string;
  username: string;
  fullName: string;
}

/**
 * QR personel kartı — mobil kartla giriş için (auth.loginMode="card"). "Oluştur/
 * Yenile" yeni 32-hex sır üretir; QR yazdırılıp karta basılır. ROTASYON eski
 * kartı ANINDA öldürür (kayıp kart senaryosu) — açık oturumlar etkilenmez.
 * Sır yalnız üretim anında gösterilir; sonradan tekrar görüntülenemez (yeniden
 * basmak = yenilemek).
 */
export function CardTokenTab({ userId, username, fullName }: Props) {
  const [card, setCard] = useState<{ cardCode: string; rotated: boolean } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: () => adminUserService.rotateCardToken(userId),
    onSuccess: (res) => {
      setCard(res.data);
      toast.success(
        res.data.rotated
          ? "Kart YENİLENDİ — eski kart artık geçersiz, yenisini basıp teslim edin"
          : "Personel kartı oluşturuldu — yazdırıp teslim edin",
      );
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-md border bg-card p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <IdCard className="h-4 w-4" />
        </div>
        <div className="text-sm">
          <p className="font-medium">
            <span className="font-mono">{username}</span> için QR personel kartı
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Kartla giriş "Genel Ayarlar → Oturum & Güvenlik → Giriş yöntemi: Kart" iken
            çalışır (PIN her zaman yedek kalır). Kart kaybolursa burada YENİLE — eski
            kart anında ölür. QR yalnız üretim anında gösterilir.
          </p>
        </div>
      </div>

      <Button type="button" size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        <RefreshCcw className="h-3.5 w-3.5" />
        {mutation.isPending ? "Üretiliyor…" : "Kart Oluştur / Yenile"}
      </Button>

      {card && (
        <div className="space-y-3">
          <div
            ref={areaRef}
            className="print-area mx-auto flex w-full max-w-[260px] flex-col items-center gap-2 rounded-md border bg-white p-6 text-center text-black"
          >
            <QRCodeSVG value={card.cardCode} size={170} level="M" />
            <div className="text-base font-bold leading-tight">{fullName}</div>
            <div className="font-mono text-xs">@{username}</div>
            <div className="text-[10px] uppercase tracking-wide">Personel Kartı</div>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => printDocumentArea(areaRef.current)}>
              Yazdır
            </Button>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <BadgeCheck className="h-3.5 w-3.5" />
              {card.rotated ? "Yenilendi — eski kart geçersiz" : "İlk kart"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
