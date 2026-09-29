// Paket PLANLAMASI (§5 hacim sözleşmesi): kurulan satırlar projeksiyon başına BİRİMLERE,
// birimler PAKETLERE dağılır. Bir projeksiyonun kök satırı ile alt satırları (`.finans`,
// `.kisisel`) daima AYNI birimdedir — bulut onayını ad başına verir, fabrika birim başına bekler.
import { buildRecords, type WireRow } from "./record-builder";
import { membershipIds } from "./reconcile";
import { positionsAfterFull } from "./change-scan";
import { FULL_RESEND_MARKER, type StoredWatermark, type WatermarkWrite } from "./watermarks";
import type { BuiltSnapshot } from "./snapshots";
import type { RecordProjection } from "./projections";
import { MAX_RECORDS_PER_PACKAGE, type DeleteReason, type RecordEntry, type ReconcileEntry, type Watermark } from "./wire";

/** TAM gönderimde sayfa başına kök (alt satırlarla ≤ 3 katı satır). */
export const FULL_PAGE_ROOTS = 1000;
/** Bir birimin en çok satırı — iki birim bir pakete sığsın. */
const UNIT_MAX_ROWS = Math.floor(MAX_RECORDS_PER_PACKAGE / 2);

export interface UnitEntry {
  readonly name: string;
  readonly yaz: WireRow[];
  readonly sil: Array<{ id: string; neden: DeleteReason }>;
}

export interface Unit {
  readonly projection: RecordProjection;
  readonly entries: UnitEntry[];
  readonly full: { parca: number; toplamParca: number; baslangic: string } | null;
  /** Projeksiyonun SON birimi onaylanınca yazılacak kaynak konumları. */
  readonly onComplete: WatermarkWrite[] | null;
  readonly rows: number;
  /** TAM'ın ilk birimi zinciri SIFIRDAN kurar (`önceki: null`) — kopuk zincir TAM'ı da reddettirmesin. */
  readonly startsChain: boolean;
}

export interface PacketDraft {
  readonly units: Unit[];
  readonly snapshots: BuiltSnapshot[];
  readonly reconcile: ReconcileEntry[];
}

function unitRows(entries: readonly UnitEntry[]): number {
  return entries.reduce((n, e) => n + e.yaz.length + e.sil.length, 0);
}

/** Kurulan satırları (kök + alt satır) birimlere böler; silinenler ilk birime. */
export function toUnits(g: {
  readonly projection: RecordProjection;
  readonly built: Map<string, WireRow[]>;
  readonly removed: Array<{ id: string; neden: DeleteReason }>;
  readonly full: Unit["full"];
  readonly startsChain?: boolean;
}): Unit[] {
  const names = [...g.built.keys()];
  const byId = new Map<string, Map<string, WireRow>>();
  for (const [name, rows] of g.built) for (const r of rows) {
    const m = byId.get(r.id) ?? new Map<string, WireRow>();
    m.set(name, r);
    byId.set(r.id, m);
  }
  const ids = [...byId.keys()];
  const rootsPerUnit = Math.max(1, Math.floor(UNIT_MAX_ROWS / Math.max(1, names.length)));
  const makeEntries = (slice: string[], withRemoved: boolean): UnitEntry[] =>
    names.map((name) => ({
      name,
      yaz: slice.map((id) => byId.get(id)?.get(name)).filter((x): x is WireRow => !!x),
      sil: withRemoved ? g.removed.map((r) => ({ ...r })) : [],
    }));
  const unit = (entries: UnitEntry[], first: boolean): Unit => ({
    projection: g.projection,
    entries,
    full: g.full,
    onComplete: null,
    rows: unitRows(entries),
    startsChain: (g.startsChain ?? false) && first,
  });
  if (ids.length === 0) return [unit(makeEntries([], true), true)];
  const units: Unit[] = [];
  for (let i = 0; i < ids.length; i += rootsPerUnit) units.push(unit(makeEntries(ids.slice(i, i + rootsPerUnit), i === 0), i === 0));
  return units;
}

export function withCompletion(units: Unit[], writes: WatermarkWrite[]): Unit[] {
  if (units.length === 0) return units;
  const last = units[units.length - 1]!;
  return [...units.slice(0, -1), { ...last, onComplete: writes }];
}

export function chainOf(stored: StoredWatermark | undefined): Watermark | null {
  if (!stored?.at || !stored.tie?.[0]) return null;
  return { t: stored.at.toISOString(), k: stored.tie[0] };
}

/** Hiç onaylanmamış, bulutun TAM istediği ya da kolon kümesi sürümü değişmiş projeksiyon TAM gider (§6.5). */
export function needsFull(p: RecordProjection, chain: StoredWatermark | undefined): boolean {
  return !chain?.at || chain.digest === FULL_RESEND_MARKER || chain.catalogVersion !== p.catalogVersion;
}

/** OLGU'nun saklama ufku; BOYUT ve tarihsiz OLGU budanmaz. */
export function retentionOf(p: RecordProjection, chain: StoredWatermark | undefined): Date | null {
  return p.retention ? (chain?.retentionFrom ?? null) : null;
}

/** TAM gönderim: kapsam + saklama ufku içindeki bütün kökler, sayfalı; bulut son parçada işaretle-süpür yapar. */
export async function planFull(p: RecordProjection, chain: StoredWatermark | undefined, horizon: Date, nowMs: number): Promise<Unit[]> {
  const ids = await membershipIds(p, { retentionFrom: retentionOf(p, chain), createdBefore: null });
  const pages: string[][] = [];
  for (let i = 0; i < ids.length; i += FULL_PAGE_ROOTS) pages.push(ids.slice(i, i + FULL_PAGE_ROOTS));
  if (pages.length === 0) pages.push([]);
  const units: Unit[] = [];
  const baslangic = horizon.toISOString();
  for (let i = 0; i < pages.length; i++) {
    const built = await buildRecords(p, pages[i]!, nowMs);
    const full = { parca: i + 1, toplamParca: pages.length, baslangic };
    units.push(...toUnits({ projection: p, built: built.rows, removed: built.removed, full, startsChain: i === 0 }));
  }
  // Sayfa içi bölünme `parca`yı değiştirmez; son birim tamamlanınca kaynaklar ufukta başlar.
  return withCompletion(units, positionsAfterFull(p, horizon));
}

export function entryOf(u: UnitEntry, unit: Unit, filigran: { onceki: Watermark | null; yeni: Watermark }): RecordEntry {
  return { projeksiyon: u.name, katalogSurum: unit.projection.catalogVersion, yaz: u.yaz, sil: u.sil, filigran, tam: unit.full };
}

/** Birimleri paketlere doldurur (≤ 5.000 kayıt; bayt tavanı gönderimde ölçülür); anlık ve uzlaştırma ilk pakete. */
export function packDrafts(units: Unit[], snapshots: BuiltSnapshot[], reconcile: ReconcileEntry[]): PacketDraft[] {
  const drafts: PacketDraft[] = [];
  let cur: Unit[] = [];
  let rows = 0;
  for (const u of units) {
    if (cur.length > 0 && rows + u.rows > MAX_RECORDS_PER_PACKAGE) {
      drafts.push({ units: cur, snapshots: [], reconcile: [] });
      cur = [];
      rows = 0;
    }
    cur.push(u);
    rows += u.rows;
  }
  drafts.push({ units: cur, snapshots: [], reconcile: [] });
  drafts[0] = { ...drafts[0]!, snapshots, reconcile };
  return drafts;
}
