import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdater } from "@/hooks/useUpdater";
import { guncellemeRozeti } from "@/lib/updater-durum";
import { UPDATE_CHECK_INTERVAL_LABEL } from "@shared/update-schedule";
import { cn } from "@/lib/utils";

/**
 * TOPBAR — "güncelleme denetle" düğmesi (2026-09-04 kullanıcı isteği).
 *
 * Neden burada: sürüm çıkıldığında sahadaki soru *"bende var mı?"*dır ve
 * cevabına giden yol üç tıklama derindeydi (Sistem → Güncelleme). Zil/yenile
 * düğmelerinin yanında tek tık; ritmi beklemek istemeyen kişi kendisi sorar.
 *
 * ⚠️ DURUM EŞLEMESİ BURADA YAZILMAZ: `@/lib/updater-durum` tek kaynaktır
 * (giriş rozeti + sidebar footer'ı da onu okur). İkinci bir eşleme, aynı
 * makinede aynı anda iki farklı cümle demekti.
 *
 * ⚠️ HATA KIRMIZI BASMAZ: tek kaynak `error`/`idle` için `null` döner, yani
 * düğme nötr görünür. İnternete çıkamayan makinede her denetlemede kırmızı
 * yanan bir düğme, gerçek güncelleme geldiğinde de görmezden gelinir. Hata
 * metni Sistem → Güncelleme ekranındadır.
 *
 * ⚠️ KENDİ ZAMANLAYICISINI KURMAZ. Periyodik kontrol main process'te TEK
 * yerdedir (`electron/ipc/updater.ipc.ts` + `@shared/update-schedule`); bu
 * düğme yalnız durumu dinler ve elle `check()` çağırır.
 */
export function GuncellemeDugmesi() {
  const { status, check } = useUpdater();
  const [kontrolEdiliyor, setKontrolEdiliyor] = useState(false);

  // Tarayıcı paneli / birim testi: `window.api.updater` yok → denetlenecek bir
  // güncelleyici de yok. Çalışmayan bir düğme çizmek yerine hiç çizme.
  if (!status) return null;

  const rozet = guncellemeRozeti(status.state);
  const iniyor = status.state === "downloading";
  const paketHazir = status.state === "ready";
  const mesgul = kontrolEdiliyor || status.state === "checking";

  const durumEki = rozet
    ? ` · ${rozet.metin}${iniyor && status.percent != null ? ` %${status.percent}` : ""}`
    : "";
  const baslik = status.enabled
    ? `Güncellemeyi denetle${durumEki} — ${UPDATE_CHECK_INTERVAL_LABEL} kendiliğinden denetlenir`
    : "Güncelleme denetimi geliştirme modunda kapalı";

  const handleClick = async () => {
    setKontrolEdiliyor(true);
    try {
      await check();
    } finally {
      setKontrolEdiliyor(false);
    }
  };

  const Ikon = paketHazir || iniyor || status.state === "available" ? Download : RefreshCw;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Güncellemeyi denetle${durumEki}`}
      title={baslik}
      disabled={!status.enabled || mesgul || iniyor}
      onClick={() => void handleClick()}
    >
      <Ikon className={cn("h-4 w-4", rozet?.sinif, mesgul && "animate-spin")} />
    </Button>
  );
}
