import { useNavigate } from "react-router-dom";
import { EyeOff, LayoutGrid, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth";
import { canEnterApp } from "@/types/auth";
import { BOSS_PATH } from "@/lib/boss-path";

/**
 * "Bu ekran özet görünümünde yok" — `BossRootLayout`un kapalı yollar için
 * çizdiği sayfa.
 *
 * ⚠️ BOŞ SAYFA BIRAKILMAZ. Kapalı bir yola hash ile gidildiğinde `Outlet`i
 * çizmemek tek başına beyaz bir ekran üretirdi: hata yok, log yok, kullanıcı
 * uygulamanın donduğunu sanar. Bu tam olarak `#/2fa-kurulum` vakasının sınıfı
 * (`App.tsx` kapı yorumunda kayıtlı) ve orada da çözüm ekranı ÇİZMEKTİ.
 *
 * ⚠️ METİN "YETKİN YOK" DEMEZ. Burada bir izin reddi yaşanmıyor; yüzey bu
 * kabukta bilerek gösterilmiyor. Yanlış cümle, kullanıcıyı yöneticisinden
 * olmayan bir yetki istemeye yollar (ve yönetici de onu bulamaz).
 */
export function BossUnavailablePage() {
  const nav = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canOpenFullPanel = Boolean(user && canEnterApp(user.permissions));

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <div className="rounded-full bg-muted p-3">
        <EyeOff className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-base font-semibold">Bu ekran özet görünümünde yok</h1>
        <p className="text-sm text-muted-foreground">
          Özet görünümü yalnız <strong>Operasyonlar</strong> ve <strong>Raporlar</strong>{" "}
          yüzeylerini taşır. Tanımlar, sistem ayarları ve yetkilendirme ekranları
          buraya çizilmez — yetkinizle ilgili bir durum değildir.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" size="sm" onClick={() => nav(BOSS_PATH)}>
          <Undo2 className="mr-2 h-4 w-4" />
          Fabrika Özeti
        </Button>
        {canOpenFullPanel && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              // Hash'i temizlemek `Root` kapısını AppShell'e çevirir (BossShell
              // başlığındaki "Tam panele geç" düğmesiyle AYNI yol — iki farklı
              // geçiş yolu, iki farklı davranış demek olurdu).
              window.location.hash = "#/";
            }}
          >
            <LayoutGrid className="mr-2 h-4 w-4" />
            Tam panele geç
          </Button>
        )}
      </div>
    </div>
  );
}
