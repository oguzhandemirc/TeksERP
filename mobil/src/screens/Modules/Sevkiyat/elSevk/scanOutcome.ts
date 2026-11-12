// Okutma sonucu → ekran eylemi (saf). Karar sunucuda (`classifyHandheldScan`); burada yalnız ses, şerit metni,
// onay sorusu ve seçim. Soru bir okutma sonucu değildir: onay soran dal sinyal vermez (MOBIL.md MO-13a).
import type { ScanOutcome } from '../../../../services/scanFeedback';
import { errorCode, type HandheldOutcome, type HandheldRejectReason } from '../../../../services/handheldShipment.service';

export type BannerTone = 'ok' | 'info' | 'error';

export interface ScanPrompt {
  kind: 'remove' | 'notReady';
  barcode: string;
  title: string;
  body: string;
  confirmLabel: string;
  tone: 'danger' | 'accent';
  resend: { confirmRemove?: true; confirmNotReady?: true };
}

export interface ScanReaction {
  signal: ScanOutcome | null;
  banner: { tone: BannerTone; text: string } | null;
  prompt: ScanPrompt | null;
  /** undefined: seçime dokunma · string: o çuvalı seç. */
  select?: string;
  /** Kısa vurgu: eklenen/taşınan top ya da hedef çuval. */
  highlight: string | null;
}

const REJECT_FALLBACK: Record<HandheldRejectReason, string> = {
  NOT_FOUND: 'Kod bulunamadı',
  AMBIGUOUS_CODE: 'Kod birden çok kayda uyuyor',
  SACK_CODE: 'Bu çuval bu sevkiyatın değil',
  ROLL_IN_OTHER_SHIPMENT: 'Top başka bir sevkiyatta',
  ROLL_SHIPPED: 'Top zaten sevk edilmiş',
  ROLL_IN_POOL_SACK: 'Top paketlemedeki bir çuvalda',
  OWNER_MISMATCH: 'Başka carinin malı',
  WAREHOUSE_MISMATCH: 'Top başka depoda',
  ROLL_NOT_PHYSICAL: 'Top şu an sevk edilemez',
};

const none = { prompt: null, highlight: null } as const;

export function interpretOutcome(o: HandheldOutcome): ScanReaction {
  switch (o.kind) {
    case 'added':
      return { signal: 'accept', banner: { tone: 'ok', text: `${o.barcode} → ${o.to.label}` }, prompt: null, highlight: o.to.sackId ?? o.rollId };
    case 'transferred':
      return {
        signal: 'accept',
        banner: { tone: 'info', text: `${o.barcode}: ${o.from.label} → ${o.to.label}` },
        prompt: null,
        highlight: o.to.sackId ?? o.rollId,
      };
    case 'removed':
      return { signal: 'accept', banner: { tone: 'info', text: `${o.barcode} çıkarıldı (${o.from.label})` }, ...none };
    case 'needsRemoveConfirm':
      return {
        signal: null,
        banner: null,
        highlight: null,
        prompt: {
          kind: 'remove',
          barcode: o.barcode,
          title: 'Çıkarmak istiyor musunuz?',
          body: `${o.barcode} · ${o.from.label}`,
          confirmLabel: 'Çıkar',
          tone: 'danger',
          resend: { confirmRemove: true },
        },
      };
    case 'needsNotReadyConfirm':
      return {
        signal: null,
        banner: null,
        highlight: null,
        prompt: {
          kind: 'notReady',
          barcode: o.barcode,
          title: 'Bu top henüz işlemde',
          body: `${o.barcode} · ${o.stageLabel}. Yine de eklensin mi?`,
          confirmLabel: 'Ekle',
          tone: 'accent',
          resend: { confirmNotReady: true },
        },
      };
    case 'sackSelected':
      return { signal: 'accept', banner: { tone: 'info', text: `${o.sackNo} seçildi` }, select: o.sackId, prompt: null, highlight: o.sackId };
    case 'rejected':
      return { signal: 'reject', banner: { tone: 'error', text: o.message || REJECT_FALLBACK[o.reason] }, ...none };
  }
}

export interface ScanErrorReaction {
  banner: { tone: BannerTone; text: string };
  /** Seçili çuval sunucuda yok → seçim kalkar. */
  clearSelection: boolean;
  /** Yarış/bayat ekran → durum tazelenir. */
  refetch: boolean;
}

/** Akış hatası (HTTP) → şerit metni; iş sınıflandırması değildir, ses her zaman `reject`. */
export function interpretScanError(err: unknown): ScanErrorReaction {
  const code = errorCode(err);
  const message = (err as { message?: unknown } | null)?.message;
  const text = typeof message === 'string' && message ? message : 'Okutulamadı';
  switch (code) {
    case 'TARGET_SACK_GONE':
      return { banner: { tone: 'error', text }, clearSelection: true, refetch: true };
    case 'ROLL_TAKEN':
    case 'ROLL_MOVED':
    case 'SHIPMENT_NOT_PLANNED':
      return { banner: { tone: 'error', text }, clearSelection: false, refetch: true };
    default:
      return { banner: { tone: 'error', text }, clearSelection: false, refetch: false };
  }
}
