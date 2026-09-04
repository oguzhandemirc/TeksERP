import type { UpdateState } from "@shared/ipc-contract";

/** Durumun kısa (rozet) karşılığı: gösterilecek metin + renk sınıfı. */
export interface GuncellemeRozeti {
  metin: string;
  sinif: string;
}

/**
 * GÜNCELLEME DURUMUNUN KISA KARŞILIĞI — TEK KAYNAK.
 *
 * Üç yüzey bunu kullanır: giriş ekranı rozeti (`SurumRozeti`), sidebar footer'ı
 * (`SidebarFooter`) ve topbar'daki denetleme düğmesi (`GuncellemeDugmesi`).
 * Eşleme eskiden İKİ yerde birebir kopyalanmıştı; üçüncü yüzey yazılırken tek
 * kaynağa alındı — kopyalar ayrışsaydı aynı makine aynı anda iki farklı şey
 * derdi ("güncel" ↔ boş) ve hangisinin doğru olduğu okunamazdı.
 *
 * `null` = gösterilecek bir şey yok; çağıran satırı/etiketi HİÇ çizmez —
 * bilgi vermeyen gösterge yer kaplamamalı.
 *
 * ⚠️ `error` ve `idle` BİLEREK `null` döner. İnternete çıkamayan bir makine her
 * açılışta kırmızı bir şey görürse gösterge körleşir: gerçek bir güncelleme
 * geldiğinde de kimse bakmaz. Hata metni Genel Ayarlar → Bu Bilgisayar →
 * Güncelleme ekranında (ve `main.log`'da) yazılıdır — orası onu ARAYAN kişinin
 * gittiği yerdir, sürekli bakılan bir yüzey değil.
 */
export function guncellemeRozeti(state: UpdateState | undefined): GuncellemeRozeti | null {
  switch (state) {
    case "checking":
      return { metin: "kontrol ediliyor…", sinif: "text-muted-foreground" };
    case "available":
    case "downloading":
      return { metin: "güncelleme iniyor", sinif: "text-info" };
    case "ready":
      return { metin: "yeniden başlatılacak", sinif: "text-info" };
    case "up-to-date":
      return { metin: "güncel", sinif: "text-success" };
    default:
      return null;
  }
}
