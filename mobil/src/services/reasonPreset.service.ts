import { apiClient } from './api';

// =============================================================================
// HAZIR SEBEP KATALOĞU — MOBİL SERVİS (2026-08-19)
// =============================================================================
// Dört liste tek uçtan gelir: fire · kayıt düzeltmesi · elle top ekleme · iptal.
// Öncesinde dördü de mobilde SABİTTİ; fabrika kendi sebebini ekleyemiyordu ve
// her değişiklik yeni APK gerektiriyordu.
//
// ⚠️ `code` rapor anahtarıdır ve DÜZENLENMEZ (sunucu da kabul etmez). Etiket
// serbestçe değişir; fire/kayıt-düzeltmesi satırları koda bağlı olduğu için
// etiketi değiştirmek geçmiş raporu BOZMAZ.
// =============================================================================

export type ReasonPresetKind =
  | 'ROLL_SCRAP'
  | 'ROLL_RECORD_CORRECTION'
  | 'ROLL_MANUAL_ENTRY'
  | 'ROLL_CANCEL'
  /** Hızlı İş Emri — depodaki BİTMİŞ topu yeniden üretime alma sebebi (2026-08-25). */
  | 'WORK_ORDER_REWORK'
  /**
   * Sipariş iptali — tablette YÜZEYİ YOK ama liste ucu TÜM kind'ları döndürür,
   * yani bu değer cihaza fiilen geliyor. Union'da olmaması bir tip yalanıydı:
   * `KIND_LABELS[kind]` o satır için `undefined` verir ve sebep adsız çizilir.
   */
  | 'ORDER_CANCEL'
  /**
   * Tezgah duruşu (dokuma P2b-2) — tablette YÜZEYİ HENÜZ YOK (duruş sınıflandırma
   * ekranı Faz 2), ama liste ucu bu kind'ı da döndürür: union'da olmaması
   * `ORDER_CANCEL`daki aynı tip yalanı olurdu.
   */
  | 'MACHINE_STOP'
  | 'WARP_RETURN';

export interface ReasonPreset {
  id: string;
  kind: ReasonPresetKind;
  code: string;
  label: string;
  /** Sunucuya GİDEN tam metin — yalnız metin saklayan listelerde dolu. */
  fullText: string | null;
  requiresText: boolean;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

/**
 * ⚠️ SÖZLEŞME FARKI — tek yerde yazılı (sunucu `constants/reason-presets.ts`
 * ile birebir aynı tablo). true olan listelerde satıra KOD değil METİN yazılır
 * (`Roll.entryReason` / `Roll.cancelReason`), dolayısıyla metni düzenlemek
 * GEÇMİŞ kayıtları eski metinle bırakır — düzenleme ekranı bunu operatöre söyler.
 */
export const KIND_STORES_TEXT: Record<ReasonPresetKind, boolean> = {
  ROLL_SCRAP: false,
  ROLL_RECORD_CORRECTION: false,
  ROLL_MANUAL_ENTRY: true,
  ROLL_CANCEL: true,
  // Yeniden üretimde satır YOK: kod + metin iş emrinin `parameters.rework`una
  // yazılır; metin ayrıca fason çekisine talimat olur. Kod rapor anahtarıdır.
  WORK_ORDER_REWORK: false,
  // Sipariş iptalinde satıra GÖRÜNEN metin yazılır (`Order.cancelReason`) + kod
  // (`cancelReasonCode`) — top iptaliyle aynı sözleşme. Sunucudaki tabloyla bir.
  ORDER_CANCEL: true,
  // Tezgah duruşunda satıra yalnız KOD yazılır; kayıp sınıfı sunucuda preset'ten
  // kopyalanıp donar. Sunucudaki tabloyla birebir.
  MACHINE_STOP: false,
  WARP_RETURN: false,
};

export const KIND_LABELS: Record<ReasonPresetKind, string> = {
  ROLL_SCRAP: 'Fire sebepleri',
  ROLL_RECORD_CORRECTION: 'Kayıt düzeltmesi sebepleri',
  ROLL_MANUAL_ENTRY: 'Elle top ekleme sebepleri',
  ROLL_CANCEL: 'Top iptal sebepleri',
  WORK_ORDER_REWORK: 'Yeniden üretim sebepleri',
  ORDER_CANCEL: 'Sipariş iptal sebepleri',
  MACHINE_STOP: 'Tezgah duruş sebepleri',
  WARP_RETURN: 'Levent dibi iade sebepleri',
};

export const reasonPresetService = {
  /** `includeInactive` yalnız düzenleme yüzeyi için — operatör ekranı aktifleri alır. */
  list: (includeInactive = false): Promise<ReasonPreset[]> =>
    apiClient
      .get<ReasonPreset[]>(`/reason-presets${includeInactive ? '?includeInactive=true' : ''}`)
      .then((r) => r.data),

  create: (input: {
    kind: ReasonPresetKind;
    label: string;
    fullText?: string | null;
    requiresText?: boolean;
  }): Promise<ReasonPreset> =>
    apiClient.post<ReasonPreset>('/reason-presets', input).then((r) => r.data),

  update: (
    id: string,
    input: { label?: string; fullText?: string | null; isActive?: boolean },
  ): Promise<ReasonPreset> =>
    apiClient.patch<ReasonPreset>(`/reason-presets/${id}`, input).then((r) => r.data),

  duplicate: (id: string, label?: string): Promise<ReasonPreset> =>
    apiClient
      .post<ReasonPreset>(`/reason-presets/${id}/duplicate`, label ? { label } : {})
      .then((r) => r.data),

  /**
   * Liste sırasını KALICI yapar.
   *
   * ⚠️ Sunucu o `kind`'ın TÜM id'lerini sırasıyla bekler — eksik id 400.
   * Operatör ekranı yalnız AKTİF satırları çizdiği için ham "görünenlerin
   * sırası" gönderilemez; `mergeVisibleOrder` gizli satırları kendi
   * yuvalarında bırakıp araya görünenlerin yeni sırasını yerleştirir.
   */
  reorder: (kind: ReasonPresetKind, ids: string[]): Promise<ReasonPreset[]> =>
    apiClient.patch<ReasonPreset[]>('/reason-presets/reorder', { kind, ids }).then((r) => r.data),
};

/**
 * Görünen satırların yeni sırasını, TÜM satırların id listesine çevirir.
 *
 * Gizli (pasif) satır sürüklenemez ve yerini KAYBETMEZ: tam listede işgal
 * ettiği yuva olduğu gibi kalır, yalnız görünen satırların işgal ettiği
 * yuvalara yeni sıra yazılır. Naif yaklaşım (görünenler önce, gizliler sona)
 * pasif satırları her sürüklemede listenin dibine toplardı — masaüstü düzenleme
 * ekranında görünür bir yan etki.
 *
 * Saf fonksiyon: bekçi doğrudan ölçer.
 */
export function mergeVisibleOrder(
  allRowIdsInCurrentOrder: string[],
  visibleIdsInNewOrder: string[],
): string[] {
  const visible = new Set(visibleIdsInNewOrder);
  let i = 0;
  return allRowIdsInCurrentOrder.map((id) =>
    visible.has(id) ? (visibleIdsInNewOrder[i++] ?? id) : id,
  );
}
