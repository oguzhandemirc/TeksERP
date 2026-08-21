// =============================================================================
// MÜKERRER TESPİT MOTORU (mükerrer paneli v2 P1, 2026-08-22)
// =============================================================================
// Üç kural sınıfıyla (kesin ad · kimlik · bulanık ad — `constants/duplicate-rules`)
// aday ÇİFTLERİ bulur, inceleme kararlarıyla süzer (NOT_DUPLICATE gizli), bağlı
// bileşenlerle GRUPLAR ve her kayda referans sayısı ekler. Her şey istek anında
// hesaplanır — ana veri yüzlerce satırdır (canlı: 228 kumaş, 27 müşteri, 74 renk,
// 8 fason), O(n²) bulanık karşılaştırma ~30k çift → ms mertebesi. Saklanan yalnız
// KARARDIR (`duplicate-review.service`).
//
// ⚠️ Kesin ad için `MasterDataMergeService.findDuplicates` KULLANILMAZ (o yalnız
// grup döner); burada çift düzeyinde gerekçe gerekir. Aynı katlama fonksiyonları
// (`nameFold` kolonu / renkte `foldColorNameForCompare`) → sonuç birebir.
//
// Tasarım: docs/design/MUKERRER-PANELI-TASARIM.md §2.1 + §5 (canlı veri ölçümü).
// =============================================================================
import { DuplicateReviewDecision } from "@prisma/client";
import prisma from "../lib/prisma";
import { MERGE_ENTITIES, type MergeEntity } from "../constants/merge-map";
import {
  DUPLICATE_RULE_LABEL,
  FUZZY_NOISE_WORDS,
  FUZZY_PROFILE,
  IDENTITY_RULES,
  type DuplicateRuleKind,
} from "../constants/duplicate-rules";
import { foldColorNameForCompare, foldNameForCompare } from "./helpers/name-normalize.helper";
import {
  firmNameSimilarity,
  productNameSimilarity,
  numericTokensEqual,
} from "../utils/string-similarity";
import { countReferences } from "./master-data-merge.service";
import {
  DuplicateReviewService,
  pairKeyOf,
  type DuplicateReviewDto,
} from "./duplicate-review.service";
import {
  readDuplicatesFuzzyEnabled,
  readDuplicatesFuzzyThresholdPct,
} from "./system-setting.service";
import { AppError } from "../utils/app-error";

export interface DuplicateCandidateRecord {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
  /** Kimlik alanlarının HAM değerleri (panel "neden aday" satırında gösterir). */
  identity: Record<string, string | null>;
  /** Merge-map'teki toplam referans — `null` = ölçülemedi (panel "?" basar). */
  refCount: number | null;
}

export interface DuplicatePairEvidence {
  rule: DuplicateRuleKind;
  label: string;
  /** Yalnız FUZZY_NAME: 0..1 benzerlik. */
  score?: number;
  /** İnsan okunur ayrıntı: "Vergi no 1234567890" / "benzerlik %93". */
  detail: string;
}

export interface DuplicateCandidatePair {
  aId: string;
  bId: string;
  pairKey: string;
  evidence: DuplicatePairEvidence[];
  /** Varsa operatörün kararı (DEFERRED kuyrukta görünür; NOT_DUPLICATE süzülür). */
  review: {
    id: string;
    decision: DuplicateReviewDecision;
    note: string | null;
    decidedAt: Date;
    decidedBy: string | null;
  } | null;
}

export interface DuplicateCandidateGroup {
  /** Grup anahtarı — üye id'lerinin sıralı birleşimi (kararlı). */
  key: string;
  records: DuplicateCandidateRecord[];
  pairs: DuplicateCandidatePair[];
  /** Gruptaki kural türleri (rozetler) ve en yüksek bulanık skor. */
  rules: DuplicateRuleKind[];
  maxScore: number | null;
  /** Grupta ertelenmiş çift var mı (panelde işaret). */
  hasDeferred: boolean;
}

export interface DuplicateScanResult {
  entity: MergeEntity;
  scannedAt: string;
  fuzzyEnabled: boolean;
  thresholdPct: number;
  totals: {
    records: number;
    pairs: number;
    groups: number;
    /** "Mükerrer değil" kararıyla gizlenen çift sayısı (filtreyle görülebilir). */
    hiddenNotDuplicate: number;
  };
  groups: DuplicateCandidateGroup[];
}

type Row = {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
  nameFold: string | null;
  identity: Record<string, string | null>;
};

/** Varlık satırlarını yükler — yalnız CANLI kayıtlar (tombstone hariç), kimlik alanlarıyla. */
async function loadRows(entity: MergeEntity): Promise<Row[]> {
  const identityFields = IDENTITY_RULES[entity].map((r) => r.field);
  const baseSelect: Record<string, boolean> = {
    id: true,
    code: true,
    name: true,
    isActive: true,
    nameFold: true,
  };
  for (const f of identityFields) baseSelect[f] = true;
  const delegate = (
    {
      customer: prisma.customer,
      item: prisma.item,
      color: prisma.color,
      subcontractor: prisma.subcontractor,
    } as Record<MergeEntity, { findMany: (args: unknown) => Promise<unknown[]> }>
  )[entity];
  const rows = (await delegate.findMany({
    where: { mergedIntoId: null },
    select: baseSelect,
    orderBy: { createdAt: "asc" },
  })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    code: (r.code as string | null) ?? null,
    name: String(r.name ?? ""),
    isActive: Boolean(r.isActive),
    nameFold: (r.nameFold as string | null) ?? null,
    identity: Object.fromEntries(identityFields.map((f) => [f, (r[f] as string | null) ?? null])),
  }));
}

/** Karşılaştırma anahtarı: renk token-sırası bağımsız (servis guard'ıyla aynı), diğerleri `nameFold`. */
function foldKey(entity: MergeEntity, row: Row): string {
  if (entity === "color") return foldColorNameForCompare(row.name);
  return row.nameFold ?? foldNameForCompare(row.name);
}

/** Union-find — çiftlerden bağlı bileşen (grup). */
class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}

export const DuplicateDetectionService = {
  /**
   * Varlık için aday tarama. `includeNotDuplicate: true` → operatörün "mükerrer değil"
   * dediği çiftler de döner (panel filtresi; varsayılan gizli).
   */
  async scan(
    rawEntity: string,
    opts: { includeNotDuplicate?: boolean } = {},
  ): Promise<DuplicateScanResult> {
    if (!(MERGE_ENTITIES as readonly string[]).includes(rawEntity)) {
      throw AppError.badRequest(`Mükerrer taraması desteklenmiyor: '${rawEntity}'.`);
    }
    const entity = rawEntity as MergeEntity;
    const [rows, fuzzyEnabled, thresholdPct, reviews] = await Promise.all([
      loadRows(entity),
      readDuplicatesFuzzyEnabled(),
      readDuplicatesFuzzyThresholdPct(),
      DuplicateReviewService.mapByPairKey(entity),
    ]);

    // Çift → gerekçe listesi (aynı çift birden çok kuralla gelebilir).
    const evidenceByPair = new Map<string, { aId: string; bId: string; evidence: DuplicatePairEvidence[] }>();
    const add = (a: Row, b: Row, ev: DuplicatePairEvidence): void => {
      const key = pairKeyOf(a.id, b.id);
      const cur = evidenceByPair.get(key);
      if (cur) {
        if (!cur.evidence.some((e) => e.rule === ev.rule && e.detail === ev.detail)) cur.evidence.push(ev);
      } else {
        evidenceByPair.set(key, {
          aId: a.id < b.id ? a.id : b.id,
          bId: a.id < b.id ? b.id : a.id,
          evidence: [ev],
        });
      }
    };

    // 1) KESİN AD — katlanmış anahtar eşitliği
    const byFold = new Map<string, Row[]>();
    for (const r of rows) {
      const k = foldKey(entity, r);
      if (!k) continue;
      const list = byFold.get(k);
      if (list) list.push(r);
      else byFold.set(k, [r]);
    }
    for (const list of byFold.values()) {
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          add(list[i], list[j], {
            rule: "EXACT_NAME",
            label: DUPLICATE_RULE_LABEL.EXACT_NAME,
            detail: `Katlanmış ad aynı: "${list[i].name}" ≡ "${list[j].name}"`,
          });
    }

    // 2) KİMLİK — normalize edilmiş alan değeri eşitliği
    for (const rule of IDENTITY_RULES[entity]) {
      const byVal = new Map<string, Row[]>();
      for (const r of rows) {
        const raw = r.identity[rule.field];
        if (!raw) continue;
        const k = rule.normalize(raw);
        if (!k) continue;
        const list = byVal.get(k);
        if (list) list.push(r);
        else byVal.set(k, [r]);
      }
      for (const [val, list] of byVal) {
        if (list.length < 2) continue;
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++)
            add(list[i], list[j], {
              rule: "IDENTITY",
              label: DUPLICATE_RULE_LABEL.IDENTITY,
              detail: `${rule.label} aynı: ${val}`,
            });
      }
    }

    // 3) BULANIK AD — eşik üstü benzerlik + NUMERİK TOKEN KORUMASI; kesin eşler atlanır.
    //    Profil varlığa göre: FIRM (gürültü + JW/token-sort) · PRODUCT (varyant ailesi →
    //    token sayısı eşit, yalnız token-sort; yazım/boşluk farkı %100). Gerekçe: duplicate-rules.
    if (fuzzyEnabled) {
      const threshold = thresholdPct / 100;
      const profile = FUZZY_PROFILE[entity];
      const folded = rows.map((r) => ({ row: r, key: foldKey(entity, r) }));
      for (let i = 0; i < folded.length; i++) {
        const a = folded[i];
        if (!a.key || a.key.length < 3) continue;
        for (let j = i + 1; j < folded.length; j++) {
          const b = folded[j];
          if (!b.key || b.key.length < 3 || a.key === b.key) continue;
          if (!numericTokensEqual(a.key, b.key)) continue;
          const score =
            profile === "FIRM"
              ? firmNameSimilarity(a.key, b.key, FUZZY_NOISE_WORDS)
              : productNameSimilarity(a.key, b.key);
          if (score < threshold) continue;
          add(a.row, b.row, {
            rule: "FUZZY_NAME",
            label: DUPLICATE_RULE_LABEL.FUZZY_NAME,
            score,
            detail:
              score >= 0.999 && profile === "PRODUCT"
                ? `Yalnız yazım/boşluk farkı: "${a.row.name}" ~ "${b.row.name}"`
                : `Benzerlik %${Math.round(score * 100)}: "${a.row.name}" ~ "${b.row.name}"`,
          });
        }
      }
    }

    // 4) KARAR SÜZGECİ + GRUPLAMA
    let hiddenNotDuplicate = 0;
    const pairs: DuplicateCandidatePair[] = [];
    for (const [pairKey, p] of evidenceByPair) {
      const review: DuplicateReviewDto | undefined = reviews.get(pairKey);
      if (review?.decision === DuplicateReviewDecision.NOT_DUPLICATE && !opts.includeNotDuplicate) {
        hiddenNotDuplicate++;
        continue;
      }
      pairs.push({
        aId: p.aId,
        bId: p.bId,
        pairKey,
        evidence: p.evidence,
        review: review
          ? {
              id: review.id,
              decision: review.decision,
              note: review.note,
              decidedAt: review.decidedAt,
              decidedBy: review.decidedBy?.fullName ?? review.decidedBy?.username ?? null,
            }
          : null,
      });
    }
    const uf = new UnionFind();
    for (const p of pairs) uf.union(p.aId, p.bId);
    const members = new Map<string, Set<string>>();
    for (const p of pairs) {
      const root = uf.find(p.aId);
      const set = members.get(root) ?? new Set<string>();
      set.add(p.aId);
      set.add(p.bId);
      members.set(root, set);
    }
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const groups: DuplicateCandidateGroup[] = [];
    for (const set of members.values()) {
      const ids = [...set].sort();
      const groupPairs = pairs.filter((p) => set.has(p.aId) && set.has(p.bId));
      const records: DuplicateCandidateRecord[] = [];
      for (const id of ids) {
        const r = rowById.get(id);
        if (!r) continue;
        records.push({
          id: r.id,
          code: r.code,
          name: r.name,
          isActive: r.isActive,
          identity: r.identity,
          refCount: await countReferences(entity, r.id),
        });
      }
      const rules = [...new Set(groupPairs.flatMap((p) => p.evidence.map((e) => e.rule)))];
      const scores = groupPairs.flatMap((p) => p.evidence.map((e) => e.score ?? null)).filter((s): s is number => s !== null);
      groups.push({
        key: ids.join("|"),
        records,
        pairs: groupPairs,
        rules,
        maxScore: scores.length ? Math.max(...scores) : null,
        hasDeferred: groupPairs.some((p) => p.review?.decision === DuplicateReviewDecision.DEFERRED),
      });
    }
    // Önce kesin/kimlik (en güvenli), sonra en çok referanslı grup — operatör en pahalı bölünmeyi ilk görsün.
    const weight = (g: DuplicateCandidateGroup): number =>
      (g.rules.includes("EXACT_NAME") ? 2 : 0) + (g.rules.includes("IDENTITY") ? 1 : 0);
    groups.sort(
      (a, b) =>
        weight(b) - weight(a) ||
        b.records.reduce((n, r) => n + (r.refCount ?? 0), 0) - a.records.reduce((n, r) => n + (r.refCount ?? 0), 0),
    );

    return {
      entity,
      scannedAt: new Date().toISOString(),
      fuzzyEnabled,
      thresholdPct,
      totals: { records: rows.length, pairs: pairs.length, groups: groups.length, hiddenNotDuplicate },
      groups,
    };
  },

  /** Aday raporu CSV (`;` + BOM, tr-TR Excel — içe aktarım sözleşmesiyle aynı). */
  toCsv(result: DuplicateScanResult): string {
    const esc = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "grup", "kural", "skor", "aId", "aKod", "aAd", "aAktif", "aRef", "bId", "bKod", "bAd", "bAktif", "bRef", "karar", "not",
    ];
    const lines = [header.join(";")];
    result.groups.forEach((g, gi) => {
      const byId = new Map(g.records.map((r) => [r.id, r]));
      for (const p of g.pairs) {
        const a = byId.get(p.aId);
        const b = byId.get(p.bId);
        if (!a || !b) continue;
        const score = p.evidence.map((e) => e.score).filter((s): s is number => typeof s === "number");
        lines.push(
          [
            gi + 1,
            p.evidence.map((e) => e.label).join(" + "),
            score.length ? Math.round(Math.max(...score) * 100) : "",
            a.id, a.code ?? "", a.name, a.isActive ? "evet" : "hayır", a.refCount ?? "?",
            b.id, b.code ?? "", b.name, b.isActive ? "evet" : "hayır", b.refCount ?? "?",
            p.review?.decision ?? "",
            p.review?.note ?? "",
          ]
            .map(esc)
            .join(";"),
        );
      }
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  },
};
