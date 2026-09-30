// Backend güncelleme POLİTİKASI ve KARARI (Dağıtım v2 — docs/design/GUNCELLEYICI.md §2–§3): kiradaki politikanın
// etkin hâli · pencere kuralının mutlak aralıkları (yalnız satıcı basar) · güncelleyicinin TEK karar noktası.
// SAF; güncelleyici (Rust) kararı `native/test-vektorleri/guncelleme-karar.json` ile aynalar.
import {
  compareVersions,
  parseVersion,
  type ApprovalTiming,
  type ReleaseManifest,
  type UpdateDecisionKind,
  type UpdateDecisionReason,
} from "./guncelleme";
import { PgVersionSchema, comparePgVersions, pgMajor, type PgRequirement } from "./guncelleme-pg";
import {
  TimeZoneNameSchema,
  UPDATE_INTERVAL_MAX,
  defaultUpdatePolicy,
  type LeaseDoc,
  type LeaseUpdatePolicy,
  type UpdateInterval,
  type UpdateWindowRule,
} from "./belgeler";
import { CLOCK_SKEW_MS, DAY_MS, isoToMs, msToIso } from "./ortak";

// ── Pencere aritmetiği (yalnız satıcı ve backend gösterimi; güncelleyici mutlak aralığı okur) ──
export function isKnownTimeZone(zone: string): boolean {
  if (!TimeZoneNameSchema.safeParse(zone).success) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  readonly y: number;
  readonly mo: number;
  readonly d: number;
  readonly h: number;
  readonly mi: number;
}

function wallClock(utcMs: number, zone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour"), mi: n("minute") };
}

/** Dilimin o andaki UTC farkı (dakika hassasiyetinde; saniyeli ofsetler yok sayılır). */
function zoneOffsetMs(utcMs: number, zone: string): number {
  const minuteFloor = Math.floor(utcMs / 60_000) * 60_000;
  const w = wallClock(minuteFloor, zone);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - minuteFloor;
}

/** Yerel duvar saati → UTC (belirlenimli): çift yaşanan saatte İLK ana, yaz saati boşluğunda boşluktan SONRAKİ ana düşer. */
function localToUtc(w: WallClock, zone: string): number {
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  const candidates = [...new Set([asUtc - zoneOffsetMs(asUtc - DAY_MS, zone), asUtc - zoneOffsetMs(asUtc + DAY_MS, zone)])].sort((a, b) => a - b);
  const exact = candidates.filter((c) => {
    const x = wallClock(c, zone);
    return x.y === w.y && x.mo === w.mo && x.d === w.d && x.h === w.h && x.mi === w.mi;
  });
  return exact.length > 0 ? exact[0] : candidates[candidates.length - 1];
}

/** Takvim günü (`dayIndex` gün sonrası) + "HH:MM" (ya da gün sonu "24:00") → duvar saati. */
function at(first: WallClock, dayIndex: number, clockText: string): WallClock {
  const endOfDay = clockText === "24:00";
  const [h, mi] = endOfDay ? [0, 0] : clockText.split(":").map(Number);
  const day = new Date(Date.UTC(first.y, first.mo - 1, first.d + dayIndex + (endOfDay ? 1 : 0)));
  return { y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate(), h, mi };
}

/** ISO haftanın günü (1 = Pazartesi … 7 = Pazar). */
function isoWeekday(w: WallClock): number {
  return ((new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay() + 6) % 7) + 1;
}

/**
 * Kuralın `[fromMs, toMs)` ile kesişen mutlak aralıkları (başlangıç sırasıyla, en çok `UPDATE_INTERVAL_MAX`).
 * Aralık kırpılmaz: pencere kira verilmeden başlamışsa gerçek başlangıcı yazılır. Bilinmeyen dilim fırlatır.
 */
export function windowIntervals(rule: UpdateWindowRule, fromMs: number, toMs: number): UpdateInterval[] {
  const zone = rule.saatDilimi;
  if (!isKnownTimeZone(zone)) throw new Error(`windowIntervals: bilinmeyen saat dilimi ${zone}`);
  const crossesMidnight = rule.bitis !== "24:00" && rule.bitis < rule.baslangic;
  // Gece yarısını aşan (≤ 24 sa + yaz saati) pencere iki gün önce başlamış olabilir.
  const first = wallClock(fromMs - 2 * DAY_MS, zone);
  const out: UpdateInterval[] = [];
  for (let i = 0; out.length < UPDATE_INTERVAL_MAX; i++) {
    const startWall = at(first, i, rule.baslangic);
    const s = localToUtc(startWall, zone);
    if (s >= toMs) break;
    if (!rule.gunler.includes(isoWeekday(startWall))) continue;
    const e = localToUtc(at(first, i + (crossesMidnight ? 1 : 0), rule.bitis), zone);
    if (e > fromMs && e > s) out.push({ baslangic: msToIso(s), bitis: msToIso(e) });
  }
  return out;
}

// ── Etkin politika ve karar ─────────────────────────────────────────────────
export type UpdatePolicySource = "KIRA" | "VARSAYILAN";

/** Geçerli (süresi geçmemiş) kiranın politikası; kira yoksa ya da süresi geçtiyse `null` = yetki yok. */
export function effectiveUpdatePolicy(
  lease: LeaseDoc | null,
  nowMs: number,
): { readonly politika: LeaseUpdatePolicy; readonly kaynak: UpdatePolicySource } | null {
  if (!lease || nowMs > isoToMs(lease.bitis) + CLOCK_SKEW_MS) return null;
  return lease.guncelleme ? { politika: lease.guncelleme, kaynak: "KIRA" } : { politika: defaultUpdatePolicy(), kaynak: "VARSAYILAN" };
}

/** Kurulu PostgreSQL örneği: kendi (güncelleyici yönetir) ya da harici (dokunulmaz) — `pgsql/ornek.json` + `SHOW server_version`. */
export const PG_MODES = ["KENDI", "HARICI"] as const;
export type PgMode = (typeof PG_MODES)[number];
export interface InstalledPg {
  readonly kip: PgMode;
  readonly surum: string;
  /** Kendi kipte EDB derlemesi (zorunlu); harici kipte null. */
  readonly derleme: number | null;
}

/** Yerel onay (panel) — YETKİ DEĞİL: yalnız politikanın izin verdiği zamanlamayı tetikler, tek sürüme bağlıdır. */
export interface UpdateApproval {
  readonly surum: string;
  readonly zamanlama: ApprovalTiming;
}

export interface UpdateDecisionInput {
  /** `effectiveUpdatePolicy(...)?.politika`; null = geçerli kira yok. */
  readonly politika: LeaseUpdatePolicy | null;
  /** Kiranın `yaptirim.guncellemeDonuk`u (K1) — politikayı ezer. */
  readonly guncellemeDonuk: boolean;
  /** Doğrulanmış HAK'ın `bakimBitis`i (ms); null = HAK yok. */
  readonly bakimBitisMs: number | null;
  readonly kuruluSurum: string;
  /** Kurulu PostgreSQL (kip · `ana.küçük` · kendi kipte derleme); null = ölçülemedi. */
  readonly pg: InstalledPg | null;
  /** Doğrulanmış bildirim — sabitlemede SABİTLENEN sürümünki; null = aday yok. */
  readonly aday: ReleaseManifest | null;
  readonly onay: UpdateApproval | null;
  readonly nowMs: number;
}

export interface UpdateDecision {
  readonly karar: UpdateDecisionKind;
  readonly neden: UpdateDecisionReason | null;
  /** KUR: içinde bulunulan aralık (HEMEN onayında null) · PENCERE_BEKLIYOR: sıradaki aralık (yoksa null). */
  readonly aralik: UpdateInterval | null;
  /** Aday PostgreSQL küçük sürüm güncellemesini de ister (bildirimin `pg.paket`iyle). */
  readonly pgGuncellemesi: boolean;
}

function decision(karar: UpdateDecisionKind, neden: UpdateDecisionReason | null, aralik: UpdateInterval | null = null, pg = false): UpdateDecision {
  return { karar, neden, aralik, pgGuncellemesi: pg };
}

/**
 * PG uygunluğu (sözleşme sürümü 2): ana sürüm bildirimin çizgisi değilse ASLA (runbook); kendi örnekte hedef kuruludan
 * yeniyse küçük sürüm güncellemesi backend'den ÖNCE ayrı adımda; harici örneğe dokunulmaz, yalnız `enAz` denetlenir.
 */
function pgCheck(req: PgRequirement, installed: InstalledPg | null): UpdateDecision | "OK" | "GUNCELLE" {
  if (installed === null || !PgVersionSchema.safeParse(installed.surum).success || (installed.kip === "KENDI" && installed.derleme === null)) {
    return decision("UYGUN_DEGIL", "PG_OLCULEMEDI");
  }
  if (pgMajor(installed.surum) !== req.cizgi) return decision("UYGUN_DEGIL", "PG_ANA_SURUM");
  if (installed.kip === "KENDI" && req.hedef !== null && (comparePgVersions(req.hedef, installed) ?? 0) > 0) return "GUNCELLE";
  const atLeast = comparePgVersions({ surum: installed.surum, derleme: null }, { surum: req.enAz, derleme: null }) ?? -1;
  return atLeast >= 0 ? "OK" : decision("UYGUN_DEGIL", "PG_SURUMU_ESKI");
}

function timing(politika: LeaseUpdatePolicy, onay: UpdateApproval | null, nowMs: number, pg: boolean): UpdateDecision {
  if (onay?.zamanlama === "HEMEN") return decision("KUR", "ONAY_HEMEN", null, pg);
  if (politika.kip === "ONAYLI" && onay === null) return decision("ONAY_BEKLIYOR", null, null, pg);
  const current = politika.araliklar.find((a) => isoToMs(a.baslangic) <= nowMs && nowMs < isoToMs(a.bitis));
  if (current) return decision("KUR", "PENCERE", current, pg);
  const next = politika.araliklar.find((a) => isoToMs(a.baslangic) > nowMs) ?? null;
  return decision("PENCERE_BEKLIYOR", next ? null : "PENCERE_YOK", next, pg);
}

/**
 * Güncelleyicinin TEK karar noktası (SAF). Sıra: yetki (kira · K1 · DONDUR) → sürüm (sabitleme · aday ·
 * kaynak sınırı) → uygunluk (bakım · PostgreSQL) → zamanlama (onay · pencere). Onay yalnız aynı sürüme bağlanır.
 */
export function decideUpdate(g: UpdateDecisionInput): UpdateDecision {
  const p = g.politika;
  if (p === null) return decision("DONDURULDU", "KIRA_YOK");
  if (g.guncellemeDonuk) return decision("DONDURULDU", "YAPTIRIM");
  if (p.kip === "DONDUR") return decision("DONDURULDU", "POLITIKA");
  if (parseVersion(g.kuruluSurum) === null) return decision("UYGUN_DEGIL", "KURULU_SURUM_BICIMSIZ");
  if (p.hedefSurum !== null && (compareVersions(g.kuruluSurum, p.hedefSurum) ?? -1) >= 0) return decision("GUNCEL", "HEDEF_ULASILDI");
  const a = g.aday;
  if (a === null) return decision("GUNCEL", "ADAY_YOK");
  if ((compareVersions(a.surum, g.kuruluSurum) ?? 0) <= 0) return decision("GUNCEL", "SURUM_GUNCEL");
  if (p.hedefSurum !== null && compareVersions(a.surum, p.hedefSurum) !== 0) return decision("UYGUN_DEGIL", "HEDEF_DISI");
  if (a.minKaynakSurum !== null && (compareVersions(g.kuruluSurum, a.minKaynakSurum) ?? -1) < 0) return decision("UYGUN_DEGIL", "KAYNAK_SURUM_ESKI");
  if (g.bakimBitisMs === null) return decision("UYGUN_DEGIL", "HAK_YOK");
  if (isoToMs(a.derlemeTarihi) > g.bakimBitisMs) return decision("UYGUN_DEGIL", "BAKIM_DISI");
  const pg = pgCheck(a.pg, g.pg);
  if (typeof pg !== "string") return pg;
  const onay = g.onay !== null && compareVersions(g.onay.surum, a.surum) === 0 ? g.onay : null;
  return timing(p, onay, g.nowMs, pg === "GUNCELLE");
}

