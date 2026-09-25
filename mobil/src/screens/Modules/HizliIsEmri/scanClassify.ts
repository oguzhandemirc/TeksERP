// =============================================================================
// HIZLI İŞ EMRİ — okutulan topun KABUL/RED kararı (saf yüklem, 2026-08-25)
// =============================================================================
// Karar `addRolls` içinde satır içi yazılıydı ve tek bir satır yüzünden özelliğin
// yarısı kapalıydı: `if (roll.status !== 'STOCK') reject`. Backend 2026'dan beri
// `STOCK / WAREHOUSE / A1_STOCK` kabul ediyor ("her işlem final üretir" — bir depo
// topu yeni bir iş emrine sokulur, bitince finalize onu depoya geri indirir), ama
// TABLET bitmiş topu okutmaya bırakmıyordu. Ölçüm (canlı kopya, 2026-08-25): 980
// topun 4'ü iki iş emrinden geçmiş ve dördü de HAM top → akış sahada hiç
// kullanılmamış, çünkü kullanılamıyordu.
//
// Yüklem BURAYA alındı ki DB'siz/ekransız sınanabilsin (`duplicate-guard.helper`
// ve `roll-cancel-restore.helper` emsali).
//
// ⚠️ SIRA ANLAMLIDIR — en yakın çıkış yolunu olan kural ÖNCE:
//   iptal (teşhis paneli açılır) → statü → çuval/sevkiyat → kumaş kilidi.
// Çuval kontrolü statüden SONRA gelir: `WAREHOUSE` + çuvalda olan topa "çuvaldan
// çıkarın" demek doğrudur, ama `SHIPPED` bir topa aynı şeyi demek yanlış yola
// sokar (o mal artık müşteride).
// =============================================================================

import type { Roll } from '../../../types/models';
import { ROLL_STATUS_LABEL, trLabel } from '../../../utils/labels';

/** İş emrine bağlanabilir statüler — backend `quickStart.attachable` ile BİREBİR. */
export const ATTACHABLE_STATUSES = ['STOCK', 'WAREHOUSE', 'A1_STOCK'] as const;

export type AttachableStatus = (typeof ATTACHABLE_STATUSES)[number];

/** Ham stok DIŞINDAN gelen top = "yeniden üretim" (rozet + sebep sorusu bundan doğar). */
export function isReworkStatus(status: string): boolean {
  return status === 'WAREHOUSE' || status === 'A1_STOCK';
}

export type ScanDecision =
  | { kind: 'accept'; status: AttachableStatus }
  /** İptal edilmiş top — duvar DEĞİL, teşhis paneli açılır (2026-08-05 dersi). */
  | { kind: 'cancelled' }
  | { kind: 'reject'; reason: string };

export function classifyScannedRoll(
  roll: Pick<Roll, 'status' | 'itemId'> & { sackId?: string | null; shipmentId?: string | null; item?: Roll['item'] },
  lockedItemId: string | null,
): ScanDecision {
  if (roll.status === 'CANCELLED') return { kind: 'cancelled' };

  if (!(ATTACHABLE_STATUSES as readonly string[]).includes(roll.status)) {
    return {
      kind: 'reject',
      reason: `Stokta değil (${trLabel(ROLL_STATUS_LABEL, roll.status)})`,
    };
  }

  // Çuval/sevkiyat: backend de reddeder (400) ama okutma anında söylemek, iş
  // emrini kurup son adımda patlamaktan iyidir — operatör çuvaldan çıkarıp
  // devam eder.
  if (roll.sackId || roll.shipmentId) {
    return { kind: 'reject', reason: 'Çuvalda/sevkiyatta — önce oradan çıkarın' };
  }

  if (lockedItemId && roll.itemId !== lockedItemId) {
    return { kind: 'reject', reason: 'Farklı ürün' };
  }

  // Pasif kartta canlı top olamaz (D1) — yine de gelirse okutma anında söylenir (fail-closed).
  // Tükenene kadar kartın malı AKAR (sınıf E); durum kilit çipinde görünür.
  if (roll.item?.lifecycleStatus === 'ARCHIVED') {
    return { kind: 'reject', reason: "Kartı Pasif — önce kartı 'Tükenene kadar'a alın" };
  }

  return { kind: 'accept', status: roll.status as AttachableStatus };
}
