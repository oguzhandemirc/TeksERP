import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { Item } from '../types/models';

/** Backend `ItemType` enum'unun aynası. Birim BUNDAN türer, ayrıca sorulmaz. */
export type ItemType = 'FABRIC' | 'YARN' | 'CONSUMABLE';

/** Electron `unitForItemType` ile birebir — kullanıcı düzenleyemez, gösterilir. */
export const UNIT_FOR_ITEM_TYPE: Record<ItemType, string> = {
  FABRIC: 'MT',
  YARN: 'KG',
  CONSUMABLE: 'ADET',
};

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  FABRIC: 'Kumaş',
  YARN: 'İplik',
  CONSUMABLE: 'Sarf Malzeme',
};

export const itemService = {
  getAll: (params: Partial<QueryParams>): Promise<PaginatedResponse<Item>> =>
    apiClient.get<PaginatedResponse<Item>>(`/items${buildQueryString(params)}`).then((r) => r.data),

  /**
   * Saha (KK1) hızlı desen oluşturma — YALNIZ ad gönderilir. Backend itemType'ı
   * FABRIC'e, kodu STK-NNNNNN'e, birimi MT'ye zorlar ve `pendingReview=true`
   * işaretler (admin gözden geçirir). `mobile:kk1-desen` yetkisi backend'de
   * zorunlu. Çevrimiçi-only: sunucu kod ürettiği için offline kuyruğa ALINMAZ
   * (çağıran plain useMutation + isOnline gate kullanır — bkz. KK1Screen).
   */
  quickCreateFabric: (name: string): Promise<ApiResponse<Item>> =>
    apiClient.post<ApiResponse<Item>>('/items/quick-create', { name }).then((r) => r.data),

  /**
   * TAM kumaş tanımı (mobil "Kumaş Ekle" ekranı) — Electron ürün formuyla aynı
   * alanlar. `quickCreateFabric`ten farkı: orası YALNIZ ad alır, tipi FABRIC'e
   * zorlar ve `pendingReview=true` işaretler (admin sonra tamamlar); burası
   * tanımı eksiksiz açar ve `pendingReview` GÖNDERMEZ → backend default false.
   *
   * `code` boş bırakılırsa payload'a HİÇ konmaz → backend STK-NNNNNN üretir.
   * `unit` gönderilmez: backend tipe göre zorlar (FABRIC→MT, YARN→KG,
   * CONSUMABLE→ADET) — Electron da kullanıcıya seçtirmez, türetir.
   *
   * Çevrimiçi-only: sunucu kod üretir, offline kuyruğa ALINMAZ.
   */
  create: (data: {
    name: string;
    itemType: ItemType;
    /** Boş/verilmemiş → otomatik STK-NNNNNN. */
    code?: string;
    isActive?: boolean;
    allowedColorIds?: string[];
    allowedPropertyIds?: string[];
  }): Promise<ApiResponse<Item>> =>
    apiClient.post<ApiResponse<Item>>('/items', data).then((r) => r.data),
};
