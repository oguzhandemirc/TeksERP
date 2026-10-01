// Sunucu güncellemesi ekranının Türkçe sözlüğü — kodlar backend/güncelleyici sözleşmesinden
// (`docs/design/GUNCELLEYICI.md` §3 · §12). Tanınmayan kod kendisiyle gösterilir (yeni güncelleyici
// kodu ekranı boşaltmasın).
import type { UpdateDecisionKind, UpdatePolicyMode, UpdateResultKind, UpdateWindowRule, UpdaterState } from "@/types/server-update";

const DECISIONS: Record<UpdateDecisionKind, string> = {
  GUNCEL: "Güncel",
  DONDURULDU: "Durduruldu",
  UYGUN_DEGIL: "Uygun değil",
  ONAY_BEKLIYOR: "Onay bekliyor",
  PENCERE_BEKLIYOR: "Güncelleme penceresini bekliyor",
  KUR: "Kuruluyor",
};

const REASONS: Record<string, string> = {
  KIRA_YOK: "geçerli kira yok",
  YAPTIRIM: "lisans yaptırımı",
  POLITIKA: "satıcı güncellemeyi dondurdu",
  ADAY_YOK: "yayında sürüm yok",
  SURUM_GUNCEL: "kurulu sürüm en yenisi",
  HEDEF_ULASILDI: "sabitlenen sürüme ulaşıldı",
  KURULU_SURUM_BICIMSIZ: "kurulu sürüm okunamadı",
  HEDEF_DISI: "sabitlenen sürüm değil",
  KAYNAK_SURUM_ESKI: "önce bir ara sürüm kurulmalı",
  HAK_YOK: "lisans hakkı doğrulanamadı",
  BAKIM_DISI: "bakım süresi dışında",
  PG_OLCULEMEDI: "PostgreSQL sürümü ölçülemedi",
  PG_ANA_SURUM: "PostgreSQL ana sürümü uyumsuz",
  PG_SURUMU_ESKI: "PostgreSQL sürümü eski",
  PENCERE_YOK: "kirada güncelleme penceresi yok",
  ONAY_HEMEN: "\"Şimdi kur\" onayı",
  PENCERE: "pencere içinde",
};

const RESULT_CODES: Record<string, string> = {
  INDIRME_HATASI: "Paket indirilemedi",
  IMZA_GECERSIZ: "İmza doğrulanamadı",
  PAKET_OZETI: "Paket özeti uyuşmadı",
  PAKET_BAGI: "Paket, sürüm bildirimiyle eşleşmedi",
  BUTUNLUK_GECERSIZ: "Paket bütünlüğü geçersiz",
  DISK_DOLU: "Disk dolu",
  DOSYA_KILITLI: "Dosya kilitli — başka bir program kullanıyor (kilit kalkınca kendiliğinden sürer)",
  YEDEK_HATASI: "Güncelleme öncesi yedek alınamadı",
  DURDURMA_HATASI: "Sunucu hizmeti durdurulamadı",
  PG_GUNCELLEME_HATASI: "PostgreSQL güncellemesi başarısız",
  GOC_HATASI: "Veritabanı göçü başarısız",
  BASLATMA_HATASI: "Yeni sürüm başlatılamadı",
  SAGLIK_HATASI: "Yeni sürüm sağlık denetiminden geçemedi",
  KESINTI: "İşlem yarıda kesildi",
  GERI_DONUS_HATASI: "Geri dönüş tamamlanamadı",
  BILINMEYEN: "Bilinmeyen hata",
};

const RESULTS: Record<UpdateResultKind, string> = {
  BASARILI: "Başarılı",
  GERI_DONDU: "Geri dönüldü",
  BASARISIZ: "Başarısız — müdahale gerekiyor",
};

const UPDATER: Record<UpdaterState, string> = {
  CALISIYOR: "Çalışıyor",
  OLCULEMEDI: "Yanıt vermiyor",
  DURDU: "Durdu — müdahale gerekiyor",
  YOK: "Kurulu değil",
};

const LOCAL_STATES: Record<string, string> = {
  BEKLIYOR: "Bekliyor",
  INDIRILIYOR: "İndiriliyor",
  HAZIR: "Hazır",
  UYGULANIYOR: "Uygulanıyor",
  BASARILI: "Tamamlandı",
  GERI_DONDU: "Geri döndü",
  HATA: "Hata — müdahale gerekiyor",
};

const MODES: Record<UpdatePolicyMode, string> = {
  OTOMATIK: "Otomatik (güncelleme penceresinde)",
  ONAYLI: "Onaylı (yetkili kişi onaylar)",
  DONDUR: "Donduruldu",
};

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export const decisionLabel = (k: UpdateDecisionKind): string => DECISIONS[k] ?? k;
export const reasonLabel = (code: string | null): string | null => (code ? (REASONS[code] ?? code) : null);
export const resultCodeLabel = (code: string | null): string | null => (code ? (RESULT_CODES[code] ?? code) : null);
export const resultLabel = (k: UpdateResultKind): string => RESULTS[k] ?? k;
export const updaterLabel = (s: UpdaterState): string => UPDATER[s] ?? s;
export const localStateLabel = (s: string): string => LOCAL_STATES[s] ?? s;
export const modeLabel = (m: UpdatePolicyMode): string => MODES[m] ?? m;

/** Karar + neden tek cümle: "Uygun değil — önce bir ara sürüm kurulmalı". */
export function decisionText(karar: UpdateDecisionKind, neden: string | null): string {
  const reason = reasonLabel(neden);
  return reason ? `${decisionLabel(karar)} — ${reason}` : decisionLabel(karar);
}

/** Pencere kuralı: "Her gün 02:00–05:00" · "Pzt, Çar 23:00–02:00". */
export function windowRuleText(p: UpdateWindowRule): string {
  const days = p.gunler.length === 7 ? "Her gün" : p.gunler.map((g) => DAYS[g - 1] ?? String(g)).join(", ");
  return `${days} ${p.baslangic}–${p.bitis}`;
}

/** İndirme ilerlemesi yüzdesi; toplam bilinmiyorsa null. */
export function progressPercent(p: { indirilen: number; toplam: number } | null): number | null {
  if (!p || p.toplam <= 0) return null;
  return Math.min(100, Math.round((p.indirilen / p.toplam) * 100));
}
