// =============================================================================
// İş emri detay sheet'i — yerleşim ve görünür satır kararları (SAF; testli)
// =============================================================================
// Bileşen yalnız çizer: hangi satır görünür, kaç sütun, rota çipleri, özet şeridi burada.
// Boş değer ("—") satırı HİÇ üretilmez; Gelen bloğu yalnız sunucu `incoming` döndürdüyse vardır.
// =============================================================================
import type { WorkOrder, WorkOrderIncoming } from '../../../types/models';

export type DetailRow = readonly [label: string, value: string];

/** Bu genişlikten (dp) itibaren Gelen/Hedef yan yana. */
export const WIDE_MIN_WIDTH = 900;

export function detailColumns(width: number): 1 | 2 {
  return width >= WIDE_MIN_WIDTH ? 2 : 1;
}

/** 12.0 → "12", 12.34 → "12,3" (Türkçe ondalık). */
export function fmtNum(n: number, maxFrac = 1): string {
  const r = Number(n.toFixed(maxFrac));
  return String(r).replace('.', ',');
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const txt = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/** "2026-11-09T00:00:00.000Z" (yalnız tarih kolonu) → "09.11.2026"; saat dilimi kaymaz. */
function fmtIsoDay(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/** Gelen (belgeden) satırları; dolu olmayan satır yok. `incoming` yoksa boş dizi (kart çizilmez). */
export function incomingRows(incoming: WorkOrderIncoming | null | undefined): DetailRow[] {
  if (!incoming) return [];
  const rows: (DetailRow | null)[] = [];
  const nts = incoming.notes ?? [];
  const notes = nts.map((n) => n.noteNo).filter(Boolean);
  rows.push(notes.length ? ['Belge No', notes.join(', ')] : null);
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => txt(x)).filter((x): x is string => !!x))];
  const join = (label: string, xs: string[]): DetailRow | null => (xs.length ? [label, xs.join(', ')] : null);
  rows.push(join('Müşteri Evrak No', uniq(nts.map((n) => n.senderDocNo))));
  rows.push(join('Belge Tarihi', uniq(nts.map((n) => fmtIsoDay(n.senderDocDate)))));
  rows.push(join('Gönderen', uniq(nts.map((n) => n.sender))));
  rows.push(join('Müşteri Sipariş No', uniq(nts.map((n) => n.customerOrderNo))));
  rows.push(join('İstenen İşlem', uniq(nts.map((n) => n.processText))));
  // Kısmi toplam gösterilmez: her belgede top adedi varsa toplam, yoksa satır yok.
  const tops = nts.map((n) => num(n.declaredTopCount));
  rows.push(tops.length && tops.every((t) => t != null) ? ['Belgedeki Top', `${tops.reduce((a, t) => a + (t as number), 0)} top`] : null);
  const batch = txt(incoming.customerBatchNo);
  rows.push(batch ? ['Müşteri Parti No', batch] : null);
  const m = num(incoming.meters);
  rows.push(m != null ? ['Gelen Metre', `${fmtNum(m)} m`] : null);
  const kg = num(incoming.kg);
  rows.push(kg != null ? ['Gelen Kg', `${fmtNum(kg)} kg`] : null);
  const w = num(incoming.widthCm);
  rows.push(w != null ? ['Gelen En', `${fmtNum(w)} cm`] : null);
  const item = txt(incoming.itemText);
  rows.push(item ? ['Gelen Kumaş', item] : null);
  const color = txt(incoming.colorText);
  rows.push(color ? ['Gelen Renk', color] : null);
  return rows.filter((r): r is DetailRow => r !== null);
}

export interface TargetViewInput {
  wo: WorkOrder;
  fallbackItemName?: string | null;
  propertyNames: string[];
  fmtDate: (iso: string) => string;
}

/** Hedef kartı satırları; değeri olmayan yok (renk: hedef renk yoksa "Renksiz / Ham" bilgi olarak kalır). */
export function targetRows({ wo, fallbackItemName, propertyNames, fmtDate }: TargetViewInput): DetailRow[] {
  const rows: (DetailRow | null)[] = [];
  const item = wo.targetItem?.name ?? fallbackItemName ?? null;
  rows.push(item ? ['Ürün', item] : null);
  rows.push(['Renk', wo.targetColor?.name ?? 'Renksiz / Ham']);
  const width = num(wo.width);
  rows.push(width != null ? ['En', `${fmtNum(width)} cm`] : null);
  rows.push(txt(wo.foldType) ? ['Kat Tipi', wo.foldType as string] : null);
  const layers = num(wo.layerCount);
  rows.push(layers != null ? ['Katman', String(layers)] : null);
  // Gramaj = hedef çeşit değeri (ör. Kurşun Gramajı); başka çeşit de aynı satırda adıyla görünür.
  for (const tv of wo.targetValues ?? []) {
    const v = txt(tv?.value?.name);
    if (v) rows.push([txt(tv?.property?.name) ?? 'Gramaj', v]);
  }
  rows.push(propertyNames.length ? ['Üretim Özelliği', propertyNames.join(', ')] : null);
  const q = num(wo.targetQuantity);
  rows.push(q != null ? ['Hedef Metraj', `${fmtNum(q, 0)} m`] : null);
  const kg = num(wo.targetWeight);
  rows.push(kg != null ? ['Hedef Kg', `${fmtNum(kg, 0)} kg`] : null);
  rows.push(wo.plannedStartDate ? ['Planlı Başlangıç', fmtDate(wo.plannedStartDate)] : null);
  rows.push(wo.plannedEndDate ? ['Planlı Termin', fmtDate(wo.plannedEndDate)] : null);
  const orders = [...new Set((wo.orderLinks ?? []).map((l) => l.orderLine?.order?.orderNumber).filter((x): x is string => !!x))];
  rows.push(orders.length ? ['Sipariş', orders.join(', ')] : null);
  return rows.filter((r): r is DetailRow => r !== null);
}

export interface SummaryInput {
  wo: WorkOrder;
  typeLabel: string;
  /** Eski çağıranlar için tutulur; durum başlıkta rozet olduğundan şeritte yer almaz. */
  statusLabel?: string;
  rollCount: number;
  rollMeters: number;
  fmtDate: (iso: string) => string;
}

/** Üst özet şeridi: Müşteri · Bizim parti · Tür · N top · toplam m · oluşturma. Boş olan atlanır. */
export function summaryItems({ wo, typeLabel, rollCount, rollMeters, fmtDate }: SummaryInput): DetailRow[] {
  const items: (DetailRow | null)[] = [];
  const customer = wo.customer?.name ?? wo.orderLinks?.find((l) => l.orderLine?.order?.customer?.name)?.orderLine?.order?.customer?.name ?? null;
  items.push(customer ? ['Müşteri', customer] : null);
  const batches = (wo.batches ?? []).map((b) => b.batchNumber).filter(Boolean);
  items.push(batches.length ? ['Bizim Parti', batches.join(', ')] : null);
  items.push(typeLabel ? ['Tür', typeLabel] : null);
  const inCount = num(wo.inputRolls?.count) ?? 0;
  const count = inCount > 0 ? inCount : rollCount;
  const meters = inCount > 0 ? num(wo.inputRolls?.totalMeters) ?? rollMeters : rollMeters;
  items.push(count > 0 ? ['Top', `${count} top · ${fmtNum(meters, 0)} m`] : null);
  const by = txt(wo.createdBy?.fullName);
  const when = wo.createdAt ? fmtDate(wo.createdAt) : null;
  const created = [when, by].filter(Boolean).join(' · ');
  items.push(created ? ['Oluşturma', created] : null);
  return items.filter((r): r is DetailRow => r !== null);
}

export type StepTone = 'info' | 'neutral' | 'success' | 'warning' | 'danger';

export interface RouteChip {
  id: string;
  seq: number;
  name: string;
  status: string;
  /** Rozet rengi: Aktif=mavi, Beklemede=gri, Bitti=yeşil, Fason dışarıda=amber, İptal=kırmızı. */
  tone: StepTone;
  /** Fason (dış) istasyonda aktif adım → "Fason dışarıda". */
  outside: boolean;
  /** "Fabrika içi" / "Fason (dış)" — bilinmiyorsa null. */
  where: string | null;
}

export function stepTone(status: string, external: boolean): StepTone {
  if (status === 'ACTIVE') return external ? 'warning' : 'info';
  if (status === 'COMPLETED') return 'success';
  if (status === 'CANCELLED') return 'danger';
  return 'neutral';
}

export function routeChips(steps: WorkOrder['steps']): RouteChip[] {
  return [...(steps ?? [])]
    .sort((a, b) => a.stepSequence - b.stepSequence)
    .map((s) => {
      const type = s.station?.type;
      const external = type === 'EXTERNAL';
      return {
        id: s.id,
        seq: s.stepSequence,
        name: s.station?.name ?? '—',
        status: s.status,
        tone: stepTone(s.status, external),
        outside: external && s.status === 'ACTIVE',
        where: type ? (external ? 'Fason (dış)' : 'Fabrika içi') : null,
      };
    });
}
/** Adım notları (fason talimatı vb.) — boşlar atılır. */
export function routeNotes(steps: WorkOrder['steps']): { id: string; name: string; note: string }[] {
  return [...(steps ?? [])]
    .sort((a, b) => a.stepSequence - b.stepSequence)
    .filter((s) => txt(s.notes))
    .map((s) => ({ id: s.id, name: s.station?.name ?? '—', note: (s.notes as string).trim() }));
}

/** Hareket metnindeki ham cihaz kimliğini ("(cihaz e795d09e-…)") siler; cihaz adı yanıtta yok. */
export function stripDeviceId(s: string | null | undefined): string | null {
  if (!s) return null;
  const out = s.replace(/\s*\((?:cihaz|device)\s+[^)]*\)/gi, '').trim();
  return out || null;
}
