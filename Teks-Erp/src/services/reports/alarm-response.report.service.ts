// =============================================================================
// DOKUMA · MÜDAHALE / ÇÖZÜM SÜRESİ RAPORU (B4) — tezgah alarmı defterini okuyan ilk rapor
// =============================================================================
// Sayılar ALARM DEFTERİNDEN (`LoomAlarmEvent`) ve kapanışta DONAN alanlardan (`closedAt`, `k2DueAt`) —
// SystemLog'dan değil (DOKUMA-ALARM-VE-YOL-HARITASI §A.3: "rapor bunu okur, yeniden hesaplamaz").
//   • Doğuş (t0)       = ilk RAISED/TIER_SKIPPED olayı (kronoloji `createdAt` + `id` eşitlik bozucu).
//   • Üstlenme süresi  = ilk ACK olayı − t0 (sonradan bırakılsa da müdahale o an başladı).
//   • Çözüm süresi     = RESOLVED alarmın donmuş kapanış anı (`closedAt` = duruşun bitişi) − t0. RESOLVED
//                        olayının `createdAt`i motor turu kadar gecikir; çözüm anı o değildir.
//   • Hedef aşımı      = çözüm hedefi K2 vadesidir (hedef + pay): K2 çaldı ∨ çözüm (canlıda şimdi) > `k2DueAt`.
//                        Sonucu henüz belli olmayan canlı alarm, plansız (k2 yok) alarm ve İPTAL paydaya
//                        GİRMEZ ama sayısı basılır (OTIF terminsiz emsali).
// Kırılımlar: sebep (duruşun güncel sebebi — Pareto ile aynı) · hol (tezgahın istasyonu) · vardiya (t0'ı
// kapsayan canlı vardiyanın tanımı; yoksa "Vardiyasız") · tezgah · kişi (ilk üstlenen; YALNIZ yetkili istekte).
// Pencere fabrika günüdür (`factoryDayStartOfKey`/`factoryDayEndOfKey` — dilim tek kaynak `constants/time.ts`).
// =============================================================================
import { LoomAlarmEventKind, LoomAlarmState } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDayEndOfKey, factoryDayStartOfKey } from "../../constants/time";
import { AppError } from "../../utils/app-error";
import { readDbNow } from "../helpers/machine-run-open.helper";
import { loadNamedShiftWindows, shiftCoveringAt } from "../helpers/loom-alarm-shift.helper";
import { reasonLabels } from "../loom-alarm-read.service";
import { capReportLists, type DateRange } from "./_shared";

/** Tek alarmın rapora giren gerçekleri (saf toplayıcının girdisi — bekçi bunu doğrudan besler). */
export interface AlarmResponseFact {
  t0: Date;
  ackAt: Date | null;
  state: LoomAlarmState;
  closedAt: Date | null;
  k2DueAt: Date | null;
  k2Rang: boolean;
  keys: { sebep: string | null; hol: string; vardiya: string | null; tezgah: string; kisi: string | null };
}

export interface AlarmResponseCell {
  /** İptal dışı alarm sayısı (ölçülerin evreni). */
  alarm: number;
  iptal: number;
  ustlenilen: number;
  /** Ortalama üstlenme süresi (sn) — üstlenilmiş alarmlar; yoksa null. */
  ustlenmeOrtSn: number | null;
  cozulen: number;
  /** Ortalama çözüm süresi (sn) — çözülmüş alarmlar; yoksa null. */
  cozumOrtSn: number | null;
  asim: number;
  zamaninda: number;
  /** Canlı ve K2 vadesi henüz gelmemiş — sonucu belli değil. */
  belirsiz: number;
  /** Çözüm hedefi (K2 vadesi) olmayan alarm (sebep hedefsiz bir sebebe çevrildi). */
  hedefsiz: number;
  /** asim / (asim + zamaninda) × 100, 1 hane; payda 0 → null. */
  asimOraniPct: number | null;
}

export interface AlarmResponseRow extends AlarmResponseCell { anahtar: string | null; etiket: string }

export interface AlarmResponseReport {
  ozet: AlarmResponseCell;
  sebepler: AlarmResponseRow[];
  holler: AlarmResponseRow[];
  vardiyalar: AlarmResponseRow[];
  tezgahlar: AlarmResponseRow[];
  /** Yalnız `loom:alarm-escalation` sahibinin isteğinde; yetkisizde anahtar YOK. */
  kisiler?: AlarmResponseRow[];
  kisiKirilimi: boolean;
}

export type AlarmResponseAxis = keyof AlarmResponseFact["keys"];

interface Acc { alarm: number; iptal: number; ackN: number; ackSec: number; solN: number; solSec: number; asim: number; zamaninda: number; belirsiz: number; hedefsiz: number }
const emptyAcc = (): Acc => ({ alarm: 0, iptal: 0, ackN: 0, ackSec: 0, solN: 0, solSec: 0, asim: 0, zamaninda: 0, belirsiz: 0, hedefsiz: 0 });
const secBetween = (a: Date, b: Date): number => Math.max(0, (b.getTime() - a.getTime()) / 1000);

/** Hedef sonucu — tek yüklem (özet ve her kırılım aynı karardan). */
export function alarmTargetOutcome(f: Pick<AlarmResponseFact, "state" | "closedAt" | "k2DueAt" | "k2Rang">, now: Date): "asim" | "zamaninda" | "belirsiz" | "hedefsiz" {
  if (f.k2Rang) return "asim";
  if (f.k2DueAt === null) return "hedefsiz";
  if (f.state === LoomAlarmState.RESOLVED && f.closedAt !== null) return f.closedAt.getTime() > f.k2DueAt.getTime() ? "asim" : "zamaninda";
  return now.getTime() > f.k2DueAt.getTime() ? "asim" : "belirsiz";
}

function add(acc: Acc, f: AlarmResponseFact, now: Date): void {
  if (f.state === LoomAlarmState.CANCELLED) { acc.iptal += 1; return; }
  acc.alarm += 1;
  if (f.ackAt) { acc.ackN += 1; acc.ackSec += secBetween(f.t0, f.ackAt); }
  if (f.state === LoomAlarmState.RESOLVED && f.closedAt) { acc.solN += 1; acc.solSec += secBetween(f.t0, f.closedAt); }
  acc[alarmTargetOutcome(f, now)] += 1;
}

function cellOf(a: Acc): AlarmResponseCell {
  const known = a.asim + a.zamaninda;
  return {
    alarm: a.alarm, iptal: a.iptal,
    ustlenilen: a.ackN, ustlenmeOrtSn: a.ackN > 0 ? Math.round(a.ackSec / a.ackN) : null,
    cozulen: a.solN, cozumOrtSn: a.solN > 0 ? Math.round(a.solSec / a.solN) : null,
    asim: a.asim, zamaninda: a.zamaninda, belirsiz: a.belirsiz, hedefsiz: a.hedefsiz,
    asimOraniPct: known > 0 ? Math.round((a.asim / known) * 1000) / 10 : null,
  };
}

/** Saf toplayıcı: özet tam kümeden, her eksen kendi anahtarıyla; satırlar alarm sayısına göre azalan. */
export function aggregateAlarmResponse(
  facts: ReadonlyArray<AlarmResponseFact>, now: Date, labelOf: (axis: AlarmResponseAxis, key: string | null) => string, axes: ReadonlyArray<AlarmResponseAxis>,
): { ozet: AlarmResponseCell; byAxis: Map<AlarmResponseAxis, AlarmResponseRow[]> } {
  const total = emptyAcc();
  const maps = new Map(axes.map((ax) => [ax, new Map<string | null, Acc>()]));
  for (const f of facts) {
    add(total, f, now);
    for (const [ax, m] of maps) {
      const k = f.keys[ax];
      const acc = m.get(k) ?? emptyAcc();
      add(acc, f, now);
      m.set(k, acc);
    }
  }
  const byAxis = new Map<AlarmResponseAxis, AlarmResponseRow[]>();
  for (const [ax, m] of maps) {
    const rows = [...m].map(([k, acc]) => ({ anahtar: k, etiket: labelOf(ax, k), ...cellOf(acc) }));
    rows.sort((a, b) => b.alarm - a.alarm || b.iptal - a.iptal || a.etiket.localeCompare(b.etiket, "tr"));
    byAxis.set(ax, rows);
  }
  return { ozet: cellOf(total), byAxis };
}

const RAISE_KINDS: LoomAlarmEventKind[] = [LoomAlarmEventKind.RAISED, LoomAlarmEventKind.TIER_SKIPPED];

/** Fabrika günü aralığı → mutlak pencere; ters/bozuk aralık 400 (fail-closed). */
export function alarmResponseWindow(from: string, to: string): DateRange {
  const range = { from: factoryDayStartOfKey(from), to: factoryDayEndOfKey(to) };
  if (Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime()) || range.from > range.to) {
    throw AppError.badRequest("Geçersiz tarih aralığı", { code: "INVALID_RANGE" });
  }
  return range;
}

/** `shiftDefinitionIds` (R0-RAPC): yalnız doğuş anı o vardiyalara düşen alarmlar; yoksa davranış aynen. */
export async function alarmResponseReport(p: { from: string; to: string; withPeople: boolean; shiftDefinitionIds?: readonly string[] }): Promise<{ data: AlarmResponseReport; range: DateRange; warnings: string[] }> {
  const range = alarmResponseWindow(p.from, p.to);
  // Penceredeki doğuş olayı olan alarmlar; t0 (İLK doğuş olayı) aşağıda kesinleşir — K2'si pencereye düşen eski alarm elenir.
  const rows = await prisma.loomAlarm.findMany({
    where: { events: { some: { kind: { in: RAISE_KINDS }, createdAt: { gte: range.from, lte: range.to } } } },
    select: {
      id: true, state: true, closedAt: true, k2DueAt: true, machineId: true,
      machine: { select: { code: true, name: true, station: { select: { id: true, name: true } } } },
      stopEvent: { select: { reasonCode: true } },
      events: {
        where: { kind: { in: [...RAISE_KINDS, LoomAlarmEventKind.ACK] } },
        select: { kind: true, tier: true, userId: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  const now = await readDbNow();
  const pre = rows.flatMap((r) => {
    const raise = r.events.filter((e) => RAISE_KINDS.includes(e.kind));
    const t0 = raise[0]?.createdAt;
    if (!t0 || t0 < range.from || t0 > range.to) return [];
    const ack = r.events.find((e) => e.kind === LoomAlarmEventKind.ACK) ?? null;
    return [{ r, t0, ack, k2Rang: raise.some((e) => e.kind === LoomAlarmEventKind.RAISED && e.tier === 2) }];
  });
  const shifts = pre.length > 0
    ? await loadNamedShiftWindows(prisma, new Date(Math.min(...pre.map((x) => x.t0.getTime()))), new Date(Math.max(...pre.map((x) => x.t0.getTime()))))
    : [];
  const shiftSet = p.shiftDefinitionIds ? new Set(p.shiftDefinitionIds) : null;
  const facts: AlarmResponseFact[] = pre.map(({ r, t0, ack, k2Rang }) => ({
    t0, ackAt: ack?.createdAt ?? null, state: r.state, closedAt: r.closedAt, k2DueAt: r.k2DueAt, k2Rang,
    keys: { sebep: r.stopEvent.reasonCode, hol: r.machine.station.id, vardiya: shiftCoveringAt(shifts, t0)?.shiftDefinitionId ?? null, tezgah: r.machineId, kisi: ack?.userId ?? null },
  })).filter((f) => !shiftSet || (f.keys.vardiya !== null && shiftSet.has(f.keys.vardiya)));

  const sebepAd = await reasonLabels(facts.map((f) => f.keys.sebep));
  const holAd = new Map(pre.map(({ r }) => [r.machine.station.id, r.machine.station.name]));
  const tezgahAd = new Map(pre.map(({ r }) => [r.machineId, `${r.machine.code} · ${r.machine.name}`]));
  const vardiyaAd = new Map(shifts.map((s) => [s.shiftDefinitionId, s.name]));
  const kisiIds = [...new Set(facts.map((f) => f.keys.kisi).filter((k): k is string => k !== null))];
  const kisiAd = p.withPeople && kisiIds.length > 0
    ? new Map((await prisma.user.findMany({ where: { id: { in: kisiIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]))
    : new Map<string, string>();
  const labelOf = (ax: AlarmResponseAxis, k: string | null): string => {
    if (ax === "sebep") return k === null ? "Sebepsiz" : (sebepAd.get(k) ?? k);
    if (ax === "vardiya") return k === null ? "Vardiyasız" : (vardiyaAd.get(k) ?? "Vardiya");
    if (ax === "kisi") return k === null ? "Üstlenilmedi" : (kisiAd.get(k) ?? "Bilinmeyen kullanıcı");
    if (ax === "hol") return holAd.get(k ?? "") ?? "—";
    return tezgahAd.get(k ?? "") ?? "—";
  };
  const axes: AlarmResponseAxis[] = p.withPeople ? ["sebep", "hol", "vardiya", "tezgah", "kisi"] : ["sebep", "hol", "vardiya", "tezgah"];
  const { ozet, byAxis } = aggregateAlarmResponse(facts, now, labelOf, axes);
  const full: AlarmResponseReport = {
    ozet, sebepler: byAxis.get("sebep")!, holler: byAxis.get("hol")!, vardiyalar: byAxis.get("vardiya")!, tezgahlar: byAxis.get("tezgah")!,
    ...(p.withPeople ? { kisiler: byAxis.get("kisi")! } : {}), kisiKirilimi: p.withPeople,
  };
  const { data, warnings } = capReportLists(full, [["sebepler", "Sebep kırılımı"], ["holler", "Hol kırılımı"], ["vardiyalar", "Vardiya kırılımı"], ["tezgahlar", "Tezgah kırılımı"], ["kisiler", "Kişi kırılımı"]]);
  return { data, range, warnings };
}
