// =============================================================================
// İş emri detay sheet'i — yerleşim ve görünür satır kararları (SAF; testli)
// =============================================================================
// Bileşen yalnız çizer: hangi satır görünür, kaç sütun, rota çipleri, özet şeridi burada.
// Boş değer ("—") satırı HİÇ üretilmez; Gelen kartı her zaman vardır (belgesizde yalnız giren metre ya da "Gelen bilgisi yok").
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

export interface IncomingView {
  /** Kritik rakam ("241 m"): belgeden gelen metre; belgesiz İE'de üretime giren metre; ikisi de yoksa null. */
  meters: string | null;
  metersLabel: 'Gelen Metre' | 'Giren Metre';
  /** Metrenin altındaki giriş satırları (kg · en · kumaş · renk · müşteri parti no · nasıl geldi). */
  rows: DetailRow[];
  /** Kaynak belge(ler): "GB… · Evrak … · gg.aa.yyyy" — dokununca belge görüntüleyici. */
  sources: string[];
  /** Kaynak belgenin altındaki künye (gönderen · sipariş no · işlem · belgedeki top). */
  moreRows: DetailRow[];
  /** Ne belge ne giren metre var → kart yalnız "Gelen bilgisi yok" der. */
  empty: boolean;
}

/** "Kumaş nasıl geldi": eski sunucuda (`arrivalForm` yok) null — satır çizilmez. */
export function arrivalText(incoming: WorkOrderIncoming | null | undefined): string | null {
  if (!incoming?.arrivalForm) return null;
  const n = incoming.rootCount ?? 0;
  if (incoming.arrivalForm === 'SINGLE_PIECE') return n > 1 ? `Tek parça · ${n} parti` : 'Tek parça';
  return n > 0 ? `${n} top` : null;
}

/** Tek parça gelen müşteri kumaşı fiziksel top değildir: Bağlı Toplar bölümü bu açıklamayı yazar (yoksa null). */
export function singlePieceNote(incoming: WorkOrderIncoming | null | undefined): string | null {
  if (incoming?.arrivalForm !== 'SINGLE_PIECE') return null;
  const m = num(incoming.meters);
  return `Tek parça müşteri kumaşı${m != null ? ` · ${fmtNum(m)} m` : ''} — üretimde top olarak çıkacak`;
}

/** Tek parçada girdi kökü top listesinde gösterilmez (metre Gelen kartında); top top gelende liste aynen kalır. */
export function visibleAttachedRolls<T extends { id: string }>(rolls: readonly T[], incoming: WorkOrderIncoming | null | undefined): T[] {
  if (incoming?.arrivalForm !== 'SINGLE_PIECE' || !incoming.rootRollIds?.length) return [...rolls];
  const roots = new Set(incoming.rootRollIds);
  return rolls.filter((r) => !roots.has(r.id));
}

/** Gelen (giriş) kartı; dolu olmayan satır yok. `inputMeters` belgesiz İE'nin üretime giren metresi. */
export function incomingView(incoming: WorkOrderIncoming | null | undefined, inputMeters?: number | null): IncomingView {
  if (!incoming) {
    const im = num(inputMeters);
    const has = im != null && im > 0;
    return { meters: has ? `${fmtNum(im)} m` : null, metersLabel: 'Giren Metre', rows: [], sources: [], moreRows: [], empty: !has };
  }
  const nts = incoming.notes ?? [];
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => txt(x)).filter((x): x is string => !!x))];
  const join = (label: string, xs: string[]): DetailRow | null => (xs.length ? [label, xs.join(', ')] : null);
  const m = num(incoming.meters);
  const kg = num(incoming.kg);
  const w = num(incoming.widthCm);
  const item = txt(incoming.itemText);
  const color = txt(incoming.colorText);
  const batch = txt(incoming.customerBatchNo);
  const arrival = arrivalText(incoming);
  const rows: (DetailRow | null)[] = [
    kg != null ? ['Gelen Kg', `${fmtNum(kg)} kg`] : null,
    w != null ? ['Gelen En', `${fmtNum(w)} cm`] : null,
    item ? ['Gelen Kumaş', item] : null,
    color ? ['Gelen Renk', color] : null,
    batch ? ['Müşteri Parti No', batch] : null,
    arrival ? ['Kumaş Nasıl Geldi', arrival] : null,
  ];
  const sources = nts
    .filter((n) => txt(n.noteNo))
    .map((n) => [n.noteNo, txt(n.senderDocNo) ? `Evrak ${txt(n.senderDocNo)}` : null, fmtIsoDay(n.senderDocDate)].filter(Boolean).join(' · '));
  // Kısmi toplam gösterilmez: her belgede top adedi varsa toplam, yoksa satır yok.
  const tops = nts.map((n) => num(n.declaredTopCount));
  const moreRows: (DetailRow | null)[] = [
    join('Gönderen', uniq(nts.map((n) => n.sender))),
    join('Müşteri Sipariş No', uniq(nts.map((n) => n.customerOrderNo))),
    join('İstenen İşlem', uniq(nts.map((n) => n.processText))),
    tops.length && tops.every((t) => t != null) ? ['Belgedeki Top', `${tops.reduce((a, t) => a + (t as number), 0)} top`] : null,
  ];
  return {
    meters: m != null ? `${fmtNum(m)} m` : null,
    metersLabel: 'Gelen Metre',
    rows: rows.filter((r): r is DetailRow => r !== null),
    sources,
    moreRows: moreRows.filter((r): r is DetailRow => r !== null),
    empty: false,
  };
}

export type FixKind3 = 'color' | 'width' | 'gramaj' | 'fold' | 'target';
/** `fold`/`target` eski çağıranlarda yok → kalemsiz (bugünkü davranış). */
export type FixAllowed = Record<Exclude<FixKind3, 'fold' | 'target'>, boolean> & { fold?: boolean; target?: boolean };

/** Kat kilidi (sunucu `computeWorkOrderLocks.foldType` aynası): Tambur adımı başladıysa kat sabittir. */
export function foldLocked(steps: WorkOrder['steps']): boolean {
  const t = (steps ?? []).find((s) => s.station?.kind === 'TAMBUR');
  return !!t && t.status !== 'PENDING';
}

export interface TargetViewInput {
  wo: WorkOrder;
  fallbackItemName?: string | null;
  propertyNames: string[];
  fmtDate: (iso: string) => string;
  /** Gramaj (kurşun çeşit) özelliğinin id'si — kalem bu değere bağlanır; yoksa gramaj kalemi çıkmaz. */
  gramajPropertyId?: string | null;
  /** Hangi satırda kalem (düzeltme) çıkabilir — bugünkü düğme koşulları (canFix / canGramaj). */
  fixAllowed?: FixAllowed;
}

/** Rota adımı çipinin altında gösterilen hedef değer; `label` boşsa yalnız değer yazılır. */
export interface StepTarget {
  label: string;
  value: string;
  fix: FixKind3 | null;
  /** `fix === 'target'` iken düzeltilecek özellik. */
  propertyId?: string;
}

export interface TargetView {
  rows: DetailRow[];
  /** Kart satırı etiketi → o satırın kalemi. */
  fixByLabel: Partial<Record<string, FixKind3>>;
  /** Kart satırı etiketi → 'target' kaleminin özelliği. */
  targetByLabel: Partial<Record<string, string>>;
  /** Adım id → çipin altına düşen hedefler (Hedef kartında yinelenmez). */
  byStep: Record<string, StepTarget[]>;
}

/** Karşılaştırma için Türkçe harfleri ASCII'ye indirir (yalnız eşleme; gösterilmez). */
const foldTr = (s: string): string =>
  s.replace(/[İIı]/g, 'i').replace(/[Şş]/g, 's').replace(/[Ğğ]/g, 'g').replace(/[Üü]/g, 'u').replace(/[Öö]/g, 'o').replace(/[Çç]/g, 'c').toLowerCase();
const lowerTr = (s: string): string => s.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
const upperFirstTr = (s: string): string => (s ? (s[0] === 'i' ? 'İ' : s[0] === 'ı' ? 'I' : s[0].toUpperCase()) + s.slice(1) : s);

/**
 * Adım çipinin altına yazılacak kısa özellik adı (veri-bağımsız): özellik adı adım adıyla
 * başlıyorsa adım adı atılır, tamlama eki (-ı/-i/-u/-ü) düşer: "KURŞUN GRAMAJI" + adım KURŞUN → "Gramaj".
 */
export function shortPropertyLabel(propertyName: string, stepName: string): string {
  const name = propertyName.trim();
  const step = stepName.trim();
  if (!step || foldTr(name.slice(0, step.length)) !== foldTr(step)) return name;
  const rest = name.slice(step.length);
  if (rest && !/^\s/.test(rest)) return name;
  let word = lowerTr(rest.trim());
  if (word.length < 3) return name;
  if (word.length >= 5 && /[^aeıioöuü][ıiuü]$/.test(word)) word = word.slice(0, -1);
  return upperFirstTr(word);
}

const NO_FIX: FixAllowed = { color: false, width: false, gramaj: false, fold: false, target: false };

/**
 * Hedef kartı + rota adımı altı hedefleri. Hedef çeşit değerinin adımı SUNUCUDAN (`tv.edit.stepId`, yazma kapısıyla
 * aynı fonksiyon) — istemci eşleme icat etmez; Kat Tipi TAMBUR türü adıma düşer. Eşlenemeyen / eski sunucu Hedef
 * kartında kalır — bilgi kaybolmaz. Kalem: Renk/En/Kat + gramaj + kilitsiz (`edit.locked === false`) hedef değer.
 */
export function targetView({ wo, fallbackItemName, propertyNames, fmtDate, gramajPropertyId, fixAllowed }: TargetViewInput): TargetView {
  const allow = fixAllowed ?? NO_FIX;
  const steps = [...(wo.steps ?? [])].sort((a, b) => a.stepSequence - b.stepSequence);
  const byStep: Record<string, StepTarget[]> = {};
  const fixByLabel: Partial<Record<string, FixKind3>> = {};
  const targetByLabel: Partial<Record<string, string>> = {};
  const put = (stepId: string, t: StepTarget) => {
    (byStep[stepId] ??= []).push(t);
  };
  const rows: (DetailRow | null)[] = [];
  const row = (label: string, value: string, fix?: FixKind3 | null): DetailRow => {
    if (fix && allow[fix]) fixByLabel[label] = fix;
    return [label, value];
  };
  const item = wo.targetItem?.name ?? fallbackItemName ?? null;
  rows.push(item ? ['Ürün', item] : null);
  rows.push(row('Renk', wo.targetColor?.name ?? 'Renksiz / Ham', 'color'));
  const width = num(wo.width);
  rows.push(width != null ? row('En', `${fmtNum(width)} cm`, 'width') : allow.width ? row('En', 'Belirtilmedi', 'width') : null);
  const fold = txt(wo.foldType);
  const tamburStep = steps.find((s) => s.station?.kind === 'TAMBUR');
  const foldFix: FixKind3 | null = allow.fold && !foldLocked(steps) ? 'fold' : null;
  if (tamburStep && (fold || foldFix)) put(tamburStep.id, { label: fold ? '' : 'Kat', value: fold ?? 'Belirtilmedi', fix: foldFix });
  else rows.push(fold ? row('Kat Tipi', fold, foldFix) : null);
  const layers = num(wo.layerCount);
  rows.push(layers != null ? ['Katman', String(layers)] : null);
  // Gramaj = hedef çeşit değeri (ör. Kurşun Gramajı); başka çeşit de aynı satırda adıyla görünür.
  let gramajShown = false;
  for (const tv of wo.targetValues ?? []) {
    const v = txt(tv?.value?.name);
    if (!v) continue;
    const name = txt(tv?.property?.name) ?? 'Gramaj';
    const isGramaj = !!gramajPropertyId && tv.propertyId === gramajPropertyId;
    const stepId = tv.edit?.stepId ?? null;
    const step = stepId ? steps.find((s) => s.id === stepId) : undefined;
    if (isGramaj) gramajShown = true;
    // Gramaj kendi ön-ayar kartında (başlamış İE'de de değişir); öteki değer yalnız sunucu kilitsiz derse kalemli.
    const canTarget = !isGramaj && !!allow.target && !!tv.propertyId && tv.edit?.locked === false && (tv.property?.values?.length ?? 0) > 0;
    const fix: FixKind3 | null = isGramaj ? (allow.gramaj ? 'gramaj' : null) : canTarget ? 'target' : null;
    if (step) put(step.id, { label: shortPropertyLabel(name, step.station?.name ?? ''), value: v, fix, ...(fix === 'target' ? { propertyId: tv.propertyId } : {}) });
    else {
      rows.push(row(name, v, fix));
      if (fix === 'target' && tv.propertyId) targetByLabel[name] = tv.propertyId;
    }
  }
  if (allow.gramaj && !gramajShown) rows.push(row('Gramaj', 'Belirtilmedi', 'gramaj'));
  rows.push(propertyNames.length ? ['Üretim Özelliği', propertyNames.join(', ')] : null);
  const q = num(wo.targetQuantity);
  rows.push(q != null ? ['Hedef Metraj', `${fmtNum(q, 0)} m`] : null);
  const kg = num(wo.targetWeight);
  rows.push(kg != null ? ['Hedef Kg', `${fmtNum(kg, 0)} kg`] : null);
  rows.push(wo.plannedStartDate ? ['Planlı Başlangıç', fmtDate(wo.plannedStartDate)] : null);
  rows.push(wo.plannedEndDate ? ['Planlı Termin', fmtDate(wo.plannedEndDate)] : null);
  const orders = [...new Set((wo.orderLinks ?? []).map((l) => l.orderLine?.order?.orderNumber).filter((x): x is string => !!x))];
  rows.push(orders.length ? ['Sipariş', orders.join(', ')] : null);
  return { rows: rows.filter((r): r is DetailRow => r !== null), fixByLabel, targetByLabel, byStep };
}

/** Hedef kartı satırları (kalemsiz sade görünüm); ayrıntı için `targetView`. */
export function targetRows(input: TargetViewInput): DetailRow[] {
  return targetView(input).rows;
}

export interface ActionInput {
  canFix: boolean;
  canCancel: boolean;
  isFason: boolean;
  hasOrderLinks: boolean;
}
export interface ActionPlacement {
  /** Başlıkta yazıcı simgesi. */
  reprint: boolean;
  /** Bağlı Toplar kartı başlığı. */
  detach: boolean;
  addBatch: boolean;
  /** Özet şeridi sonu; fason İE'de bağlı sipariş yoksa gizli. */
  orderLink: boolean;
  /** En altta sağa yaslı küçük kırmızı düğme. */
  cancel: boolean;
}

export function actionPlacement({ canFix, canCancel, isFason, hasOrderLinks }: ActionInput): ActionPlacement {
  return {
    reprint: canFix,
    detach: canFix,
    addBatch: canFix,
    orderLink: canFix && !(isFason && !hasOrderLinks),
    cancel: canCancel,
  };
}

export interface SummaryInput {
  wo: WorkOrder;
  typeLabel: string;
  /** Eski çağıranlar için tutulur; durum başlıkta rozet olduğundan şeritte yer almaz. */
  statusLabel?: string;
  rollCount: number;
  rollMeters: number;
  fmtDate: (iso: string) => string;
  /** Tek parça müşteri kumaşı: "N top" yazılmaz (fiziksel top yok; metre Gelen kartında). */
  singlePiece?: boolean;
}

/** Üst özet şeridi: Müşteri · Bizim parti · Tür · N top · toplam m · oluşturma. Boş olan atlanır. */
export function summaryItems({ wo, typeLabel, rollCount, rollMeters, fmtDate, singlePiece }: SummaryInput): DetailRow[] {
  const items: (DetailRow | null)[] = [];
  const customer = wo.customer?.name ?? wo.orderLinks?.find((l) => l.orderLine?.order?.customer?.name)?.orderLine?.order?.customer?.name ?? null;
  items.push(customer ? ['Müşteri', customer] : null);
  const batches = (wo.batches ?? []).map((b) => b.batchNumber).filter(Boolean);
  items.push(batches.length ? ['Bizim Parti', batches.join(', ')] : null);
  items.push(typeLabel ? ['Tür', typeLabel] : null);
  const inCount = num(wo.inputRolls?.count) ?? 0;
  const count = inCount > 0 ? inCount : rollCount;
  const meters = inCount > 0 ? num(wo.inputRolls?.totalMeters) ?? rollMeters : rollMeters;
  items.push(count > 0 && !singlePiece ? ['Top', `${count} top · ${fmtNum(meters, 0)} m`] : null);
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
