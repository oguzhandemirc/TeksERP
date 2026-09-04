import { useEffect, useRef, useState } from "react";
import type { UpdateStatus } from "@shared/ipc-contract";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdater } from "@/hooks/useUpdater";
import { guncellemeRozeti } from "@/lib/updater-durum";
import { gosterElleDenetimBildirimi } from "@/lib/updater-bildirim";
import { UPDATE_CHECK_INTERVAL_LABEL } from "@shared/update-schedule";
import { cn } from "@/lib/utils";

/**
 * ELLE DENETLEMEDE DÖNÜŞ ANİMASYONUNUN ASGARİ SÜRESİ.
 *
 * Tailwind `animate-spin` bir turu **1 sn**de tamamlar; asgari süre bilerek tam
 * bir turdur. İki sebep: ① sunucu 50 ms'de cevap verdiğinde ikon hiç dönmemiş
 * gibi görünür ve kullanıcı "bastım mı?" diye tekrar basar; ② yarım turda
 * kesilen dönüş, ikonu yamuk bir açıda dondurur — "takıldı" diye okunur.
 * Uzatmanın bedeli yok: denetleme zaten arka planda bitmiştir, bekleyen tek şey
 * göstergedir. 1 sn'den uzun bir taban (2-3 sn) ise tersine, hızlı cevabı
 * yavaşmış gibi gösterirdi.
 */
export const ELLE_DENETIM_ASGARI_MS = 1000;

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
 * metni Sistem → Güncelleme ekranındadır. Aynı kural baloncuk için de geçerli
 * (`updater-bildirim.ts`).
 *
 * ⚠️ BALONCUK YALNIZ ELLE BASIŞTA. Otomatik kontrol (main process, 15 dk) ve
 * giriş anındaki kontrol bu dosyadan HİÇ geçmez — ayrım paylaşılan bir bayrakla
 * değil ÇAĞRI YERİYLE kuruludur, o yüzden "otomatik kontrol elle basışın hemen
 * ardına denk gelirse" diye bir yarış penceresi YOKTUR. Gösterilen değer de
 * yayınlanan ortak durum değil, BU tıkın `check()` çağrısının dönüşüdür.
 *
 * ⚠️ KENDİ ZAMANLAYICISINI KURMAZ. Periyodik kontrol main process'te TEK
 * yerdedir (`electron/ipc/updater.ipc.ts` + `@shared/update-schedule`); bu
 * düğme yalnız durumu dinler ve elle `check()` çağırır. Aşağıdaki tek
 * `setTimeout` bir takvim DEĞİL, animasyon tabanıdır (üstteki sabit).
 */
export function GuncellemeDugmesi() {
  const { status, check } = useUpdater();
  const [kontrolEdiliyor, setKontrolEdiliyor] = useState(false);
  // Sökülmüş bileşende durum yazmayı ve baloncuk basmayı engeller: asgari süre
  // dolmadan sekme kapanabilir (baloncuk kapanmış bir ekranın işidir).
  const ayakta = useRef(true);
  useEffect(() => {
    ayakta.current = true;
    return () => {
      ayakta.current = false;
    };
  }, []);

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
    // Animasyon ile denetleme PARALEL koşar; ikisi de bitmeden ne dönüş durur
    // ne baloncuk çıkar. `Promise.all` bilinçli — sıralı beklemek asgari süreyi
    // denetleme süresinin ÜSTÜNE eklerdi.
    const asgariAnimasyon = new Promise((c) => setTimeout(c, ELLE_DENETIM_ASGARI_MS));
    let sonuc: UpdateStatus | null = null;
    try {
      [sonuc] = await Promise.all([check(), asgariAnimasyon]);
    } catch {
      // IPC düştü: `sonuc` null kalır → baloncuk nötr "denetlenemedi" der.
      // Yutmak, basışı cevapsız bırakırdı.
      await asgariAnimasyon;
    } finally {
      if (ayakta.current) setKontrolEdiliyor(false);
    }
    if (ayakta.current) gosterElleDenetimBildirimi(sonuc);
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
