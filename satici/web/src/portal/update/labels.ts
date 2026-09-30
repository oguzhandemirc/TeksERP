// GÜNCELLEME (Dağıtım v2) ekran adları ve biçim desenleri — protokolün (`lisans-protokol/guncelleme.ts` ·
// `belgeler.ts`) ve satıcının (`services/update-policy.service.ts`) değer listelerinin AYNASI; bekçi
// `src/test/mirrors.test.ts` iki yönlü ölçer. Karar sunucuda; burada yalnız gösterim ve ön doğrulama.
import type { UpdatePolicy, UpdateWindow } from "../../shared/types";

export const UPDATE_MODE_LABEL: Record<string, string> = {
  OTOMATIK: "Otomatik (pencerede)",
  ONAYLI: "Onaylı (fabrikada onayla)",
  DONDUR: "Dondurulmuş",
};

/** Kip seçiminin açıklaması (form). */
export const UPDATE_MODE_HINT: Record<string, string> = {
  OTOMATIK: "Yeni sürüm pencere içinde kendiliğinden kurulur.",
  ONAYLI: "Yeni sürüm yalnız fabrikada yetkili biri onaylayınca kurulur (bugünkü davranış).",
  DONDUR: "Hiçbir sürüm kurulmaz; fabrikadaki onay da açmaz.",
};

export const UPDATE_DECISION_LABEL: Record<string, string> = {
  GUNCEL: "Güncel",
  DONDURULDU: "Dondurulmuş",
  UYGUN_DEGIL: "Uygun değil",
  ONAY_BEKLIYOR: "Onay bekliyor",
  PENCERE_BEKLIYOR: "Pencere bekliyor",
  KUR: "Kuruluyor",
};

export const UPDATE_REASON_LABEL: Record<string, string> = {
  KIRA_YOK: "Geçerli kira yok",
  YAPTIRIM: "K1 güncelleme dondurma",
  POLITIKA: "Politika: dondurulmuş",
  ADAY_YOK: "Kanalda sürüm yok",
  SURUM_GUNCEL: "Kurulu sürüm güncel",
  HEDEF_ULASILDI: "Sabitlenen sürüme ulaşıldı",
  KURULU_SURUM_BICIMSIZ: "Kurulu sürüm okunamadı",
  HEDEF_DISI: "Sabitlenen sürümün ötesinde",
  KAYNAK_SURUM_ESKI: "Kurulu sürüm bu güncelleme için çok eski",
  HAK_YOK: "Lisans hakkı yok",
  BAKIM_DISI: "Bakım süresinden sonraki derleme",
  PG_OLCULEMEDI: "PostgreSQL sürümü ölçülemedi",
  PG_ANA_SURUM: "PostgreSQL ana sürümü uyumsuz",
  PG_SURUMU_ESKI: "PostgreSQL sürümü eski",
  PENCERE_YOK: "Otomatik kip ama pencere yok",
  ONAY_HEMEN: "Fabrikada onaylandı (hemen)",
  PENCERE: "Pencere açık",
};

export const UPDATER_STATE_LABEL: Record<string, string> = {
  CALISIYOR: "Çalışıyor",
  DURDU: "Durdu",
  YOK: "Kurulu değil",
  OLCULEMEDI: "Ölçülemedi",
};

export const UPDATE_RESULT_LABEL: Record<string, string> = {
  BASARILI: "Başarılı",
  GERI_DONDU: "Geri döndü (önceki sürüm çalışıyor)",
  BASARISIZ: "Başarısız",
};

/** Sonuç kodlarının BELGELİ kümesi; tel desenle kabul eder — tanınmayan kod olduğu gibi gösterilir. */
export const UPDATE_RESULT_CODE_LABEL: Record<string, string> = {
  INDIRME_HATASI: "İndirme hatası",
  IMZA_GECERSIZ: "İmza geçersiz",
  PAKET_OZETI: "Paket özeti tutmuyor",
  PAKET_BAGI: "Paket bildirimle bağlanmıyor",
  BUTUNLUK_GECERSIZ: "Bütünlük listesi geçersiz",
  DISK_DOLU: "Disk dolu",
  DOSYA_KILITLI: "Dosya kilitli",
  YEDEK_HATASI: "Yedek alınamadı",
  DURDURMA_HATASI: "Hizmet durdurulamadı",
  PG_GUNCELLEME_HATASI: "PostgreSQL güncellenemedi",
  GOC_HATASI: "Veritabanı göçü başarısız",
  BASLATMA_HATASI: "Hizmet başlatılamadı",
  SAGLIK_HATASI: "Sağlık denetimi başarısız",
  KESINTI: "Yarıda kesildi",
  GERI_DONUS_HATASI: "Geri dönüş başarısız",
  BILINMEYEN: "Bilinmeyen hata",
};

/** Kurulum kaydı defterinin güncelleme olayları (sunucu `UPDATE_POLICY_EVENT` · `UPDATE_RESULT_EVENTS`). */
export const UPDATE_POLICY_EVENT = "GUNCELLEME_POLITIKASI";
export const UPDATE_RESULT_EVENTS: Record<string, string> = {
  BASARILI: "GUNCELLEME_BASARILI",
  GERI_DONDU: "GUNCELLEME_GERI_DONDU",
  BASARISIZ: "GUNCELLEME_BASARISIZ",
};
export const UPDATE_EVENT_LABEL: Record<string, string> = {
  GUNCELLEME_POLITIKASI: "Politika değişti",
  GUNCELLEME_BASARILI: "Güncelleme başarılı",
  GUNCELLEME_GERI_DONDU: "Güncelleme geri döndü",
  GUNCELLEME_BASARISIZ: "Güncelleme başarısız",
};

/** Protokol `ReleaseVersionSchema` (sabitlenen sürüm). */
export const RELEASE_VERSION_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z]{1,20}(\.[0-9A-Za-z]{1,20}){0,3})?$/;
/** Protokol `ClockStartSchema` / `ClockEndSchema` (bitişte "24:00" gün sonudur). */
export const WINDOW_START_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const WINDOW_END_PATTERN = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;

/** ISO haftası: 1 = Pazartesi … 7 = Pazar. */
export const WEEKDAYS: readonly (readonly [number, string])[] = [
  [1, "Pzt"],
  [2, "Sal"],
  [3, "Çar"],
  [4, "Per"],
  [5, "Cum"],
  [6, "Cmt"],
  [7, "Paz"],
];

export function windowText(w: UpdateWindow | null, timeZone?: string): string {
  if (!w) return "Yok";
  const days = w.gunler.length === 7 ? "Her gün" : WEEKDAYS.filter(([d]) => w.gunler.includes(d)).map(([, n]) => n).join(", ");
  const overnight = w.bitis !== "24:00" && w.bitis < w.baslangic ? " (ertesi gün)" : "";
  return `${days} · ${w.baslangic}–${w.bitis}${overnight}${timeZone ? ` · ${timeZone}` : ""}`;
}

export function policyText(p: UpdatePolicy): string {
  const parts = [UPDATE_MODE_LABEL[p.kip] ?? p.kip];
  if (p.pencere) parts.push(windowText(p.pencere));
  if (p.hedefSurum) parts.push(`sabit ${p.hedefSurum}`);
  return parts.join(" · ");
}
