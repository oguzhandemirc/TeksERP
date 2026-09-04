import { useEffect, useState } from "react";
import { useUpdater } from "@/hooks/useUpdater";
import { guncellemeRozeti } from "@/lib/updater-durum";

/**
 * Giriş ekranının altındaki sürüm + güncellik satırı.
 *
 * Neden burada: "hangi sürümdeyim / güncel miyim" soruları sahada en sık giriş
 * ekranında sorulur — telefonla destek isteyen kişiye okutulacak ilk bilgi budur.
 * Giriş sonrası aynı bilgi sidebar'ın altında durur (orası tıklanınca sürüm
 * notlarını da açar).
 *
 * ⚠️ Hata durumu GÖSTERİLMEZ: internete çıkamayan bir makine her açılışta
 * kırmızı bir şey görürse gösterge körleşir. O bilgi Genel Ayarlar →
 * Bu Bilgisayar → Güncelleme'de yazılıdır.
 *
 * ⚠️ `app-no-drag`: giriş penceresinin kökü OS sürükleme bölgesidir; bunu beyan
 * etmeyen bir eleman üstte çizilse de tıklamayı pencere-taşımaya kaptırır.
 * Rozet tıklanabilir değil ama metin seçilebilir olsun diye yine de beyan edilir.
 *
 * ⚠️ Konum SAĞ ALT (2026-09-04). Eskiden ortalıydı ve giriş formunun altındaki
 * boşlukta duruyordu; aynı satırın solunda `LoginHero`nun sabit `v1.0` yazısı
 * vardı — iki ayrı "sürüm" göstergesi, biri yalan. Sabit olan kaldırıldı,
 * gerçek olan köşeye alındı.
 */
export function SurumRozeti() {
  const { status } = useUpdater();
  const [surum, setSurum] = useState<string | null>(null);

  useEffect(() => {
    let aktif = true;
    const p = window.api?.appInfo?.version?.();
    if (p) void p.then((v) => aktif && setSurum(v)).catch(() => {});
    return () => {
      aktif = false;
    };
  }, []);

  // ⚠️ Eşleme burada YAZILMAZ — tek kaynak `@/lib/updater-durum` (sidebar
  // footer'ı ve topbar denetleme düğmesi de onu okur). `error`/`idle` `null`
  // döner; kırmızı basmama kuralı orada gerekçesiyle yazılı.
  const durum = guncellemeRozeti(status?.state);

  return (
    <div className="app-no-drag pointer-events-none absolute bottom-2 right-3">
      <span className="text-[11px] font-medium text-muted-foreground">
        TeksERP{surum ? ` v${surum}` : ""}
        {durum ? <span className={durum.sinif}> · {durum.metin}</span> : null}
      </span>
    </div>
  );
}
