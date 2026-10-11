// Kullanıcıya görünen iş emri adlarının TEK KAYNAĞI (WeavingOrder = "Dokuma İş Emri", WorkOrder = "Terbiye İş Emri").
// Kaynak Teks-Erp/src/constants/terim.ts; Electron · mobil · patron/uygulama src/lib/terim.ts BAYT-EŞİT aynadır —
// değişiklik kaynakta yapılır, sonra `cp -p` (bekçi: Teks-Erp/scripts/test_terim_eski_ad.ts). Büyük harf biçimleri elle yazılır.

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
}

export const TERIM = {
  /** WorkOrder */
  terbiyeIsEmri: {
    tekil: "Terbiye İş Emri",
    cogul: "Terbiye İş Emirleri",
    tekilKucuk: "terbiye iş emri",
    cogulKucuk: "terbiye iş emirleri",
    tekilBuyuk: "TERBİYE İŞ EMRİ",
    cogulBuyuk: "TERBİYE İŞ EMİRLERİ",
    cekim: {
      yalin: "Terbiye İş Emri",
      belirtme: "Terbiye İş Emrini",
      yonelme: "Terbiye İş Emrine",
      bulunma: "Terbiye İş Emrinde",
      ayrilma: "Terbiye İş Emrinden",
      ilgi: "Terbiye İş Emrinin",
      vasita: "Terbiye İş Emriyle",
    },
    cekimKucuk: {
      yalin: "terbiye iş emri",
      belirtme: "terbiye iş emrini",
      yonelme: "terbiye iş emrine",
      bulunma: "terbiye iş emrinde",
      ayrilma: "terbiye iş emrinden",
      ilgi: "terbiye iş emrinin",
      vasita: "terbiye iş emriyle",
    },
    cogulCekim: {
      yalin: "Terbiye İş Emirleri",
      belirtme: "Terbiye İş Emirlerini",
      yonelme: "Terbiye İş Emirlerine",
      bulunma: "Terbiye İş Emirlerinde",
      ayrilma: "Terbiye İş Emirlerinden",
      ilgi: "Terbiye İş Emirlerinin",
      vasita: "Terbiye İş Emirleriyle",
    },
    cogulCekimKucuk: {
      yalin: "terbiye iş emirleri",
      belirtme: "terbiye iş emirlerini",
      yonelme: "terbiye iş emirlerine",
      bulunma: "terbiye iş emirlerinde",
      ayrilma: "terbiye iş emirlerinden",
      ilgi: "terbiye iş emirlerinin",
      vasita: "terbiye iş emirleriyle",
    },
  },
  /** WeavingOrder */
  dokumaIsEmri: {
    tekil: "Dokuma İş Emri",
    cogul: "Dokuma İş Emirleri",
    tekilKucuk: "dokuma iş emri",
    cogulKucuk: "dokuma iş emirleri",
    tekilBuyuk: "DOKUMA İŞ EMRİ",
    cogulBuyuk: "DOKUMA İŞ EMİRLERİ",
    cekim: {
      yalin: "Dokuma İş Emri",
      belirtme: "Dokuma İş Emrini",
      yonelme: "Dokuma İş Emrine",
      bulunma: "Dokuma İş Emrinde",
      ayrilma: "Dokuma İş Emrinden",
      ilgi: "Dokuma İş Emrinin",
      vasita: "Dokuma İş Emriyle",
    },
    cekimKucuk: {
      yalin: "dokuma iş emri",
      belirtme: "dokuma iş emrini",
      yonelme: "dokuma iş emrine",
      bulunma: "dokuma iş emrinde",
      ayrilma: "dokuma iş emrinden",
      ilgi: "dokuma iş emrinin",
      vasita: "dokuma iş emriyle",
    },
    cogulCekim: {
      yalin: "Dokuma İş Emirleri",
      belirtme: "Dokuma İş Emirlerini",
      yonelme: "Dokuma İş Emirlerine",
      bulunma: "Dokuma İş Emirlerinde",
      ayrilma: "Dokuma İş Emirlerinden",
      ilgi: "Dokuma İş Emirlerinin",
      vasita: "Dokuma İş Emirleriyle",
    },
    cogulCekimKucuk: {
      yalin: "dokuma iş emirleri",
      belirtme: "dokuma iş emirlerini",
      yonelme: "dokuma iş emirlerine",
      bulunma: "dokuma iş emirlerinde",
      ayrilma: "dokuma iş emirlerinden",
      ilgi: "dokuma iş emirlerinin",
      vasita: "dokuma iş emirleriyle",
    },
  },
} as const satisfies Record<string, Term>;

export type TermKey = keyof typeof TERIM;
