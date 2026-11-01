// =============================================================================
// Müşteri barkodu (D4-F4) — saf yüklemler: bağla düğmesi görünürlüğü, 409 çevirisi, aday ayrıştırma.
// Backend: POST /api/rolls/:id/customer-code (+ /revoke) · okutma boğazı `resolveRollByScanCode`
// (iç barkod önce; belirsizlikte 409 CUSTOMER_CODE_AMBIGUOUS + adaylar — SESSİZ SEÇİM YOK, K12).
// =============================================================================

/** Backend `ROLL_CUSTOMER_CODE_WRITE` + `roll:write` aynası (inventory.routes.ts) — biri yeter. */
export const CUSTOMER_CODE_BIND_PERMISSIONS = ['roll:write', 'mobile:tambur', 'roll:customer-code'] as const;

export interface CustomerCodeCandidate {
  rollId: string;
  barcode: string | null;
  customerId: string;
  customerName: string;
  code: string;
  /** Eski backend (D4-F4 öncesi) göndermez → modal metreyi "—" gösterir. */
  currentQty?: number;
}

export interface AmbiguousScan {
  scannedCode: string;
  candidates: CustomerCodeCandidate[];
}

interface ErrorLike {
  status?: number;
  message?: string;
  details?: Record<string, unknown>;
}

function asError(e: unknown): ErrorLike {
  return (e ?? {}) as ErrorLike;
}

/** 409 CUSTOMER_CODE_AMBIGUOUS → adaylar; başka her hata null (çağıran bugünkü hata yolunu sürer). */
export function parseAmbiguousScan(e: unknown): AmbiguousScan | null {
  const err = asError(e);
  if (err.status !== 409 || err.details?.code !== 'CUSTOMER_CODE_AMBIGUOUS') return null;
  const raw = Array.isArray(err.details.candidates) ? (err.details.candidates as unknown[]) : [];
  const candidates = raw.filter(
    (c): c is CustomerCodeCandidate =>
      !!c && typeof (c as CustomerCodeCandidate).rollId === 'string' && typeof (c as CustomerCodeCandidate).barcode === 'string',
  );
  if (candidates.length === 0) return null;
  return { scannedCode: String(err.details.scannedCode ?? ''), candidates };
}

/**
 * Bağla düğmesi görünür mü? Dört koşul birden (koşulsuz 403/404 verecek çağrı atılmaz):
 * izin · emanet modülü açık · sunucu müşteri barkodunu tanıyor (eski backend bayrağı göndermez) · top emanet.
 */
export function canBindCustomerCode(p: {
  has: (code: string) => boolean;
  emanetEnabled: boolean;
  /** `scanCustomerCodeLookupEnabled` bayrağının TİPİ — D4-F1 öncesi sunucu alanı hiç göndermez. */
  serverKnowsCustomerCode: boolean;
  /** Bu oturumda uç 404 döndü (eski backend) → düğme gizlenir. */
  endpointMissing: boolean;
  ownerCustomerId: string | null | undefined;
}): boolean {
  if (p.endpointMissing || !p.serverKnowsCustomerCode || !p.emanetEnabled) return false;
  if (!p.ownerCustomerId) return false;
  return CUSTOMER_CODE_BIND_PERMISSIONS.some((c) => p.has(c));
}

/** Baskı 400 `CUSTOMER_CODE_MISSING` (D4-F3 BLOCK): şablon müşteri barkodu basıyor, topta kod yok → okut-bağla çıkışı. */
export function isCustomerCodeMissing(e: unknown): boolean {
  const err = asError(e);
  return err.status === 400 && err.details?.code === 'CUSTOMER_CODE_MISSING';
}

/** Rota yok (eski backend) — Express'in genel 404'ü `details` taşımaz; servisin "Top bulunamadı"sı `details.rollId` taşır. */
export function isEndpointMissing(e: unknown): boolean {
  const err = asError(e);
  if (err.status !== 404) return false;
  if (typeof err.message === 'string' && err.message.startsWith('Endpoint bulunamadı')) return true;
  return !err.details || Object.keys(err.details).length === 0;
}

export type BindFailureKind = 'replace' | 'message';

/** Bağlama hatasının operatöre Türkçe karşılığı; `replace` = topta zaten kod var → "Değiştir" önerilir. */
export function describeBindError(e: unknown): { kind: BindFailureKind; title: string; body: string } {
  const err = asError(e);
  const code = err.details?.code;
  switch (code) {
    case 'ROLL_CUSTOMER_CODE_EXISTS':
      return { kind: 'replace', title: 'Bu topta zaten müşteri barkodu var', body: 'Değiştirmek için eski kodu sebebiyle kaldırıp yenisini bağlayın.' };
    case 'CUSTOMER_CODE_TAKEN':
      return { kind: 'message', title: 'Bu kod başka bir topta', body: 'Aynı müşteride bu barkod başka bir topa bağlı. Etiketi kontrol edin.' };
    case 'CUSTOMER_CODE_COLLIDES':
      return { kind: 'message', title: 'Bu bizim barkodumuz', body: 'Okutulan kod bir top/çuval barkoduyla çakışıyor; müşteri etiketini okutun.' };
    case 'ROLL_NOT_EMANET':
      return { kind: 'message', title: 'Top emanet değil', body: 'Müşteri barkodu yalnız müşterinin malı olan topa bağlanır.' };
    default:
      return { kind: 'message', title: 'Bağlanamadı', body: err.message ?? 'Bilinmeyen hata' };
  }
}

/** Aday satırının metre metni (eski backend metre göndermez). */
export function candidateMeters(c: CustomerCodeCandidate): string {
  return typeof c.currentQty === 'number' && Number.isFinite(c.currentQty) ? `${c.currentQty.toFixed(1)} m` : '— m';
}

/** Okutma boğazının müşteri kodu eşleşme eki (`matchExtras`; iç barkodla bulunduysa alanlar YOK). */
export interface ScanMatchExtras {
  matchedBy?: 'CUSTOMER_CODE';
  customerCode?: string;
}

/** Top müşteri koduyla bulunduysa operatöre söylenecek satır; iç barkodla bulunduysa null. */
export function customerCodeMatchText(r: ScanMatchExtras | null | undefined): string | null {
  return r?.matchedBy === 'CUSTOMER_CODE' && r.customerCode ? `Müşteri barkodu ${r.customerCode} ile bulundu` : null;
}
