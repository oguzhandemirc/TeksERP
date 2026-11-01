// D4-KUC3d — okutma noktası testlerinin ortak fikstürü: tek okutma boğazının (resolveRollByScanCode)
// iki yanıtı. MK77 iki müşteride (409 CUSTOMER_CODE_AMBIGUOUS + adaylar), ACR500 tek topa bağlı (matchedBy).

export const AMBIGUOUS_CODE = 'MK77';
export const UNIQUE_CUSTOMER_CODE = 'ACR500';

export interface FixtureCandidate {
  rollId: string;
  barcode: string;
  customerName: string;
}

/** Sunucunun belirsizlik hatası — `apiClient` hatası şekliyle (status + details). */
export function ambiguousScanError(candidates: FixtureCandidate[], code: string = AMBIGUOUS_CODE) {
  return {
    status: 409,
    message: 'Bu müşteri barkodu birden çok topta',
    details: {
      code: 'CUSTOMER_CODE_AMBIGUOUS',
      scannedCode: code,
      candidates: candidates.map((c) => ({
        rollId: c.rollId,
        barcode: c.barcode,
        customerId: `c-${c.rollId}`,
        customerName: c.customerName,
        code,
        currentQty: 40,
        status: 'STOCK',
      })),
    },
  };
}

/** Müşteri koduyla bulunan topun yanıt eki (iç barkodla bulunduysa alan YOK). */
export const customerCodeMatch = (code: string = UNIQUE_CUSTOMER_CODE) => ({ matchedBy: 'CUSTOMER_CODE' as const, customerCode: code });

/** Modal başlığı (CustomerCodeCandidateModal) — testler bununla açıldığını doğrular. */
export const ambiguousTitle = (code: string = AMBIGUOUS_CODE) => new RegExp(`"${code}" birden çok müşteride`);
