// Alan → iş emri karşılığı kataloğu: backend `Teks-Erp/src/lib/gelen-belge/alan-hedef.ts` (`FIELD_TARGETS`, `FIELD_GROUP_ORDER`)
// AYNASI (istemciler kod paylaşmaz; `stages.test.ts` iki dosyayı karşılaştırır). Sıra = ② Eşleme listesindeki sıra (grup içinde).
import type { FieldKey } from './teachDraft';

export type FieldGroup = 'KIMLIK' | 'GELEN' | 'HEDEF' | 'URUN' | 'DIGER';

export interface FieldTarget {
  /** İE karşılığının ekrandaki adı. */
  woLabel: string;
  group: FieldGroup;
  /** ② Eşleme'de varsayılan görünür mü (değilse "Diğer alanlar" altında). */
  defaultVisible: boolean;
}

export const FIELD_TARGETS: Record<FieldKey, FieldTarget> = {
  musteri: { woLabel: 'Müşteri', group: 'KIMLIK', defaultVisible: true },
  partiNo: { woLabel: 'Gönderen parti no', group: 'KIMLIK', defaultVisible: true },
  evrakNo: { woLabel: 'İrsaliye no', group: 'KIMLIK', defaultVisible: true },
  toplamMetre: { woLabel: 'Gelen metre', group: 'GELEN', defaultVisible: true },
  toplamKg: { woLabel: 'Gelen kg', group: 'GELEN', defaultVisible: true },
  topAdet: { woLabel: 'Top adedi', group: 'GELEN', defaultVisible: false },
  desen: { woLabel: 'Gelen kumaş', group: 'GELEN', defaultVisible: true },
  renk: { woLabel: 'Gelen renk', group: 'GELEN', defaultVisible: true },
  hedefMetraj: { woLabel: 'Hedef metraj', group: 'HEDEF', defaultVisible: false },
  hedefKg: { woLabel: 'Hedef kg', group: 'HEDEF', defaultVisible: false },
  en: { woLabel: 'En', group: 'HEDEF', defaultVisible: true },
  siparisNo: { woLabel: 'Sipariş no', group: 'DIGER', defaultVisible: false },
  tarih: { woLabel: 'Belge tarihi', group: 'DIGER', defaultVisible: false },
  not: { woLabel: 'Not', group: 'DIGER', defaultVisible: false },
  islem: { woLabel: 'İşlem (bilgi)', group: 'DIGER', defaultVisible: false },
  gonderenIsEmriNo: { woLabel: 'Gönderen İE no', group: 'DIGER', defaultVisible: false },
};

export const FIELD_GROUP_ORDER: readonly FieldGroup[] = ['KIMLIK', 'GELEN', 'HEDEF', 'URUN', 'DIGER'];

/** Katalog sırasıyla alan anahtarları. */
export const MAP_FIELD_ORDER = Object.keys(FIELD_TARGETS) as FieldKey[];

export const fieldLabel = (k: FieldKey): string => FIELD_TARGETS[k]?.woLabel ?? k;
