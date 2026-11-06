// =============================================================================
// İş Emirleri (tablet) — liste satırı görünüm modeli + sunucu sorgu parametreleri (SAF; testli)
// =============================================================================
// "Şu an nerede" kaynağı backend `workorder-location.helper` (`konum`); burada yalnız gösterim kararı verilir
// (panel `location.ts` `locationView` aynası). Süzme/sıralama SUNUCUDADIR — bu dosya yalnız parametre kurar.
// =============================================================================
import { factoryDayEndIso, factoryDayStartIso } from '../../../lib/factory-time';
import { calendarKey, type DateRange } from '../../../components/filters/rollHistoryFilter';
import { stationToneFor, type StationTone } from '../../../theme/stationTone';
import { TERIM } from '../../../lib/terim';

export interface LocationStation {
  istasyonId: string;
  ad: string;
  tur: string;
  dis: boolean;
  topSayisi: number;
  metre: number;
  fasondaTop: number;
  fasoncular: string[];
}

export interface WorkOrderLocation {
  sinif: 'BASLAMADI' | 'TEK_ISTASYON' | 'BOLUNMUS' | 'FASONDA' | 'BITTI';
  canliTop: number;
  istasyonlar: LocationStation[];
}

/** Liste ucunun bu ekranın okuduğu alanları (mobil `WorkOrder` tipi bunları taşımaz). */
export interface WorkOrderListRow {
  id: string;
  workOrderNumber: string;
  status: string;
  createdAt: string;
  targetItem?: { name: string } | null;
  targetColor?: { name: string } | null;
  batches?: { batchNumber: string }[];
  _count?: { batches?: number };
  customers?: { id: string; name: string }[];
  inputMeters?: number;
  producedMeters?: number;
  konum?: WorkOrderLocation;
}

/** Rozet: büyük, istasyon renginde dolgulu; renk tek taşıyıcı değil — metin her zaman yazar. */
export type LocationBadge =
  | { kind: 'station'; text: string; extra: number; tone: StationTone; detail: string }
  | { kind: 'plain'; text: string; detail: string };

const CLOSED = new Set(['CANCELLED', 'SUPERSEDED']);

export function locationBadge(konum: WorkOrderLocation | undefined, status: string): LocationBadge {
  if (!konum) return { kind: 'plain', text: '—', detail: '' };
  const first = konum.istasyonlar[0];
  if (!first) {
    if (CLOSED.has(status)) return { kind: 'plain', text: status === 'SUPERSEDED' ? 'Devredildi' : 'İptal', detail: '' };
    if (konum.sinif === 'BASLAMADI') return { kind: 'plain', text: 'Başlamadı', detail: '' };
    return { kind: 'plain', text: status === 'COMPLETED' ? 'Tamamlandı' : 'Üretim bitti', detail: '' };
  }
  const fason = konum.sinif === 'FASONDA' || (first.dis && first.fasondaTop > 0);
  const text = (fason ? first.fasoncular[0] : undefined) ?? first.ad;
  const detail = fason && text !== first.ad ? `${first.ad} · ${first.topSayisi} top` : `${first.topSayisi} top`;
  return { kind: 'station', text, extra: konum.istasyonlar.length - 1, tone: stationToneFor(first.dis, first.tur), detail };
}

/** Müşteri hücresi: ilk müşteri + "+N". */
export function customerText(r: Pick<WorkOrderListRow, 'customers'>): string {
  const c = r.customers ?? [];
  if (c.length === 0) return '—';
  return c.length > 1 ? `${c[0].name} +${c.length - 1}` : c[0].name;
}

export function fabricText(r: Pick<WorkOrderListRow, 'targetItem' | 'targetColor'>): string {
  const parts = [r.targetItem?.name, r.targetColor?.name].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

export function batchText(r: Pick<WorkOrderListRow, 'batches' | '_count'>): string {
  const b = r.batches ?? [];
  if (b.length === 0) return '—';
  const more = (r._count?.batches ?? b.length) - 1;
  return more > 0 ? `${b[0].batchNumber} +${more}` : b[0].batchNumber;
}

export function rollMeterText(r: Pick<WorkOrderListRow, 'konum' | 'inputMeters'>): string {
  const tops = r.konum?.canliTop ?? 0;
  const m = Math.round(Number(r.inputMeters ?? 0));
  return `${tops} top · ${m.toLocaleString('tr-TR')} m`;
}

// ── Süzgeçler ────────────────────────────────────────────────────────────────
export type StatusFilter = 'OPEN' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ALL';

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'OPEN', label: 'Açık (planlı + devam eden)' },
  { value: 'IN_PROGRESS', label: 'Devam ediyor' },
  { value: 'PLANNED', label: 'Planlandı' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'CANCELLED', label: 'İptal edildi' },
  { value: 'ALL', label: 'Tümü' },
];

const STATUS_PARAM: Record<StatusFilter, string | null> = {
  OPEN: 'PLANNED,IN_PROGRESS',
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ALL: null,
};

export interface ListFilters {
  search: string;
  status: StatusFilter;
  stationId: string | null;
  range: DateRange | null;
}

export const DEFAULT_FILTERS: ListFilters = { search: '', status: 'OPEN', stationId: null, range: null };

/** Sayfa boyu (30–50 arası; satır kompakt, tablette bir ekran ≈ 12–15 satır). */
export const PAGE_SIZE = 40;
/** Bundan kısa aramada sunucuya gidilmez (her harfte tam tarama olmasın). */
export const MIN_SEARCH = 2;

export interface ListQuery {
  search?: string;
  filters: Record<string, string>;
  dateField?: 'createdAt';
  dateFrom?: string;
  dateTo?: string;
}

/** Süzgeç durumu → liste ucunun parametreleri (aynı nesne sorgu anahtarıdır). */
export function buildListQuery(f: ListFilters): ListQuery {
  const q: ListQuery = { filters: {} };
  const s = f.search.trim();
  if (s.length >= MIN_SEARCH) q.search = s;
  const st = STATUS_PARAM[f.status];
  if (st) q.filters.status = st;
  if (f.stationId) q.filters.konumIstasyon = f.stationId;
  if (f.range) {
    q.dateField = 'createdAt';
    q.dateFrom = factoryDayStartIso(calendarKey(f.range.from));
    q.dateTo = factoryDayEndIso(calendarKey(f.range.to));
  }
  return q;
}

export function activeFilterCount(f: ListFilters): number {
  return (f.status !== DEFAULT_FILTERS.status ? 1 : 0) + (f.stationId ? 1 : 0) + (f.range ? 1 : 0);
}

// ── Boş liste ────────────────────────────────────────────────────────────────
export type EmptyAction = 'clearFilters' | 'showAllStatuses' | null;

/** Boş listenin başlığı + çıkış eylemi. Varsayılan "Açık" süzgeci de bir süzgeçtir: kapalı/iptal kayıt varken
 *  "henüz yok" demek yanıltır (UX denetimi 2026-11-06) — operatöre tek dokunuşla tüm durumlar sunulur. */
export function emptyStateFor(f: ListFilters): { title: string; text: string; action: EmptyAction } {
  const narrowed = f.search.trim().length >= MIN_SEARCH || !!f.stationId || !!f.range;
  if (narrowed) return { title: 'Bu süzgece uyan kayıt yok', text: 'Aramayı ya da süzgeçleri değiştirin.', action: 'clearFilters' };
  if (f.status !== 'ALL') {
    const label = STATUS_FILTER_OPTIONS.find((o) => o.value === f.status)?.label.replace(/ \(.*\)$/, '') ?? f.status;
    return { title: `"${label}" durumunda ${TERIM.terbiyeIsEmri.tekilKucuk} yok`, text: 'Diğer durumlardaki kayıtlar için tüm durumları gösterin.', action: 'showAllStatuses' };
  }
  return { title: `Henüz ${TERIM.terbiyeIsEmri.tekilKucuk} yok`, text: 'Alttaki "Okut" ile belgeden açabilirsiniz.', action: null };
}
