// ALAN → İŞ EMRİ KARŞILIĞI kataloğu (belge tanıt 3 aşama, 2026-11-09; saf, TEK kaynak). Tanıtmanın ② Eşleme listesi ve
// tanıma özetinin `mapping`i buradan okur; tablet/panel aynaları (`FIELD_GROUPS`) bu sırayı ve grupları taşır. Anahtar
// `ASSIGNABLE_FIELDS` ile birebir (tip denetimi: eksik/fazla anahtar derlenmez). `targets`: alanın gidebileceği hedefler —
// bugün yalnız iş emri; mal kabul vb. eklenince katalog genişler, istemci hedef seçici çizer.
import type { AssignableField } from "./motor";

export type FieldGroup = "KIMLIK" | "GELEN" | "HEDEF" | "URUN" | "DIGER";
export type TeachTarget = "WORK_ORDER";

export interface FieldTarget {
  /** İE formundaki karşılık (tel alanı adı; bilgi ve istemci eşlemesi için). */
  woTarget: string;
  /** İE karşılığının ekrandaki adı. */
  woLabel: string;
  group: FieldGroup;
  /** ② Eşleme'de varsayılan görünür mü (değilse "Diğer alanlar" altında). */
  defaultVisible: boolean;
  targets: readonly TeachTarget[];
}

const WO = ["WORK_ORDER"] as const;

/** Sıra = ekrandaki sıra (grup içinde). */
export const FIELD_TARGETS = {
  musteri: { woTarget: "ownerCustomerId", woLabel: "Müşteri", group: "KIMLIK", defaultVisible: true, targets: WO },
  partiNo: { woTarget: "customerBatchNo", woLabel: "Gönderen parti no", group: "KIMLIK", defaultVisible: true, targets: WO },
  evrakNo: { woTarget: "senderDocNo", woLabel: "İrsaliye no", group: "KIMLIK", defaultVisible: true, targets: WO },
  toplamMetre: { woTarget: "kursunMeters", woLabel: "Gelen metre", group: "GELEN", defaultVisible: true, targets: WO },
  toplamKg: { woTarget: "incomingKg", woLabel: "Gelen kg", group: "GELEN", defaultVisible: true, targets: WO },
  topAdet: { woTarget: "rollCount", woLabel: "Top adedi", group: "GELEN", defaultVisible: false, targets: WO },
  // 2026-11-09: belgedeki kumaş adı/renk müşterinin BEYANIDIR (gelen metre gibi), İE hedefi değil; anahtar eski şablonlar için aynı.
  desen: { woTarget: "incomingItemText", woLabel: "Gelen kumaş", group: "GELEN", defaultVisible: true, targets: WO },
  renk: { woTarget: "incomingColorText", woLabel: "Gelen renk", group: "GELEN", defaultVisible: true, targets: WO },
  // Hedef metraj gelen metreden türer, hedef kg nadir → varsayılan gizli (plan 2.1 ②).
  hedefMetraj: { woTarget: "targetQuantity", woLabel: "Hedef metraj", group: "HEDEF", defaultVisible: false, targets: WO },
  hedefKg: { woTarget: "targetWeight", woLabel: "Hedef kg", group: "HEDEF", defaultVisible: false, targets: WO },
  en: { woTarget: "width", woLabel: "En", group: "HEDEF", defaultVisible: true, targets: WO },
  siparisNo: { woTarget: "customerOrderNo", woLabel: "Sipariş no", group: "DIGER", defaultVisible: false, targets: WO },
  tarih: { woTarget: "senderDocDate", woLabel: "Belge tarihi", group: "DIGER", defaultVisible: false, targets: WO },
  not: { woTarget: "notes", woLabel: "Not", group: "DIGER", defaultVisible: false, targets: WO },
  islem: { woTarget: "processText", woLabel: "İşlem (bilgi)", group: "DIGER", defaultVisible: false, targets: WO },
  gonderenIsEmriNo: { woTarget: "senderWorkOrderNo", woLabel: "Gönderen İE no", group: "DIGER", defaultVisible: false, targets: WO },
} as const satisfies Record<AssignableField, FieldTarget>;

export const FIELD_GROUP_ORDER: readonly FieldGroup[] = ["KIMLIK", "GELEN", "HEDEF", "URUN", "DIGER"];

/** Görüntü etiketi: desen/renk için saklı eski etiket yerine katalog adı ("Gelen kumaş"/"Gelen renk"); diğerleri şablondaki. */
export function displayFieldLabel(key: string, stored: string): string {
  return key === "desen" || key === "renk" ? FIELD_TARGETS[key].woLabel : stored;
}

/** Katalogdaki alanın İE karşılığı; katalog dışı (dosya şablonu anahtarı) → undefined. */
export function fieldTargetOf(key: string): FieldTarget | undefined {
  return Object.prototype.hasOwnProperty.call(FIELD_TARGETS, key) ? FIELD_TARGETS[key as AssignableField] : undefined;
}
