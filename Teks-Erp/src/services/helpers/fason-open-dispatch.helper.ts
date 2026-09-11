// =============================================================================
// TeksERP — Fason "AÇIK + OUTSTANDING sevk" koşulu (TEK KAYNAK)
// =============================================================================
// Bir fason sevkin hâlâ "mal dışarıda" sayılması BEŞ koşulun BİRLİKTE
// sağlanmasıdır:
//
//   1. `cancelledAt: null`            — sevk iptal edilmemiş,
//   2. `directShippedAt: null`        — mal fasondan doğrudan müşteriye ÇIKMAMIŞ
//                                       (çıktıysa dönmeyecek → sevk açık DEĞİL),
//   3. kalemde `remainderClosedAt: null` — "kalan gelmeyecek" ile kapatılmamış,
//   4. kalemin topunda `directShipmentId: null` — top alt kümeyle doğrudan
//      sevk edilmemiş (sevk damgası yalnız TÜM toplar gidince basılır),
//   5. kalemin İPTAL EDİLMEMİŞ bir TAM makbuzu yok
//      (`receiptItems: { none: { isPartial: false, receipt: { cancelledAt: null } } }`).
//
// NEDEN TEK DOSYA: bu koşulun 22 elle yazılmış kopyası vardı ve DÖRDÜ eksikti
// (`directShippedAt` ve/veya `receipt.cancelledAt` süzgeci yoktu). İki sessiz
// yanlış üretiyordu:
//   • Kabul iptali (LIFO) sonrası — makbuz `cancelledAt` alır, ama süzgeci
//     olmayan kopya kalemi "dönmüş" saymaya devam eder → yeniden outstanding
//     olmuş sevk "KAPALI" görünür (WO listesinde gizlenmez, kart açık sevk
//     uyarısı vermez, hızlı-fason önizlemesi grubu göstermez).
//   • Tam doğrudan-sevk (DSK) sonrası — kalem hiç kabul görmediği için (4)
//     sağlanır; `directShippedAt` süzgeci olmayan kopya sevki sonsuza dek
//     "AÇIK" sanır → WO listeden gizli kalır, WO iptali onu boşuna `cancelBulk`'a
//     verir, kart hayalet "açık sevk" uyarısı basar.
//
// KULLANIM
//   • sevk-düzeyi where  → `{ ...ekKoşullar, ...OPEN_OUTSTANDING }`
//   • kalem-düzeyi where → `outstandingItemOfOpenDispatch({ stepId })`
//
// ⚠️ `as const` KULLANILMAZ: readonly literal tip `none:`/`some:` konumunda
// Prisma'nın mutable input tipine oturmaz ve her çağrı yerinde cast ister.
// ⚠️ Sabitler MUTATE EDİLMEZ — her zaman spread ile kopyalanır (paylaşılan nesne).
//
// Bekçi: `scripts/test_fason_open_dispatch_single_source.ts` (kopya yazımı yasak).
// Davranış: `scripts/test_fason_open_dispatch_semantics.ts`.
// =============================================================================

import { Prisma } from "@prisma/client";

/**
 * OUTSTANDING kalem: "kalan gelmeyecek" ile kapatılmamış, topu doğrudan müşteriye
 * sevk edilmemiş VE iptal edilmemiş bir TAM makbuzla dönmemiş sevk kalemi.
 *
 * `isPartial: false` ŞART — kısmi makbuz kalemi KAPATMAZ (100 gitti, 51 geldi →
 * kalem hâlâ açıktır, 49 bekliyor). `receipt.cancelledAt: null` ŞART — iptal
 * edilmiş makbuz kalemi doldurmaz (kabul iptali kalemi yeniden açar).
 * `roll.directShipmentId: null` ŞART — alt kümeyle doğrudan sevkte sevk damgasız
 * kalır; topu müşteriye giden kalem bu süzgeç olmadan sonsuza dek açık görünür.
 */
export const OUTSTANDING_ITEM: Prisma.SubcontractorDispatchItemWhereInput = {
  remainderClosedAt: null,
  roll: { directShipmentId: null },
  receiptItems: { none: { isPartial: false, receipt: { cancelledAt: null } } },
};

/**
 * AÇIK + OUTSTANDING sevk: iptal edilmemiş, doğrudan-sevk edilmemiş ve en az bir
 * OUTSTANDING kalemi olan `SubcontractorDispatch`.
 *
 * Spread ile ek koşul eklenir: `{ workOrderId, ...OPEN_OUTSTANDING }`.
 * Negatif kullanım da aynıdır: `dispatches: { none: OPEN_OUTSTANDING }`.
 */
export const OPEN_OUTSTANDING: Prisma.SubcontractorDispatchWhereInput = {
  cancelledAt: null,
  directShippedAt: null,
  items: { some: OUTSTANDING_ITEM },
};

/**
 * Kalem-düzeyi sorgular için: AÇIK bir sevkin OUTSTANDING kalemi.
 *
 * `extra` sevk üzerine EK süzgeç ekler (ör. `{ stepId }`, `{ subcontractorId }`) —
 * `cancelledAt`/`directShippedAt` her zaman uygulanır, ezilmez sırayla en sona
 * yazılmaz (ek koşullar sonda spread edilir, aynı anahtarı taşımamalıdır).
 */
export function outstandingItemOfOpenDispatch(
  extra?: Prisma.SubcontractorDispatchWhereInput,
): Prisma.SubcontractorDispatchItemWhereInput {
  return {
    ...OUTSTANDING_ITEM,
    dispatch: { cancelledAt: null, directShippedAt: null, ...(extra ?? {}) },
  };
}
