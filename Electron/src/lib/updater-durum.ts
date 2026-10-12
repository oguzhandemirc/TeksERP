import type { UpdateState, UpdateStatus } from "@shared/ipc-contract";
import { GROUP_UNKNOWN_TEXT } from "@shared/update-feed";
import type { CalloutTone } from "@/components/ui/callout";

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
 * geldiğinde de kimse bakmaz. Hata metni Sistem → Güncellemeler sayfasının
 * "Bu bilgisayar" satırında (`panelRowState`, ve `main.log`'da) yazılıdır — orası
 * onu ARAYAN kişinin gittiği yerdir, sürekli bakılan bir yüzey değil.
 */
export function guncellemeRozeti(state: UpdateState | undefined): GuncellemeRozeti | null {
  switch (state) {
    case "checking":
      return { metin: "kontrol ediliyor…", sinif: "text-muted-foreground" };
    case "available":
    case "downloading":
      return { metin: "güncelleme iniyor", sinif: "text-info" };
    case "ready":
      // Kurulum tetiği (`UpdateGate`) her ekranda çizildiği için bu vaat doğrudur.
      return { metin: "güncelleme hazır — birazdan kurulur", sinif: "text-info" };
    case "up-to-date":
      return { metin: "güncel", sinif: "text-success" };
    default:
      return null;
  }
}

/** Güncellemeler sayfasının "Bu bilgisayar" satırı: durum cümlesi + ton; `sorun` → tek eylem "Yeniden dene". */
export interface PanelRowState {
  metin: string;
  ton: CalloutTone;
  sorun: boolean;
  /** İndirilen sürüm hazır — "Yeniden başlat" (kur) düğmesi çizilir. */
  kurulabilir: boolean;
}

const satir = (metin: string, ton: CalloutTone, ek: Partial<PanelRowState> = {}): PanelRowState => ({
  metin,
  ton,
  sorun: false,
  kurulabilir: false,
  ...ek,
});

/**
 * Satırın UZUN karşılığı (rozetin cümlesi). Rozetten ayrı çünkü burada hata SÖYLENİR: sayfaya gelen kişi
 * sebebi arıyordur. İmza reddi ağ hatası değildir — kurulmayan güncellemenin güvenlik uyarısı (kod teşhis için).
 */
export function panelRowState(s: UpdateStatus): PanelRowState {
  if (!s.enabled) return satir("Geliştirme modunda — otomatik güncelleme kapalı", "muted");
  // Ortak paket: grup kiradan gelmedi → denetim yapılmadı (hata değil, bekleyen ön koşul).
  if (s.grup === null && s.state === "idle") return satir(GROUP_UNKNOWN_TEXT, "muted");
  switch (s.state) {
    case "checking":
      return satir("Denetleniyor…", "muted");
    case "up-to-date":
      return satir("✓ Güncel", "success");
    case "available":
      return satir(`Yeni sürüm ${s.newVersion ?? "?"} — indiriliyor`, "info");
    case "downloading":
      return satir(`İndiriliyor %${s.percent ?? 0}`, "info");
    case "ready":
      return satir(`Yeni sürüm ${s.newVersion ?? "?"} hazır — yeniden başlatınca kurulur`, "info", { kurulabilir: true });
    case "error":
      return s.imzaReddi
        ? satir(`${s.error ?? "Güncelleme güvenlik denetiminden geçemedi; kurulmadı."} (${s.imzaReddi.kod})`, "danger", { sorun: true })
        : satir(s.error ?? "Güncelleme denetimi başarısız oldu.", "warning", { sorun: true });
    default:
      return satir("Henüz denetlenmedi", "muted");
  }
}
