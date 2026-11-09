// Alan → iş emri karşılığı kataloğu — backend `Teks-Erp/src/lib/gelen-belge/alan-hedef.ts` AYNASI (anahtar, İE adı, grup, varsayılan
// görünürlük; sıra = ekran sırası). Ayna bekçisi `__tests__/alan-hedef-ayna.test.ts`. Belge tipi düzenle (alan listesi) ve
// tanıtmanın ② Eşleme aşaması buradan okur; belge detayının Tanıma kartı sunucunun `tanima.mapping`ini çizer (türetmez).
export type FieldGroup = "KIMLIK" | "GELEN" | "HEDEF" | "URUN" | "DIGER";

export interface FieldTarget {
  woLabel: string;
  group: FieldGroup;
  defaultVisible: boolean;
}

export const FIELD_TARGETS = {
  musteri: { woLabel: "Müşteri", group: "KIMLIK", defaultVisible: true },
  partiNo: { woLabel: "Gönderen parti no", group: "KIMLIK", defaultVisible: true },
  evrakNo: { woLabel: "İrsaliye no", group: "KIMLIK", defaultVisible: true },
  toplamMetre: { woLabel: "Gelen metre", group: "GELEN", defaultVisible: true },
  toplamKg: { woLabel: "Gelen kg", group: "GELEN", defaultVisible: true },
  topAdet: { woLabel: "Top adedi", group: "GELEN", defaultVisible: false },
  hedefMetraj: { woLabel: "Hedef metraj", group: "HEDEF", defaultVisible: false },
  hedefKg: { woLabel: "Hedef kg", group: "HEDEF", defaultVisible: false },
  en: { woLabel: "En", group: "HEDEF", defaultVisible: true },
  desen: { woLabel: "Desen", group: "URUN", defaultVisible: true },
  renk: { woLabel: "Renk", group: "URUN", defaultVisible: true },
  siparisNo: { woLabel: "Sipariş no", group: "DIGER", defaultVisible: false },
  tarih: { woLabel: "Belge tarihi", group: "DIGER", defaultVisible: false },
  not: { woLabel: "Not", group: "DIGER", defaultVisible: false },
  islem: { woLabel: "İşlem (bilgi)", group: "DIGER", defaultVisible: false },
  gonderenIsEmriNo: { woLabel: "Gönderen İE no", group: "DIGER", defaultVisible: false },
} as const satisfies Record<string, FieldTarget>;

export type TargetFieldKey = keyof typeof FIELD_TARGETS;

export const FIELD_GROUP_ORDER: readonly FieldGroup[] = ["KIMLIK", "GELEN", "HEDEF", "URUN", "DIGER"];

/** Grup adı yalnız erişilebilirlik etiketi ve "Diğer alanlar" açılırı için; ekranda gruplar çerçeveyle ayrılır. */
export const FIELD_GROUP_LABEL: Record<FieldGroup, string> = { KIMLIK: "Kimlik", GELEN: "Gelen", HEDEF: "Hedef", URUN: "Ürün", DIGER: "Diğer alanlar" };

/** Katalogdaki alanın karşılığı; katalog dışı (eski/dosya şablonu anahtarı) → undefined. */
export function fieldTargetOf(key: string): FieldTarget | undefined {
  return Object.prototype.hasOwnProperty.call(FIELD_TARGETS, key) ? FIELD_TARGETS[key as TargetFieldKey] : undefined;
}

/** Ekran sırası: grup sırası, sonra katalog sırası; katalog dışı anahtar en sona. */
export function compareFieldKeys(a: string, b: string): number {
  const order = Object.keys(FIELD_TARGETS);
  const ga = fieldTargetOf(a);
  const gb = fieldTargetOf(b);
  const gi = (g: FieldTarget | undefined) => (g ? FIELD_GROUP_ORDER.indexOf(g.group) : FIELD_GROUP_ORDER.length);
  const oi = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return gi(ga) - gi(gb) || oi(a) - oi(b);
}
