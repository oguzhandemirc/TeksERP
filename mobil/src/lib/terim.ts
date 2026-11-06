// Kullanıcıya görünen iş emri adlarının TEK KAYNAĞI (WeavingOrder = "Dokuma İş Emri", WorkOrder = "Terbiye İş Emri").
// Kaynak Teks-Erp/src/constants/terim.ts; Electron · mobil · patron/uygulama src/lib/terim.ts BAYT-EŞİT aynadır —
// değişiklik kaynakta yapılır, sonra `cp -p` (bekçi: Teks-Erp/scripts/test_terim_eski_ad.ts). Büyük harf biçimleri elle yazılır.
// K20 (2026-11-03): WorkOrder adı dokuma rejiminden ÇÖZÜLÜR — dokuma kapalı "İş Emri", açık/bilinmiyor "Terbiye İş Emri".
// Rejimi her yüzey kendi kaynağından `terimDokumaAyarla` ile bildirir; `TERIM.terbiyeIsEmri` okuma anında çözülür
// (modül düzeyinde bir kez okunup saklanan değer donar — okumayı fonksiyon/getter içinde yap).
/** Bir biçimin Türkçe hâl çekimleri. */
export interface TermCases {
  /** yalın: "İş Emri" */
  readonly yalin: string;
  /** belirtme (-i): "İş Emrini" */
  readonly belirtme: string;
  /** yönelme (-e): "İş Emrine" */
  readonly yonelme: string;
  /** bulunma (-de): "İş Emrinde" */
  readonly bulunma: string;
  /** ayrılma (-den): "İş Emrinden" */
  readonly ayrilma: string;
  /** ilgi (-in): "İş Emrinin" */
  readonly ilgi: string;
  /** vasıta (ile): "İş Emriyle" */
  readonly vasita: string;
}

export interface Term {
  /** Başlık biçimi, tekil: "Terbiye İş Emri" (başlık, menü, sütun, etiket). */
  readonly tekil: string;
  /** Başlık biçimi, çoğul: "Terbiye İş Emirleri". */
  readonly cogul: string;
  /** Cümle içi, tekil: "terbiye iş emri". */
  readonly tekilKucuk: string;
  /** Cümle içi, çoğul: "terbiye iş emirleri". */
  readonly cogulKucuk: string;
  /** Büyük harf, tekil: "TERBİYE İŞ EMRİ" (belge başlığı). */
  readonly tekilBuyuk: string;
  /** Büyük harf, çoğul: "TERBİYE İŞ EMİRLERİ". */
  readonly cogulBuyuk: string;
  /** Tekil çekimler, başlık biçimi. */
  readonly cekim: TermCases;
  /** Tekil çekimler, cümle içi. */
  readonly cekimKucuk: TermCases;
  /** Çoğul çekimler, başlık biçimi. */
  readonly cogulCekim: TermCases;
  /** Çoğul çekimler, cümle içi. */
  readonly cogulCekimKucuk: TermCases;
  /** Tekil çekimler, cümle başı: "Terbiye iş emri bulunamadı". */
  readonly cumleBasi: TermCases;
  /** Çoğul çekimler, cümle başı: "Terbiye iş emirleri". */
  readonly cumleBasiCogul: TermCases;
}

/** Elle TR katlama — `toLocale*` yasak; İ/I/ı farkı açıkça. */
function kucuk(s: string): string {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}
function buyuk(s: string): string {
  return s.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
}
/** Yalnız ilk harf büyük (cümle başı), gerisi küçük. */
function basBuyuk(s: string): string {
  const k = kucuk(s);
  return buyuk(k.slice(0, 1)) + k.slice(1);
}
/** Yalın biçimden hâl çekimleri — her terim "-i" ile biter (emri / emirleri). */
function cekimKur(yalin: string): TermCases {
  return {
    yalin,
    belirtme: `${yalin}ni`,
    yonelme: `${yalin}ne`,
    bulunma: `${yalin}nde`,
    ayrilma: `${yalin}nden`,
    ilgi: `${yalin}nin`,
    vasita: `${yalin}yle`,
  };
}
function terimKur(tekil: string, cogul: string): Term {
  return Object.freeze({
    tekil,
    cogul,
    tekilKucuk: kucuk(tekil),
    cogulKucuk: kucuk(cogul),
    tekilBuyuk: buyuk(tekil),
    cogulBuyuk: buyuk(cogul),
    cekim: cekimKur(tekil),
    cekimKucuk: cekimKur(kucuk(tekil)),
    cogulCekim: cekimKur(cogul),
    cogulCekimKucuk: cekimKur(kucuk(cogul)),
    cumleBasi: cekimKur(basBuyuk(tekil)),
    cumleBasiCogul: cekimKur(basBuyuk(cogul)),
  });
}

/** WorkOrder adının iki biçimi: dokuma rejimi açıkken ayırt edici, kapalıyken yalın (K20). */
export const IS_EMRI_BICIMLERI = {
  terbiye: terimKur("Terbiye İş Emri", "Terbiye İş Emirleri"),
  yalin: terimKur("İş Emri", "İş Emirleri"),
} as const;

const DOKUMA_IS_EMRI = terimKur("Dokuma İş Emri", "Dokuma İş Emirleri");

/** Rejim bilinmeden (ilk çizim, test, rejimi bildirmeyen yüzey) bugünkü ad: "Terbiye İş Emri". */
let dokumaRejimi = true;

/**
 * Dokuma rejimini bildirir (etkin `production ∧ dokuma`). Değer DEĞİŞTİYSE true döner —
 * çağıran isterse yeniden çizim/kalıcı saklama yapar.
 */
export function terimDokumaAyarla(dokumaAcik: boolean): boolean {
  const degisti = dokumaRejimi !== dokumaAcik;
  dokumaRejimi = dokumaAcik;
  return degisti;
}

/** Şu an çözülen rejim (test/teşhis). */
export function terimDokumaRejimi(): boolean {
  return dokumaRejimi;
}

export const TERIM = {
  /** WorkOrder — okuma anında rejimden çözülür. */
  get terbiyeIsEmri(): Term {
    return dokumaRejimi ? IS_EMRI_BICIMLERI.terbiye : IS_EMRI_BICIMLERI.yalin;
  },
  /** WeavingOrder */
  dokumaIsEmri: DOKUMA_IS_EMRI,
};

export type TermKey = keyof typeof TERIM;

// Ekran / menü ADLARI sözlüğü (UX-2 K4): aynı kavram her yüzeyde (panel karo · katalog · palet · tablet · patron) aynı adla.
// Çekim gerektirmeyen başlık adlarıdır; çekimli iş emri adları yukarıda (`TERIM`). Kurşun Planlama (panel, plan) ile
// Kurşun Dağıtım (tablet, sahada dağıtım) BİLEREK iki ayrı iştir — iki ad.
export const TERIM_AD = {
  onMuhasebe: "Ön Muhasebe",
  kaliteGuvence: "Kalite Güvence",
  belgeler: "Belgeler",
  tartiPaket: "Tartı & Paket",
  kursunPlanlama: "Kurşun Planlama",
  kursunDagitim: "Kurşun Dağıtım",
  tezgahAlarmlari: "Tezgah Alarmları",
  tezgahEkrani: "Tezgah Ekranı",
  // Duruş ekranı dokuma rejiminde "Tezgah", dokumasız makine duruşu rejiminde (D4-A3) "Makine" adını taşır.
  tezgahDuruslari: "Tezgah Duruşları",
  makineDuruslari: "Makine Duruşları",
  etkinlikGunlugu: "Etkinlik Günlüğü",
  etkinlikArsivi: "Etkinlik Arşivi",
  makineVeriToplayicilari: "Makine Veri Toplayıcıları",
  bildirimAyarlari: "Bildirim Ayarları",
  bildirimProfilleri: "Bildirim Profilleri",
  // Eski ad "Sevkiyatlar (Muhasebe)" (KÜÇÜK-F): yalnız sevk EDİLMİŞ (DISPATCHED) sevkler — fiş, dönem Excel, fatura izi.
  sevkEdilenler: "Sevk Edilenler",
  // Gelen belgenin onayda doğan özet satırı (enum `ARABA`): partinin sisteme tek top olarak girilen kaydı. "Araba" adı
  // yük birimiyle (çuvalsız sevk) çakıştığı için görünen ad budur; enum/veri değişmez.
  partiKaydi: "Parti kaydı",
  partiKayitlari: "Parti kayıtları",
  // İş emri türü `CUSTOMER_GOODS_SERVICE`: müşterinin malına hizmet. Giden fason (Fason Sevk/Kabul) ile karışmasın diye
  // ad "(müşteri malı)" ekini HEP taşır.
  fasonMusteriMali: "Fason (müşteri malı)",
  // "KK2" (kurşun sonrası kalite kontrolü) sahada jargondur; operatöre görünen ad bu. Enum/kod adı değişmez.
  kaliteKontrol: "Kalite Kontrol",
} as const;

export type TermAdKey = keyof typeof TERIM_AD;
