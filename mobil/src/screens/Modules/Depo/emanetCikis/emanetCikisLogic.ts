// =============================================================================
// Emanet çıkış (tablet T1) — saf kurallar: okutma eşleşmesi, taslak satırlar, istek gövdesi, engel metni.
// Seçilebilirliğin kararı SUNUCUDA (aday ucu + önizleme aynı yüklem); burada yalnız sunucunun kodu
// Türkçeye çevrilir ve "belgede zaten var" eklenir. Ham kod operatöre basılmaz.
// =============================================================================
import type {
  BeamCandidate,
  ConsignmentBody,
  ConsignmentCandidates,
  ConsignmentItemInput,
  ConsignmentPreview,
  YarnCandidate,
} from '../../../../services/consignment.service';

export interface DraftLine {
  /** `beam:<id>` · `yarn:<lotId>:<warehouseId>` — aynı satır iki kez eklenmez. */
  key: string;
  input: ConsignmentItemInput;
  label: string;
  sub: string;
}

const REASON: Record<string, string> = {
  CONSIGNMENT_OWNER_MISMATCH: 'Sahibi bu müşteri değil',
  CONSIGNMENT_BEAM_NOT_READY: 'Levent hazır (boşta) değil',
  CONSIGNMENT_YARN_INSUFFICIENT: 'Lotun bu depodaki bakiyesi yetmiyor',
  YARN_LOT_INACTIVE: 'Lot pasif — çıkış yapılamaz',
};

/** Tanınmayan kod (yeni sunucu) ham basılmaz; genel cümleye düşer. */
export function blockedText(code: string | null | undefined): string | null {
  if (!code) return null;
  return REASON[code] ?? 'Bu kalem çıkışa uygun değil';
}

export const beamKey = (b: Pick<BeamCandidate, 'warpBeamId'>): string => `beam:${b.warpBeamId}`;
export const yarnKey = (y: Pick<YarnCandidate, 'lotId' | 'warehouseId'>): string => `yarn:${y.lotId}:${y.warehouseId}`;

const fmt = (v: string): string => Number(v).toLocaleString('tr-TR', { maximumFractionDigits: 3 });

export function beamLine(b: BeamCandidate): DraftLine {
  return {
    key: beamKey(b),
    input: { kind: 'WARP_BEAM', warpBeamId: b.warpBeamId },
    label: `Levent ${b.beamNo}`,
    sub: `${b.warpSpecName ?? '—'} · ${fmt(b.remainingM)} m`,
  };
}

export function yarnLine(y: YarnCandidate, qtyKg: string): DraftLine {
  return {
    key: yarnKey(y),
    input: { kind: 'YARN', yarnItemId: y.yarnItemId, warehouseId: y.warehouseId, lotId: y.lotId, qtyKg },
    label: `İplik lot ${y.lotNo}`,
    sub: `${y.itemName} · ${y.warehouseName} · ${fmt(qtyKg)} kg`,
  };
}

/** "12,5" / "12.5" → "12.5"; ≤0, 3'ten çok ondalık ya da sayı değilse null (sunucu Zod'u ile aynı biçim). */
export function parseKg(raw: string): string | null {
  const s = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  return Number(s) > 0 ? s.replace(/^0+(?=\d)/, '') : null;
}

export type ScanMatch =
  | { kind: 'beam'; beam: BeamCandidate }
  | { kind: 'yarn'; yarns: YarnCandidate[] }
  | { kind: 'none' };

/**
 * Okutulan kod → aday. Levent etiketi `beamNo`yu taşır; lotun etiketi yok, lot no elle yazılıp okutulabilir.
 * Büyük/küçük harf ASCII katlanır (beamNo LV+rakam). Bir lot birden çok depoda ise hepsi döner — depo seçilir.
 */
export function matchScan(code: string, c: ConsignmentCandidates): ScanMatch {
  const q = code.trim().toUpperCase();
  if (!q) return { kind: 'none' };
  const beam = c.beams.find((b) => b.beamNo.toUpperCase() === q);
  if (beam) return { kind: 'beam', beam };
  const yarns = c.yarns.filter((y) => y.lotNo.toUpperCase() === q);
  return yarns.length > 0 ? { kind: 'yarn', yarns } : { kind: 'none' };
}

/** Satır seçilemiyorsa Türkçe neden (belgede var ya da sunucu engeli); seçilebilirse null. */
export function lineBlock(key: string, blockedReason: string | null, taken: ReadonlySet<string>): string | null {
  if (taken.has(key)) return 'Belgede zaten var';
  return blockedText(blockedReason);
}

/** Tablet plaka/şoför sormaz (depo kapısında elden iade); araçlı çıkış panelden plaka ile açılır. */
export function buildBody(ownerCustomerId: string, lines: DraftLine[]): ConsignmentBody {
  return { ownerCustomerId, items: lines.map((l) => l.input) };
}

/** Önizleme satırını taslak satıra bağlar (levent → warpBeamId, iplik → lotId; önizleme refId lot düzeyindedir). */
export function previewBlockFor(line: DraftLine, preview: ConsignmentPreview | undefined): string | null {
  if (!preview) return null;
  const refId = line.input.kind === 'WARP_BEAM' ? line.input.warpBeamId : line.input.lotId;
  const hit = preview.lines.find((p) => p.kind === line.input.kind && p.refId === refId && p.blockedReason);
  return blockedText(hit?.blockedReason ?? null);
}

/** Kaydı kapatan neden (null = kaydedilebilir). Sıra: bağlantı → sahip → kalem → önizleme. */
export function submitBlock(a: { online: boolean; hasOwner: boolean; lineCount: number; previewError: boolean; canCreate: boolean | undefined }): string | null {
  if (!a.online) return 'Çevrimdışı — emanet çıkışı bağlantı gelince kaydedilir (belge numarasını sunucu verir).';
  if (!a.hasOwner) return 'Önce malın sahibini seçin.';
  if (a.lineCount === 0) return 'En az bir levent ya da iplik lotu ekleyin.';
  if (a.previewError) return 'Önizleme alınamadı — tekrar deneyin.';
  if (a.canCreate === false) return 'Engelli kalemleri çıkarın.';
  return null;
}
