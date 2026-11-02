import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { PaginatedResponse, QueryParams } from '../types/api';

/** SEÇİM tipli özelliğin izin verilen değeri. Kod KİMLİK, ad GÖRÜNTÜ. */
export interface FabricPropertyValue {
  /** Değer kimliği (hedef yazımında `valueId`); eski tipte okunmuyordu. */
  id?: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** Sözleşme 5: kurşun gramajı gr/m (Decimal string) + tek varsayılan. Eski sunucu göndermez → ön seçim yok. */
  amount?: string | number | null;
  isDefault?: boolean;
}

/** Kumaş özellik kataloğu satırı (yanmazlık, su geçirmezlik vb). */
export interface FabricProperty {
  id: string;
  code: string;
  name: string;
  category?: string | null;
  description?: string | null;
  isActive: boolean;
  /** BAYRAK = var/yok · SEÇİM = değerlerden biri (KAT). Eski backend'de gelmez. */
  valueType?: 'FLAG' | 'CHOICE';
  /** SEÇİM tipliyse izin verilen değerler. */
  values?: FabricPropertyValue[];
  /** Çeşit özelliğinin bağlı olduğu bayrak (kurşun gramajı = KURSUN bayrağının çeşidi). */
  variantOfPropertyId?: string | null;
}

/** Kurşun bayrağının kodu — backend `KURSUN_PROPERTY_CODE` ile aynı sabit. */
export const KURSUN_PROPERTY_CODE = 'KURSUN';

export interface KursunGramajOption {
  id: string;
  name: string;
  isDefault: boolean;
}

/** Gramaj kataloğu: kurşun bayrağının çeşidi ve aktif değerleri (panel `lib/kursun-gramaj.ts` ikizi). Çeşit yoksa boş. */
export interface KursunGramajCatalog {
  propertyId: string | null;
  options: KursunGramajOption[];
}

/** S3: customerId → gramaj değeri kimliği (panel `lib/kursun-gramaj.ts` ikizi). */
export type KursunCustomerDefaults = Readonly<Record<string, string>>;

/** Kat değerlerini taşıyan katalog satırının kodu — backend ile aynı sabit. */
export const FOLD_PROPERTY_CODE = 'KAT';

export const fabricPropertyService = {
  /**
   * Hedef özellik seçici listesi. GET /fabric-properties `property:read` VEYA
   * `mobile:hizli-is-emri` kabul eder (bkz. fabric-property.routes.ts) — saha
   * kullanıcısında master-data izni yok.
   */
  getAll: (params: Partial<QueryParams> = {}): Promise<PaginatedResponse<FabricProperty>> =>
    apiClient
      .get<PaginatedResponse<FabricProperty>>(`/fabric-properties${buildQueryString(params)}`)
      .then((r) => r.data),

  /** Kurşun gramaj kataloğu — fallback YOK: okunamaz/tanımsızsa boş, alan çizilmez. */
  getKursunGramajCatalog: async (): Promise<KursunGramajCatalog> => {
    const res = await fabricPropertyService.getAll({ page: 1, pageSize: 200, filters: { isActive: 'true' } });
    const rows = res.data ?? [];
    const flag = rows.find((p) => p.code === KURSUN_PROPERTY_CODE);
    const variant = flag ? rows.find((p) => p.variantOfPropertyId === flag.id && p.isActive) : undefined;
    if (!variant) return { propertyId: null, options: [] };
    const options = (variant.values ?? [])
      .filter((v): v is FabricPropertyValue & { id: string } => v.isActive && !!v.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((v) => ({ id: v.id, name: v.name, isDefault: v.isDefault === true }));
    return { propertyId: variant.id, options };
  },

  /** S3: müşterinin cari kartındaki varsayılan kurşun gramajı (customerId → valueId). Eski backend / hata → boş (istasyon varsayılanı). */
  getKursunCustomerDefaults: async (): Promise<KursunCustomerDefaults> => {
    try {
      const res = await apiClient.get<{ data?: Array<{ customerId: string; valueId: string }> }>('/work-orders/kursun-customer-defaults');
      return Object.fromEntries((res.data.data ?? []).map((r) => [r.customerId, r.valueId]));
    } catch {
      return {};
    }
  },

  /**
   * Kat değerleri (2-KAT / 4-KAT / TUP / fabrikanın eklediği 6-KAT…).
   *
   * ⚠️ Fallback YOK: katalog okunamazsa BOŞ dizi döner ve ekran bunu söyler.
   * Sabit `['2-KAT','4-KAT']` listesine düşmek, panelden eklenen değeri
   * tablette görünmez yapardı — özelliğin var oluş sebebi tam da bu.
   */
  getFoldValues: async (): Promise<FabricPropertyValue[]> => {
    const res = await fabricPropertyService.getAll({
      page: 1,
      pageSize: 5,
      filters: { code: FOLD_PROPERTY_CODE, isActive: 'true' },
    });
    const prop = (res.data ?? []).find((p) => p.code === FOLD_PROPERTY_CODE);
    return (prop?.values ?? [])
      .filter((v) => v.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },
};
