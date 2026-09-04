import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Callout } from "@/components/ui/callout";
import { UpdateSection } from "@/pages/GeneralSettings/UpdateSection";
import { IS_ELECTRON } from "@/lib/runtime-env";

/**
 * GÜNCELLEME DENETLEME — kendi ekranı (2026-09-04 kullanıcı isteği: "güncelleme
 * denetleme ayrı bir yerde olsun").
 *
 * Eskiden Genel Ayarlar → Bu Bilgisayar → Güncelleme alt-sekmesiydi; yani üç
 * tıklama derinde, yazıcı/kantar/tabanca ayarlarının arasında duruyordu. Sürüm
 * çıkıldığında bakılacak İLK yer orası değildi.
 *
 * ⚠️ İÇERİK KOPYALANMADI, TAŞINDI: `UpdateSection` tek kaynak olarak kaldı
 * (durum metinleri, adres kutusu, "şimdi kur" düğmesi). İkinci bir kopya
 * yazsaydık `electron-updater` durumları iki yerde anlatılırdı.
 *
 * ⚠️ WEB'DE GÖVDE YOK: otomatik güncelleyici `window.api.updater`dır ve
 * tarayıcıda karşılığı YOKTUR. Karo da web'de çizilmez (`tile-config`
 * `desktopOnly`) — ama adresi bilen biri buraya gelirse SEBEBİNİ okumalı, boş
 * bir sayfa değil (WorkstationTabs'ın "başlık ile gövde aynı koşuldan beslenir"
 * kuralının ikizi).
 */
export function UpdatePage() {
  return (
    <PageShell>
      <PageHeader title="Güncelleme" />
      <PageBody className="max-w-3xl space-y-4 p-6">
        {IS_ELECTRON ? (
          <UpdateSection />
        ) : (
          <Callout tone="muted">
            Otomatik güncelleme yalnız masaüstü uygulamasında çalışır. Tarayıcıda açtığınız
            panel her yenilemede zaten en güncel sürümü yükler.
          </Callout>
        )}
      </PageBody>
    </PageShell>
  );
}
