import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { PaginatedResponse, QueryParams } from '../types/api';

/** SEÇİM tipli özelliğin izin verilen değeri. Kod KİMLİK, ad GÖRÜNTÜ. */
export interface FabricPropertyValue {
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
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
}

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
