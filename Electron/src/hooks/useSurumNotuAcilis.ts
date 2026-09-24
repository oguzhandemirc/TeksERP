import { useEffect, useState } from "react";
import { SURUM_NOTLARI, damgalanacakId, gosterilecekYayinlar } from "@/lib/surum-notlari";
import { sonGorulenOku, sonGorulenYaz } from "@/lib/surum-notu-isaret";
import { useUpdater } from "@/hooks/useUpdater";
import { useSurumNotuStore } from "@/store/surum-notu";

/**
 * Açılışta "bu güncellemede neler değişti" penceresini bir kez açar.
 *
 * ⚠️ GÜNCELLEME KAPISI AÇIKKEN AÇMAZ. `UpdateGate` kapatılamaz bir kapı çiziyor
 * (`z-[100]`, geri sayımlı); altında kalan bir pencere işaretini yazamaz ve her
 * açılışta geri gelirdi. Güncelleme kapısı her zaman önceliklidir.
 *
 * Karar açılışta verilir çünkü kurulum uygulamayı yeniden başlatır — "kurulum
 * öncesi" hiçbir durum taşınamaz. Kurulu sürümü `appInfo.version()` verir.
 */
export function useSurumNotuAcilis(): { kuruluSurum: string | null } {
  const [kuruluSurum, setKuruluSurum] = useState<string | null>(null);
  const [karar, setKarar] = useState(false);
  const { status } = useUpdater();
  const ac = useSurumNotuStore((s) => s.ac);

  useEffect(() => {
    let aktif = true;
    const p = window.api?.appInfo?.version?.();
    if (p) void p.then((v) => aktif && setKuruluSurum(v)).catch(() => {});
    else setKuruluSurum(null);
    return () => {
      aktif = false;
    };
  }, []);

  // Güncelleme kapısı açık mı? (indirilmiş paket bekliyor ya da sürüm politikası
  // kilidi) — `UpdateGate` ile aynı iki sebep.
  const kapiAcik = status?.state === "ready";

  useEffect(() => {
    if (karar || !kuruluSurum || kapiAcik) return;
    setKarar(true);

    const isaret = sonGorulenOku();
    const { liste } = gosterilecekYayinlar(SURUM_NOTLARI, isaret, kuruluSurum, "panel");
    if (liste.length > 0) {
      ac();
      return;
    }
    // Gösterilecek bir şey yoksa işareti sessizce güncelle: ilk kurulumda not
    // penceresi çıkmadıysa bile bir sonraki güncellemede "aradaki her şey"
    // birden açılmasın.
    const id = damgalanacakId(SURUM_NOTLARI, kuruluSurum, "panel");
    if (id && id !== isaret) sonGorulenYaz(id);
  }, [karar, kuruluSurum, kapiAcik, ac]);

  return { kuruluSurum };
}
