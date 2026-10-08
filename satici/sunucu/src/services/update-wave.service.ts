// GÜNCELLEME DALGASI (F1a — docs/design/GUNCELLEYICI-SAGLAMLIK.md §6.2): grup İÇİNDE kademeli backend yayılımı,
// güncelleyiciye ve tel sözleşmesine DOKUNMADAN — kira basılırken `guncelleme.hedefSurum` = min(insanın sabitlemesi,
// dalga tavanı). Aşamayı yalnız İNSAN değiştirir (AK-2, TK-13): otomatik ilerletme/durdurma YAZILMAZ; eşik aşılınca
// UYARI gider, tavan değişmez. Üyelik (kova + "en az bir kurulum") TEK yüklemde: kira, sayaç ve zil aynı cevabı okur.
import { createHash } from "node:crypto";
import type { GuncellemeDalgasi, GuncellemeDalgasiKaydi, Prisma } from "@prisma/client";
import { z } from "zod";
import { ReleaseVersionSchema, VersionTextSchema, compareVersions } from "../lisans-protokol";
import { VendorError, badRequest, notFoundError, stateConflict } from "../lib/errors";
import { lockUpdateWave } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import { isUniqueViolation } from "../lib/prisma-errors";
import { channelVersionsForLease } from "./channel.service";
import { notifyDoorbell } from "./doorbell";
import { requireReason } from "./sanction.service";
import { UPDATE_RESULT_EVENTS } from "./update-policy.service";

/** Dalgalı gruplar: öncü/test gruplarında dalga yok (§6.2) — başka grupta dalga açmak 400 (fail-closed). */
export const WAVE_GROUPS = ["genel"] as const;
/** Aşama → kova eşiği (kova < eşik ⇒ dalgada): 0 durdu · 1 %10 · 2 %50 · 3 hepsi. */
export const WAVE_STAGE_THRESHOLDS = [0, 10, 50, 100] as const;
export const WAVE_MAX_STAGE = WAVE_STAGE_THRESHOLDS.length - 1;
/** Eşik uyarısı: GERI_DONDU + BASARISIZ ≥ 2 kurulum ya da ≥ %10 (durdurmaz). */
export const WAVE_ALERT_MIN_COUNT = 2;
export const WAVE_ALERT_MIN_PERCENT = 10;
/** Aşamadaki kurulumların bu oranından azı sonuç bildirmişse ilerletme ek onay ister (engel değil). */
export const WAVE_REPORTED_MIN_PERCENT = 80;

export const WAVE_EVENTS = { ACILDI: "DALGA_ACILDI", ILERLETILDI: "ASAMA_ILERLETILDI", GERI_CEKILDI: "ASAMA_GERI_CEKILDI" } as const;

/** Sayaç ve uyarı kümesi: grubun aktif, etkinleşmiş kurulumları (etkinleşmemiş kurulum sonuç bildiremez). */
const WAVE_ELIGIBLE_STATES = ["ETKIN", "DEVREDILDI"] as const;

export interface WaveInstallation {
  readonly id: string;
  /** Lisans kimliği — kova bundan türer (satıcının satır kimliğinden değil; taşıma/DR'de değişmez). */
  readonly kurulumId: string;
}

/** Kurulumun kovası (0–99): lisans kimliğinin özetinden, sürümden bağımsız (aynı kurulumlar hep öncü kanaryadır). */
export function waveBucket(kurulumId: string): number {
  return createHash("sha256").update(`tekserp-dalga.v1:${kurulumId}`, "utf8").digest().readUInt32BE(0) % 100;
}

/**
 * Dalga üyeliği — TEK yüklem. Kova < eşik ise dalgada; aşama ≥ 1 iken eşiğin altında HİÇ kurulum yoksa en küçük
 * (kova, lisans kimliği) sıralı tek kurulum da dalgadadır (küçük grupta "en az bir kurulum"). `eligible` grubun uygun
 * kümesidir; küme dışındaki kurulum (ör. etkinleşmekte) yalnız kovasıyla değerlendirilir.
 */
export function isWaveMember(inst: WaveInstallation, stage: number, eligible: readonly WaveInstallation[]): boolean {
  if (stage <= 0) return false;
  const threshold = WAVE_STAGE_THRESHOLDS[Math.min(stage, WAVE_MAX_STAGE)];
  if (waveBucket(inst.kurulumId) < threshold) return true;
  let first: { b: number; k: string; id: string } | null = null;
  for (const e of eligible) {
    const b = waveBucket(e.kurulumId);
    if (b < threshold) return false;
    if (!first || b < first.b || (b === first.b && e.kurulumId < first.k)) first = { b, k: e.kurulumId, id: e.id };
  }
  return first !== null && first.id === inst.id;
}

/** Kurulumun dalgaya GİRDİĞİ aşama (1–3): yüklemin ilk doğru verdiği aşama. */
export function entryStage(inst: WaveInstallation, eligible: readonly WaveInstallation[]): number {
  for (let s = 1; s <= WAVE_MAX_STAGE; s++) if (isWaveMember(inst, s, eligible)) return s;
  return WAVE_MAX_STAGE;
}

/** Dalganın kuruluma koyduğu tavan: dalgadaysa dalganın sürümü, değilse grubun yerleşik (önceki) sürümü. */
export function waveCeiling(wave: Pick<GuncellemeDalgasi, "surum" | "oncekiSurum" | "asama">, inst: WaveInstallation, eligible: readonly WaveInstallation[]): string {
  return isWaveMember(inst, wave.asama, eligible) ? wave.surum : wave.oncekiSurum;
}

/** Grubun yürürlükteki dalgası: en yüksek sürümlü satır (açılış sırasından bağımsız, belirlenimli). */
export function currentWave<T extends Pick<GuncellemeDalgasi, "surum">>(waves: readonly T[]): T | null {
  let best: T | null = null;
  for (const w of waves) if (!best || (compareVersions(w.surum, best.surum) ?? 0) > 0) best = w;
  return best;
}

async function eligibleInstallations(db: Db, channelCode: string): Promise<WaveInstallation[]> {
  return db.kurulum.findMany({
    where: { kanalKodu: channelCode, aktif: true, durum: { in: [...WAVE_ELIGIBLE_STATES] } },
    select: { id: true, kurulumId: true },
    orderBy: { id: "asc" },
  });
}

export async function currentWaveOf(db: Db, channelCode: string): Promise<GuncellemeDalgasi | null> {
  return currentWave(await db.guncellemeDalgasi.findMany({ where: { kanalKodu: channelCode } }));
}

/** Kira basımı: kurulumun grubunda dalga yoksa tavan YOK (bugünkü davranış); varsa yürürlükteki dalganın tavanı. */
export async function waveCeilingFor(db: Db, inst: WaveInstallation & { kanalKodu: string }): Promise<string | null> {
  const wave = await currentWaveOf(db, inst.kanalKodu);
  if (!wave) return null;
  return waveCeiling(wave, inst, await eligibleInstallations(db, inst.kanalKodu));
}

// ── Sonuç sayaçları ──────────────────────────────────────────────────────────

export const WAVE_RESULTS = ["TAMAMLANDI", "GERI_DONDU", "BASARISIZ", "BEKLIYOR"] as const;
export type WaveResult = (typeof WAVE_RESULTS)[number];
const RESULT_OF_EVENT: Readonly<Record<string, WaveResult>> = {
  [UPDATE_RESULT_EVENTS.BASARILI]: "TAMAMLANDI",
  [UPDATE_RESULT_EVENTS.GERI_DONDU]: "GERI_DONDU",
  [UPDATE_RESULT_EVENTS.BASARISIZ]: "BASARISIZ",
};

export interface WaveMemberRow {
  readonly id: string;
  readonly kurulumId: string;
  readonly kova: number;
  readonly girisAsamasi: number;
  readonly dalgada: boolean;
  readonly kuruluSurum: string | null;
  readonly sonuc: WaveResult;
  /** Sonucun kaynağı: defterdeki tamamlanan deneme · yoklamanın kurulu sürümü · yok. */
  readonly kaynak: "DEFTER" | "YOKLAMA" | null;
}

export type ResultCounts = Record<WaveResult, number> & { kurulum: number };

export interface WaveTally {
  readonly asamalar: readonly ({ asama: number } & ResultCounts)[];
  /** Şu an dalgadaki kurulumlar. */
  readonly dalgada: ResultCounts;
  /** GERI_DONDU + BASARISIZ (gruptaki bütün uygun kurulumlar). */
  readonly hata: number;
  readonly uyariAcik: boolean;
  /** Dalgadakilerin sonuç bildirme oranı (%); dalga boşsa null. */
  readonly bildirimYuzdesi: number | null;
  readonly ilerletmeEkOnayIster: boolean;
}

const emptyCounts = (): ResultCounts => ({ kurulum: 0, TAMAMLANDI: 0, GERI_DONDU: 0, BASARISIZ: 0, BEKLIYOR: 0 });

function versionText(v: unknown): string | null {
  return typeof v === "string" && VersionTextSchema.safeParse(v).success ? v : null;
}

/** Kurulum başına sonuç: dalganın sürümüne ait EN SON tamamlanan deneme; yoksa yoklamanın kurulu sürümü ≥ dalga ⇒ tamam. */
export async function waveMembers(db: Db, wave: Pick<GuncellemeDalgasi, "kanalKodu" | "surum" | "asama">): Promise<WaveMemberRow[]> {
  const rows = await db.kurulum.findMany({
    where: { kanalKodu: wave.kanalKodu, aktif: true, durum: { in: [...WAVE_ELIGIBLE_STATES] } },
    select: { id: true, kurulumId: true, sonOrtam: true },
    orderBy: { id: "asc" },
  });
  const eligible = rows.map((r) => ({ id: r.id, kurulumId: r.kurulumId }));
  const events = await db.kurulumKaydi.findMany({
    where: { kurulumId: { in: rows.map((r) => r.id) }, olay: { in: Object.keys(RESULT_OF_EVENT) }, ayrinti: { path: ["hedefSurum"], equals: wave.surum } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    distinct: ["kurulumId"],
    select: { kurulumId: true, olay: true },
  });
  const latest = new Map(events.map((e) => [e.kurulumId, RESULT_OF_EVENT[e.olay]]));
  return rows
    .map((r) => {
      const installed = versionText((r.sonOrtam as { uygulamaSurum?: unknown } | null)?.uygulamaSurum);
      const fromLedger = latest.get(r.id) ?? null;
      const reached = installed !== null && (compareVersions(installed, wave.surum) ?? -1) >= 0;
      const sonuc: WaveResult = fromLedger ?? (reached ? "TAMAMLANDI" : "BEKLIYOR");
      return {
        id: r.id,
        kurulumId: r.kurulumId,
        kova: waveBucket(r.kurulumId),
        girisAsamasi: entryStage(r, eligible),
        dalgada: isWaveMember(r, wave.asama, eligible),
        kuruluSurum: installed,
        sonuc,
        kaynak: fromLedger ? ("DEFTER" as const) : reached ? ("YOKLAMA" as const) : null,
      };
    })
    .sort((a, b) => a.girisAsamasi - b.girisAsamasi || a.kova - b.kova || (a.kurulumId < b.kurulumId ? -1 : 1));
}

/** Sayaçlar + uyarı + ek onay gereği (SAF): aynı üye listesinden. */
export function tallyWave(members: readonly WaveMemberRow[]): WaveTally {
  const stages = [1, 2, 3].map((asama) => ({ asama, ...emptyCounts() }));
  const inWave = emptyCounts();
  let hata = 0;
  let denominator = 0;
  for (const m of members) {
    const s = stages[m.girisAsamasi - 1];
    s.kurulum++;
    s[m.sonuc]++;
    const failed = m.sonuc === "GERI_DONDU" || m.sonuc === "BASARISIZ";
    if (failed) hata++;
    if (m.dalgada) {
      inWave.kurulum++;
      inWave[m.sonuc]++;
    }
    if (m.dalgada || m.sonuc !== "BEKLIYOR") denominator++;
  }
  const uyariAcik = hata > 0 && (hata >= WAVE_ALERT_MIN_COUNT || hata * 100 >= WAVE_ALERT_MIN_PERCENT * denominator);
  const reported = inWave.kurulum - inWave.BEKLIYOR;
  const bildirimYuzdesi = inWave.kurulum === 0 ? null : Math.floor((reported * 100) / inWave.kurulum);
  const lowReporting = inWave.kurulum > 0 && reported * 100 < WAVE_REPORTED_MIN_PERCENT * inWave.kurulum;
  return { asamalar: stages, dalgada: inWave, hata, uyariAcik, bildirimYuzdesi, ilerletmeEkOnayIster: uyariAcik || lowReporting };
}

// ── Portal eylemleri (kilit: işlem kimliği → UPDATE_WAVE) ────────────────────

export const WaveOpenSchema = z.strictObject({
  kanalKodu: z.string().min(1).max(40),
  surum: ReleaseVersionSchema,
  oncekiSurum: ReleaseVersionSchema.nullable().optional(),
});

function requireWaveGroup(code: string): void {
  if (!(WAVE_GROUPS as readonly string[]).includes(code)) {
    throw badRequest(`Dalga yalnız şu gruplarda açılır: ${WAVE_GROUPS.join(" · ")} (öncü/test grupları dalgasızdır)`);
  }
}

function summaryOf(t: WaveTally): Prisma.InputJsonObject {
  return { dalgada: { ...t.dalgada }, hata: t.hata, uyariAcik: t.uyariAcik, bildirimYuzdesi: t.bildirimYuzdesi };
}

async function ringGroup(tx: Tx, ids: readonly string[]): Promise<void> {
  for (const id of ids) await notifyDoorbell(tx, id, "guncelleme");
}

/**
 * Dalga AÇAR (aşama 0 = durdu): yerleşik sürüm verilmezse grubun yürürlükteki dalgasından (tamamlanmışsa onun sürümü,
 * değilse onun yerleşik sürümü), dalga yoksa grubun kayıtlı backend sürümünden türer; verilen değer bunu AŞAMAZ.
 * Açılış gruptaki bütün kurulumların tavanını değiştirebilir → hepsine zil.
 */
export async function openWaveTx(
  tx: Tx,
  g: { channelCode: string; version: string; previousVersion?: string | null; reason: string; actor: string },
): Promise<GuncellemeDalgasi> {
  await lockUpdateWave(tx, g.channelCode);
  const reason = requireReason(g.reason, "Dalga açmak");
  requireWaveGroup(g.channelCode);
  const channel = await tx.kanal.findUnique({ where: { kod: g.channelCode } });
  if (!channel || !channel.aktif) throw badRequest(`Güncelleme grubu kayıtlı ya da aktif değil: ${g.channelCode}`);
  const waves = await tx.guncellemeDalgasi.findMany({ where: { kanalKodu: g.channelCode } });
  if (waves.some((w) => w.surum === g.version)) throw stateConflict(`Bu sürümün dalgası zaten var: ${g.channelCode} · ${g.version}`);
  const current = currentWave(waves);
  if (current && (compareVersions(g.version, current.surum) ?? -1) <= 0) {
    throw stateConflict(`Yeni dalganın sürümü yürürlükteki dalganınkinden (${current.surum}) büyük olmalı`);
  }
  const settled = current ? (current.asama === WAVE_MAX_STAGE ? current.surum : current.oncekiSurum) : (channelVersionsForLease(channel).backend ?? null);
  const settledOk = settled !== null && ReleaseVersionSchema.safeParse(settled).success ? settled : null;
  const previous = g.previousVersion ?? settledOk;
  if (previous === null) throw badRequest("Grubun yerleşik sürümü bilinmiyor: önceki sürümü yazın");
  if ((compareVersions(previous, g.version) ?? 0) >= 0) throw badRequest("Önceki sürüm dalganın sürümünden küçük olmalı");
  if (settledOk !== null && (compareVersions(previous, settledOk) ?? 1) > 0) {
    throw badRequest(`Önceki sürüm grubun yerleşik sürümünü (${settledOk}) aşamaz — dalgasız sürüm yayılmaz`);
  }
  let wave: GuncellemeDalgasi;
  try {
    wave = await tx.guncellemeDalgasi.create({ data: { kanalKodu: g.channelCode, surum: g.version, oncekiSurum: previous, asama: 0 } });
  } catch (err) {
    if (isUniqueViolation(err)) throw stateConflict(`Bu sürümün dalgası zaten var: ${g.channelCode} · ${g.version}`);
    throw err;
  }
  await tx.guncellemeDalgasiKaydi.create({
    data: { dalgaId: wave.id, olay: WAVE_EVENTS.ACILDI, oncekiAsama: null, yeniAsama: 0, sebep: reason, ayrinti: { oncekiDalga: current?.id ?? null }, yapan: g.actor },
  });
  await ringGroup(tx, (await eligibleInstallations(tx, g.channelCode)).map((i) => i.id));
  return wave;
}

export interface StageChangeResult {
  readonly dalga: GuncellemeDalgasi;
  readonly kayit: GuncellemeDalgasiKaydi;
  readonly zil: number;
}

async function changeStageTx(
  tx: Tx,
  g: { waveId: string; expectedStage: number; nextStage: number; reason: string; actor: string; event: string; confirmed: boolean; tally: WaveTally | null },
  eligible: readonly WaveInstallation[],
): Promise<StageChangeResult> {
  // Atomik claim: beklenen aşamadan başka bir yerdeyse (eşzamanlı başka karar) 409 — ikinci karar sessizce üst üste binmez.
  const claimed = await tx.guncellemeDalgasi.updateMany({ where: { id: g.waveId, asama: g.expectedStage }, data: { asama: g.nextStage } });
  if (claimed.count === 0) {
    const fresh = await tx.guncellemeDalgasi.findUnique({ where: { id: g.waveId }, select: { asama: true } });
    if (!fresh) throw notFoundError("Güncelleme dalgası");
    throw stateConflict(`Dalganın aşaması değişmiş (şimdi ${fresh.asama}); sayfayı yenileyip yeniden karar verin`);
  }
  const dalga = await tx.guncellemeDalgasi.findUniqueOrThrow({ where: { id: g.waveId } });
  const kayit = await tx.guncellemeDalgasiKaydi.create({
    data: {
      dalgaId: dalga.id,
      olay: g.event,
      oncekiAsama: g.expectedStage,
      yeniAsama: g.nextStage,
      sebep: g.reason,
      ekOnay: g.confirmed,
      ayrinti: g.tally ? summaryOf(g.tally) : undefined,
      yapan: g.actor,
    },
  });
  // Zil yalnız tavanı DEĞİŞEN kurulumlara (aşama sınırını geçenler) — grubun tamamına sürü yoklaması doğurmaz.
  const changed = eligible.filter((i) => isWaveMember(i, g.expectedStage, eligible) !== isWaveMember(i, g.nextStage, eligible)).map((i) => i.id);
  await ringGroup(tx, changed);
  return { dalga, kayit, zil: changed.length };
}

/** Kilit altında taze okuma: beklenen aşamada değilse ek onay/ölçü sorulmadan 409 (karar bayat ekrana dayanıyor). */
async function waveForChange(tx: Tx, waveId: string, expectedStage: number): Promise<GuncellemeDalgasi> {
  const w = await tx.guncellemeDalgasi.findUnique({ where: { id: waveId } });
  if (!w) throw notFoundError("Güncelleme dalgası");
  if (w.asama !== expectedStage) throw stateConflict(`Dalganın aşaması değişmiş (şimdi ${w.asama}); sayfayı yenileyip yeniden karar verin`);
  return w;
}

function requireStage(n: number, what: string): number {
  if (!Number.isInteger(n) || n < 0 || n > WAVE_MAX_STAGE) throw badRequest(`${what} 0–${WAVE_MAX_STAGE} arası tam sayı olmalı`);
  return n;
}

/**
 * Sonraki aşamaya geçer (TEK adım). Uyarı açıkken ya da dalgadakilerin %80'inden azı sonuç bildirmişken `onay: true`
 * ister (400 IKINCI_ONAY_GEREKLI — engel değil, uyarı); kararın anındaki ölçü deftere donar.
 */
export async function advanceWaveTx(
  tx: Tx,
  g: { waveId: string; expectedStage: number; reason: string; actor: string; confirmed: boolean },
): Promise<StageChangeResult & { sayac: WaveTally }> {
  // Kilit anahtarı (grup) dalganın DEĞİŞMEZ kolonundan; kilitten önce tx'e okuma girmesin diye tx dışında okunur.
  const head = await prisma.guncellemeDalgasi.findUnique({ where: { id: g.waveId }, select: { kanalKodu: true } });
  if (!head) throw notFoundError("Güncelleme dalgası");
  await lockUpdateWave(tx, head.kanalKodu);
  const reason = requireReason(g.reason, "Aşamayı ilerletmek");
  const expected = requireStage(g.expectedStage, "Beklenen aşama");
  if (expected >= WAVE_MAX_STAGE) throw stateConflict("Dalga zaten son aşamada (hepsi)");
  const wave = await waveForChange(tx, g.waveId, expected);
  const tally = tallyWave(await waveMembers(tx, wave));
  if (tally.ilerletmeEkOnayIster && !g.confirmed) {
    const why = tally.uyariAcik ? `uyarı açık (${tally.hata} kurulum geri döndü/başarısız)` : `aşamadakilerin yalnız %${tally.bildirimYuzdesi ?? 0}'i sonuç bildirdi`;
    throw new VendorError(400, "IKINCI_ONAY_GEREKLI", `Sonraki aşamaya geçmek ek onay ister: ${why}. Gerekçeyi yazıp onaylayın`);
  }
  const eligible = await eligibleInstallations(tx, wave.kanalKodu);
  const r = await changeStageTx(tx, { ...g, reason, expectedStage: expected, nextStage: expected + 1, event: WAVE_EVENTS.ILERLETILDI, confirmed: g.confirmed && tally.ilerletmeEkOnayIster, tally }, eligible);
  return { ...r, sayac: tally };
}

/** Aşamayı geri çeker (varsayılan bir adım; `hedefAsama` 0 = durdur). Başlamış işlemi durdurmaz, güncellenmişe dokunmaz. */
export async function retreatWaveTx(
  tx: Tx,
  g: { waveId: string; expectedStage: number; targetStage?: number; reason: string; actor: string },
): Promise<StageChangeResult> {
  // Kilit anahtarı (grup) dalganın DEĞİŞMEZ kolonundan; kilitten önce tx'e okuma girmesin diye tx dışında okunur.
  const head = await prisma.guncellemeDalgasi.findUnique({ where: { id: g.waveId }, select: { kanalKodu: true } });
  if (!head) throw notFoundError("Güncelleme dalgası");
  await lockUpdateWave(tx, head.kanalKodu);
  const reason = requireReason(g.reason, "Aşamayı geri çekmek");
  const expected = requireStage(g.expectedStage, "Beklenen aşama");
  if (expected === 0) throw stateConflict("Dalga zaten durdu (aşama 0)");
  const target = g.targetStage === undefined ? expected - 1 : requireStage(g.targetStage, "Hedef aşama");
  if (target >= expected) throw badRequest("Hedef aşama şimdikinden küçük olmalı");
  const wave = await waveForChange(tx, g.waveId, expected);
  const tally = tallyWave(await waveMembers(tx, wave));
  const eligible = await eligibleInstallations(tx, wave.kanalKodu);
  return changeStageTx(tx, { waveId: g.waveId, expectedStage: expected, nextStage: target, reason, actor: g.actor, event: WAVE_EVENTS.GERI_CEKILDI, confirmed: false, tally }, eligible);
}
