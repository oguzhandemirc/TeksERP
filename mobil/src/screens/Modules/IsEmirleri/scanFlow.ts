// =============================================================================
// İş Emirleri — "İş Emri Türü" grupları + okutma önizlemesi karo modeli ve yerleşimi (SAF; testli)
// =============================================================================
// Tür: iki grup — "Özel iş emirleri" (Okutmayla fabrikada rotasız + kısayol işaretli rotalar) ve "Hazır rotalar" (kalan
// aktif rotalar). Varsayılan: Okutmayla → rotasız; Sıralı → ilk hazır rota (yoksa ilk kısayol; hiçbiri yoksa null →
// Okut pasif). Rotasız SIRALI'da sunulmaz: sunucu 400 `GELEN_BELGE_ROUTE_REQUIRED` verir (kural değişmez).
// Önizleme: şablon alanları varsa bulundu = yeşil, bulunamadı = kırmızı; yoksa özetten yedek karolar (bulunamayan gri).
// Yerleşim kaydırmasız tek ekran: sütun/yazı boyu pencereden hesaplanır, sığmayan karo "+N alan" karosuna düşer.
// =============================================================================
import type { ProductionRoute } from '../../../services/route.service';
import type { ReadSummary } from '../../../services/inboundDoc.service';
import { SCAN_ROUTE, shortcutRoutes } from '../GelenBelge/woCreate/woFromDoc';
import type { WoCreateKind } from '../../../store/woCreateKinds';

export interface TypeGroups {
  special: ProductionRoute[];
  ready: ProductionRoute[];
}

export function typeGroups(allRoutes: readonly ProductionRoute[], shortcuts: readonly ProductionRoute[], scanMode: boolean): TypeGroups {
  const special = shortcutRoutes(shortcuts);
  const ids = new Set(special.map((r) => r.id));
  const ready = allRoutes
    .filter((r) => r.isActive !== false && !ids.has(r.id) && r.isWorkOrderShortcut !== true)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return { special: scanMode ? [SCAN_ROUTE, ...special] : special, ready };
}

export function defaultType(g: TypeGroups, scanMode: boolean): ProductionRoute | null {
  if (scanMode) return g.special[0] ?? null;
  return g.ready[0] ?? g.special[0] ?? null;
}

/** Seçili tür hâlâ listede mi (rota pasife alındı / kip değişti) — değilse varsayılana dönülür. */
export function resolveType(selectedId: string | null, g: TypeGroups, scanMode: boolean): ProductionRoute | null {
  const all = [...g.special, ...g.ready];
  return (selectedId ? all.find((r) => r.id === selectedId) : undefined) ?? defaultType(g, scanMode);
}

export type TileState = 'found' | 'missing' | 'unknown';

export interface PreviewTile {
  key: string;
  label: string;
  value: string;
  state: TileState;
}

const num = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('tr-TR') : String(v);
};

/** Özet → karolar. Şablon alanı listesi varsa TEK kaynak odur; yoksa yaygın alanlardan yedek. */
export function previewTiles(s: ReadSummary): PreviewTile[] {
  if (s.templateFields && s.templateFields.length > 0) {
    return s.templateFields.map((f) => ({ key: f.key, label: f.label, value: f.value ?? 'Bulunamadı', state: f.value ? 'found' : 'missing' }));
  }
  const ff = s.formFields ?? {};
  const rows: [string, string, string | null][] = [
    ['musteri', 'Müşteri', s.ownerSuggestion?.name ?? s.ownerUnmatched?.text ?? null],
    ['parti', 'Parti no', s.customerBatchNo ?? null],
    ['metre', 'Metre', num(s.kursunMeters)],
    ['desen', 'Desen / kumaş', ff.desenText ?? null],
    ['renk', 'Renk', ff.renkText ?? null],
    ['en', 'En', num(ff.en)],
    ['top', 'Top satırı', s.lineCount > 0 ? String(s.lineCount) : null],
  ];
  return rows.map(([key, label, v]) => ({ key, label, value: v ?? '—', state: v ? 'found' : 'unknown' }));
}

export interface TileLayout {
  columns: number;
  rows: number;
  /** Ekranda gösterilecek karo sayısı; fazlası "+N alan" karosuyla özetlenir. */
  shown: number;
  hidden: number;
  tileHeight: number;
  valueSize: number;
  labelSize: number;
}

/** Saf yerleşim: `width`×`height` = karo alanının ölçüsü (başlık/düğmeler düşülmüş). Karo ≥ 72dp yüksek. */
export function tileLayout(count: number, width: number, height: number, gap = 12): TileLayout {
  // Kart alanı: yatay tablette ~730dp → 4 sütun; dikey telefonda ~280–330dp → 2 sütun.
  let columns = width >= 680 ? 4 : width >= 480 ? 3 : 2;
  const minTile = 72;
  const maxRows = Math.max(1, Math.floor((height + gap) / (minTile + gap)));
  while (columns < 6 && Math.ceil(count / columns) > maxRows && width / (columns + 1) >= 140) columns++;
  const capacity = columns * maxRows;
  const overflow = count > capacity;
  const shown = overflow ? capacity - 1 : count;
  const rows = Math.max(1, Math.ceil((overflow ? capacity : count) / columns));
  const tileHeight = Math.max(minTile, Math.min(160, Math.floor((height - gap * (rows - 1)) / rows)));
  const valueSize = Math.max(16, Math.min(28, Math.round(tileHeight * 0.3)));
  const labelSize = Math.max(12, Math.min(16, Math.round(tileHeight * 0.16)));
  return { columns, rows, shown, hidden: count - shown, tileHeight, valueSize, labelSize };
}

/** Alt çubuk düğme adları (tür başına ayrı düğme; her biri doğrudan okutmaya gider). */
export const KIND_BUTTON: Record<WoCreateKind, string> = { STANDARD: 'İE oluştur', CUSTOMER_GOODS: 'Fason İE oluştur' };

/** Okutma akışının İE türü: Fason düğmesi → Fason (müşteri malı); İE oluştur → null (bugünkü türetme). */
export const scanWoType = (kind: WoCreateKind): 'CUSTOMER_GOODS_SERVICE' | null => (kind === 'CUSTOMER_GOODS' ? 'CUSTOMER_GOODS_SERVICE' : null);

/** Fason önizlemesi: müşteri (malın sahibi) İLK ve büyük karo; eşleşmiş cari yoksa kırmızı "seçin" (ham belge metni müşteri değildir). */
export function customerGoodsTiles(s: ReadSummary): PreviewTile[] {
  const name = s.ownerSuggestion?.name ?? null;
  const head: PreviewTile = { key: 'musteri', label: 'Müşteri (malın sahibi)', value: name ?? 'Bulunamadı — seçin', state: name ? 'found' : 'missing' };
  return [head, ...previewTiles(s).filter((t) => t.key !== 'musteri')];
}
