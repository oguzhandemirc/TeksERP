// Cihaz kopyası SEZGİSİ (izlenebilirlik D4) — saf, DB'siz. Betik `scripts/cihaz-birlestir.ts`
// ve panel ucu `device-merge.service#candidates` AYNI fonksiyonu okur (tek kaynak).
// Yalnız ÖNERİ üretir: sezgi yanlış pozitif verdi (C-R1 §3), uygulama insan onayıyla.
import type { DeviceKind } from "@prisma/client";

/** Ardıllık penceresi: önceki satırın son görülmesinden sonraki doğum ≤ 6 sa. */
export const SUCCESSOR_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Saat farkı toleransı: yeni kurulum eski kaydın son sinyaliyle aynı dakikada doğabilir. */
const SUCCESSOR_SKEW_MS = 2 * 60 * 1000;

export type MergeConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface CandidateRow {
  id: string;
  deviceId: string;
  name: string;
  kind: DeviceKind;
  status: string;
  isActive: boolean;
  machineId: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export interface CandidateUsage {
  stations: Set<string>;
  machines: Set<string>;
  users: Set<string>;
  versions: string[];
}

export interface CandidateMember {
  id: string;
  deviceId: string;
  name: string;
  kind: DeviceKind;
  isActive: boolean;
  status: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  confidence: MergeConfidence;
  reasons: string[];
  warnings: string[];
}

export interface CandidateGroup {
  kind: DeviceKind;
  confidence: MergeConfidence;
  target: CandidateMember;
  sources: CandidateMember[];
}

/** Sunucunun doğumda verdiği varsayılan ad (`Tablet d7d79d42`) ad farkı sayılmaz. */
const AUTO_NAME_RE = /^(Tablet|Telefon|Masaüstü) [0-9a-f-]{8}$/i;

function normName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function compareVersion(a: string, b: string): number {
  const pa = a.split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = b.split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function formatGap(ms: number): string {
  const dk = Math.max(0, Math.round(ms / 60_000));
  return dk < 60 ? `${dk} dk` : `${Math.round(dk / 6) / 10} sa`;
}

interface Link {
  prev: string;
  next: string;
  score: number;
  reasons: string[];
  warnings: string[];
  forceLow: boolean;
}

function scoreToConfidence(score: number, forceLow: boolean): MergeConfidence {
  if (forceLow) return "LOW";
  return score >= 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";
}

const RANK: Record<MergeConfidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
function minConfidence(a: MergeConfidence, b: MergeConfidence): MergeConfidence {
  return RANK[a] <= RANK[b] ? a : b;
}

/**
 * Saf sezgi (DB'siz; betik ve uç ortak). Aynı türde, önceki satırın son görülmesinden
 * sonraki 6 sa içinde doğan satır "ardıl" adayıdır; puan istasyon/makine/kullanıcı
 * kesişimi ve sürüm sırasıyla artar, aradaki başka doğum ve sürüm gerilemesiyle düşer.
 * İki kullanıcı adı da elle verilmiş ve farklıysa güven DÜŞÜK + "ayrı cihaz olabilir".
 */
export function buildMergeCandidates(
  rows: CandidateRow[],
  usage: Map<string, CandidateUsage>,
): CandidateGroup[] {
  const empty: CandidateUsage = { stations: new Set(), machines: new Set(), users: new Set(), versions: [] };
  const use = (id: string) => usage.get(id) ?? empty;
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const hasSuccessor = new Set<string>();
  const links: Link[] = [];

  for (const next of sorted) {
    let best: Link | null = null;
    for (const prev of sorted) {
      if (prev.id === next.id || prev.kind !== next.kind || hasSuccessor.has(prev.id)) continue;
      if (prev.createdAt.getTime() >= next.createdAt.getTime()) continue;
      const prevEnd = (prev.lastSeenAt ?? prev.createdAt).getTime();
      const gap = next.createdAt.getTime() - prevEnd;
      if (gap < -SUCCESSOR_SKEW_MS || gap > SUCCESSOR_WINDOW_MS) continue;

      const up = use(prev.id);
      const un = use(next.id);
      const reasons: string[] = [];
      const warnings: string[] = [];
      let score = gap <= 30 * 60_000 ? 2 : 1;
      reasons.push(`ardıllık ${formatGap(gap)}`);
      if (overlaps(up.stations, un.stations)) { score += 2; reasons.push("aynı istasyonda çalışılmış"); }
      if (overlaps(up.machines, un.machines)) { score += 1; reasons.push("aynı makinede çalışılmış"); }
      if (overlaps(up.users, un.users)) { score += 1; reasons.push("aynı kullanıcılar"); }
      if (up.versions.length > 0 && un.versions.length > 0) {
        const prevMax = up.versions[up.versions.length - 1]!;
        const nextMin = un.versions[0]!;
        if (compareVersion(prevMax, nextMin) <= 0) { score += 1; reasons.push("uygulama sürümü sırası tutarlı"); }
        else { score -= 2; warnings.push(`uygulama sürümü geriye gidiyor (${prevMax} → ${nextMin})`); }
      }
      // Aradaki pencerede aynı istasyonda başka bir doğum: ardıl belirsizdir.
      const between = sorted.filter((o) =>
        o.id !== prev.id && o.id !== next.id && o.kind === next.kind
        && o.createdAt.getTime() > prevEnd && o.createdAt.getTime() < next.createdAt.getTime()
        && overlaps(use(o.id).stations, up.stations));
      if (between.length > 0) { score -= 2; warnings.push("aradaki sürede aynı istasyonda başka kayıt doğdu"); }
      let forceLow = false;
      if (!AUTO_NAME_RE.test(prev.name) && !AUTO_NAME_RE.test(next.name) && normName(prev.name) !== normName(next.name)) {
        forceLow = true;
        warnings.push(`ayrı cihaz olabilir (adlar farklı: "${prev.name}" / "${next.name}")`);
      }
      const cand: Link = { prev: prev.id, next: next.id, score, reasons, warnings, forceLow };
      if (!best || (cand.forceLow ? 0 : 1) * 100 + cand.score > (best.forceLow ? 0 : 1) * 100 + best.score) best = cand;
    }
    if (best) {
      hasSuccessor.add(best.prev);
      links.push(best);
    }
  }

  // Zincirleri grupla (her satırın en çok bir ardılı, en çok bir öncülü var).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const l of links) parent.set(find(l.next), find(l.prev));
  const byRoot = new Map<string, string[]>();
  for (const r of sorted) {
    const root = find(r.id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)!.push(r.id);
  }
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const groups: CandidateGroup[] = [];
  for (const ids of byRoot.values()) {
    if (ids.length < 2) continue;
    const members = ids.map((id) => rowById.get(id)!);
    // Önerilen ana kayıt: aktif → onaylı → en son görülen.
    const target = [...members].sort((a, b) =>
      Number(b.isActive) - Number(a.isActive)
      || Number(b.status === "APPROVED") - Number(a.status === "APPROVED")
      || (b.lastSeenAt ?? b.createdAt).getTime() - (a.lastSeenAt ?? a.createdAt).getTime())[0]!;
    if (!target.isActive) continue; // ana kayıt olabilecek aktif satır yok: birleştirme 409 olurdu
    const linkOf = (id: string) => links.filter((l) => l.next === id || l.prev === id);
    const toMember = (r: CandidateRow): CandidateMember => {
      const ls = linkOf(r.id);
      let conf: MergeConfidence = "HIGH";
      const reasons: string[] = [];
      const warnings: string[] = [];
      for (const l of ls) {
        conf = minConfidence(conf, scoreToConfidence(l.score, l.forceLow));
        reasons.push(...l.reasons);
        warnings.push(...l.warnings);
      }
      return {
        id: r.id, deviceId: r.deviceId, name: r.name, kind: r.kind, isActive: r.isActive, status: r.status,
        createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, confidence: conf,
        reasons: [...new Set(reasons)], warnings: [...new Set(warnings)],
      };
    };
    const sources = members.filter((m) => m.id !== target.id).map(toMember);
    const groupConf = sources.reduce<MergeConfidence>((c, s) => minConfidence(c, s.confidence), "HIGH");
    groups.push({ kind: target.kind, confidence: groupConf, target: toMember(target), sources });
  }
  return groups.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.sources.length - a.sources.length);
}
