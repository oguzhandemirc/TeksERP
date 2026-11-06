// Planlı sevkiyat yük düzenlemesinin SAF kararları (9.1–9.3) — bileşenler yalnız çizer; jest buradan sınar.
import type { SackStoreShipmentLite } from '../../../services/packing.service';
import type { LoadPreviewWorkOrder } from '../../../services/shipmentLoad.service';

const fmtM = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 0 });

export type AddKind = 'SACK' | 'BULK' | 'CART';

/** Sevkiyatın yük türü (tek tür kuralı): dökme varsa dökme, araba varsa araba, yoksa çuval. */
export function addKindOf(sh: Pick<SackStoreShipmentLite, 'cartCount' | 'bulkCount'>): AddKind {
  if ((sh.bulkCount ?? 0) > 0) return 'BULK';
  if ((sh.cartCount ?? 0) > 0) return 'CART';
  return 'SACK';
}

export function addScanTitle(kind: AddKind, cart: string | null): string {
  if (kind === 'BULK') return 'Dökme yüküne top okut';
  if (kind === 'CART') return `Araba ${cart ?? '?'} — top okut`;
  return 'Sevkiyata çuval okut';
}

export interface LooseRollAsk {
  shipmentId: string;
  rollId: string;
  barcode: string | null;
  unitTitle: string;
  /** Birimdeki son top mu — onay metni birimin düşeceğini söyler. */
  last: boolean;
}

export function removeConfirmText(a: LooseRollAsk): string {
  const roll = a.barcode ?? 'Bu top';
  return a.last
    ? `${roll} ${a.unitTitle} yükünün son topu. Çıkarınca top rafa döner ve ${a.unitTitle} sevkiyattan düşer.`
    : `${roll} ${a.unitTitle} yükünden çıkarılıp rafa döner. Sevkiyatın geri kalanı değişmez.`;
}

/** İE satırı: "IE-X · 38/40 top · 2 top eksik" + kaynak belge no'ları. */
export function workOrderLine(w: LoadPreviewWorkOrder): string {
  const head = `${w.workOrderNo} · ${w.inLoad}/${w.total} top · ${fmtM(w.inLoadMeters)} m`;
  return w.remaining > 0 ? `${head} · ${w.remaining} top eksik` : `${head} · tamam`;
}

export function sourceDocText(w: LoadPreviewWorkOrder): string | null {
  if (w.sourceDocs.length === 0) return null;
  return w.sourceDocs.map((d) => (d.senderDocNo ? `${d.noteNo} (boyahane ${d.senderDocNo})` : d.noteNo)).join(', ');
}
