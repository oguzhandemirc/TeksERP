// =============================================================================
// PATRON RAPOR KOŞUMU (V5a, 2026-11-13) — istek üzerine oluştur · sakla · son koşum · geçmiş
// =============================================================================
// Düzenli hesap YOK (kullanıcı kararı): "Oluştur" eşzamanlı hesaplar (bulutla AYNI boğaz `computeReportResult`,
// yeni sorgu yok), sonucu saklar, cevapta döner. Koşum SAHİBİNİNDİR: her okuma `userId` ile süzülür, yönetici
// istisnası yok. TELEMETRİ satırı (audit muaf, `scripts/lib/audit-muafiyeti.ts`); budama `budama.ts`.
// =============================================================================
import { gzipSync } from "node:zlib";
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { isReportSurfaced } from "../../constants/report-catalog";
import { computeReportResult, REPORT_TIMEOUT_MS } from "../../cloud-sync/report-requests";
import { MAX_COMPRESSED_BYTES } from "../../cloud-sync/wire";
import { stableStringify } from "../reports/semantik/onbellek";
import { tokenReplay } from "../helpers/token-replay.helper";
import { readPatronReportLimits } from "../system-setting/patron-rapor";
import { prunePatronReportRuns } from "./budama";
import { RUN_SELECT, toDetail, toRequest, type RunRowWithResult } from "./bicim";
import { assertReportOpen, assertReportPermission, hasReportPermission, patronReportOf, readableReportKeys, reportOpen, PATRON_REPORTS } from "./katalog";

export interface PatronReportUser {
  readonly userId: string;
  readonly permissions: readonly string[];
}

export interface CreateRunInput {
  readonly clientToken: string;
  readonly raporAnahtari: string;
  readonly parametreler: Record<string, unknown>;
}

const HOUR_MS = 60 * 60 * 1000;
/** Süreç ölünce `HESAPLANIYOR` kalan satır bu yaştan sonra `YARIM_KALDI` olur (zaman aşımının iki katı). */
export const STALE_RUN_MS = 2 * REPORT_TIMEOUT_MS;
/** Kullanıcı başına eşzamanlı TEK hesap — backend tek süreç olduğu için süreç içi küme yeter. */
const runningUsers = new Set<string>();
/** Bekçi sondası: zaman aşımı süresi (üretimde `REPORT_TIMEOUT_MS`). */
let timeoutMs = REPORT_TIMEOUT_MS;
export function setPatronReportTimeoutForTest(ms: number | null): void {
  timeoutMs = ms ?? REPORT_TIMEOUT_MS;
}

const DETAIL_SELECT = { ...RUN_SELECT, result: true } satisfies Prisma.PatronReportRunSelect;

function runReplay(user: PatronReportUser, input: CreateRunInput) {
  return tokenReplay<RunRowWithResult, ReturnType<typeof toDetail>>({
    find: (db, clientToken) => db.patronReportRun.findUnique({ where: { clientToken }, select: DETAIL_SELECT }),
    alive: (prior) => {
      if (prior.deletedAt) throw AppError.conflict("Bu rapor koşumu silinmiş; yeniden oluşturun.", { code: "RAPOR_KOSUMU_SILINMIS" });
    },
    identity: (p) => [
      { ad: "kullanici", mevcut: p.userId, gelen: user.userId },
      { ad: "raporAnahtari", mevcut: p.reportKey, gelen: input.raporAnahtari },
      { ad: "parametreler", mevcut: stableStringify(p.params), gelen: stableStringify(input.parametreler) },
    ],
    collision: "Bu işlem kimliği başka bir rapor koşumuna ait; yeniden oluşturun.",
    respond: toDetail,
  });
}

/** Süreç ölümüyle yarım kalan koşumu kapatır (atomik: yalnız hâlâ HESAPLANIYOR ve bayat olan). */
async function closeStaleRuns(userId: string, now: Date): Promise<void> {
  await prisma.patronReportRun.updateMany({
    where: { userId, status: "HESAPLANIYOR", createdAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
    data: { status: "HATA", errorCode: "YARIM_KALDI", finishedAt: now },
  });
}

/** Hesap + sonuç: bulut boğazı (kapı → şema → koşucu → kişi adı → zaman aşımı); sonuç gzip tavanı aşarsa HATA. */
async function compute(runId: string, key: string, params: Record<string, unknown>) {
  const started = Date.now();
  const out = await computeReportResult({ istekId: runId, key, params, donem: null, nowMs: started, timeoutMs, surfaced: isReportSurfaced });
  const durationMs = Date.now() - started;
  if (out.durum !== "HAZIR") return { status: "HATA", errorCode: out.hataKodu, result: null, resultBytes: null, durationMs };
  const json = JSON.stringify(out.veri);
  if (gzipSync(Buffer.from(json)).length > MAX_COMPRESSED_BYTES) return { status: "HATA", errorCode: "SONUC_BUYUK", result: null, resultBytes: null, durationMs };
  return { status: "HAZIR", errorCode: null, result: out.veri as Prisma.InputJsonValue, resultBytes: Buffer.byteLength(json), durationMs };
}

/** "Oluştur": aynı `clientToken` tek koşum; kapılar → tavan → eşzamanlılık → satır → hesap → sonuç → budama. */
export async function createPatronReportRun(user: PatronReportUser, input: CreateRunInput) {
  const report = patronReportOf(input.raporAnahtari);
  assertReportPermission(user.permissions, report);
  return runReplay(user, input).run(input.clientToken, async () => {
    await assertReportOpen(report);
    const parsed = report.remote.params.safeParse(input.parametreler);
    if (!parsed.success) {
      throw AppError.badRequest(`Rapor parametresi geçersiz: ${parsed.error.issues[0]?.message ?? "bilinmeyen alan"}`, { code: "PARAMETRE_GECERSIZ", rapor: report.remote.key });
    }
    if (runningUsers.has(user.userId)) {
      throw AppError.tooManyRequests("Bir raporunuz hâlâ hazırlanıyor; bitince yeniden deneyin.", { code: "RAPOR_SIRADA" });
    }
    runningUsers.add(user.userId);
    try {
      const now = new Date();
      const limits = await readPatronReportLimits();
      const lastHour = await prisma.patronReportRun.count({ where: { userId: user.userId, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } } });
      if (lastHour >= limits.hourlyMax) {
        throw AppError.tooManyRequests(`Saatte en çok ${limits.hourlyMax} rapor oluşturulabilir; biraz sonra yeniden deneyin.`, { code: "RAPOR_TAVAN", tavan: limits.hourlyMax });
      }
      await closeStaleRuns(user.userId, now);
      const row = await prisma.patronReportRun.create({
        data: { userId: user.userId, reportKey: report.remote.key, params: input.parametreler as Prisma.InputJsonValue, clientToken: input.clientToken },
        select: { id: true },
      });
      const done = await compute(row.id, report.remote.key, input.parametreler);
      // Atomik kapanış: yalnız hâlâ HESAPLANIYOR olan satır (yarım-kaldı süpürgesiyle yarışmaz).
      await prisma.patronReportRun.updateMany({
        where: { id: row.id, status: "HESAPLANIYOR" },
        data: { ...done, result: done.result ?? undefined, finishedAt: new Date() },
      });
      await prunePatronReportRuns(user.userId, report.remote.key, limits);
      return toDetail(await prisma.patronReportRun.findUniqueOrThrow({ where: { id: row.id }, select: DETAIL_SELECT }));
    } finally {
      runningUsers.delete(user.userId);
    }
  });
}

/** Kullanıcının koşum geçmişi (en yeni önce, `imlec` = son satırın id'si); izni kalmayan raporun koşumu listelenmez. */
export async function listPatronReportRuns(user: PatronReportUser, q: { raporAnahtari?: string; imlec?: string; limit: number }) {
  const keys = readableReportKeys(user.permissions);
  if (q.raporAnahtari !== undefined && !keys.includes(q.raporAnahtari)) return { kayitlar: [], sonraki: null };
  await closeStaleRuns(user.userId, new Date());
  const rows = await prisma.patronReportRun.findMany({
    where: { userId: user.userId, deletedAt: null, reportKey: q.raporAnahtari ?? { in: keys } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.imlec ? { cursor: { id: q.imlec }, skip: 1 } : {}),
    select: RUN_SELECT,
  });
  const page = rows.slice(0, q.limit);
  return { kayitlar: page.map(toRequest), sonraki: rows.length > q.limit ? page[page.length - 1]!.id : null };
}

/** Tek koşum + saklı sonuç; başkasının ya da silinmiş koşum 404 (varlığı sızdırılmaz). */
export async function getPatronReportRun(user: PatronReportUser, id: string) {
  const row = await prisma.patronReportRun.findFirst({ where: { id, userId: user.userId, deletedAt: null }, select: DETAIL_SELECT });
  const report = row ? PATRON_REPORTS.get(row.reportKey) : undefined;
  if (!row || !report || !hasReportPermission(user.permissions, report)) {
    throw AppError.notFound("Rapor koşumu bulunamadı.", { code: "RAPOR_KOSUMU_YOK" });
  }
  return toDetail(row);
}

/** Kendi koşumunu siler (soft delete, atomik claim); sonraki budamada satır gider. */
export async function deletePatronReportRun(user: PatronReportUser, id: string) {
  const n = await prisma.patronReportRun.updateMany({
    where: { id, userId: user.userId, deletedAt: null, status: { not: "HESAPLANIYOR" } },
    data: { deletedAt: new Date() },
  });
  if (n.count === 0) throw AppError.notFound("Rapor koşumu bulunamadı ya da hâlâ hazırlanıyor.", { code: "RAPOR_KOSUMU_YOK" });
  return { id, silindi: true as const };
}

/** Katalog: kullanıcının isteyebileceği raporlar (izin ∧ modül ∧ rapor açık) + her birinin SON koşumu. */
export async function patronReportCatalog(user: PatronReportUser) {
  const rows = [];
  for (const r of PATRON_REPORTS.values()) {
    if (!hasReportPermission(user.permissions, r)) continue;
    if ((await reportOpen(r)) !== "ACIK") continue;
    rows.push(r);
  }
  const last = rows.length
    ? await prisma.patronReportRun.findMany({
        where: { userId: user.userId, deletedAt: null, reportKey: { in: rows.map((r) => r.remote.key) } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        distinct: ["reportKey"],
        select: RUN_SELECT,
      })
    : [];
  return {
    raporlar: rows.map((r) => {
      const son = last.find((x) => x.reportKey === r.remote.key);
      return {
        anahtar: r.remote.key, baslik: r.entry.baslik, soru: r.entry.soru, aile: r.remote.key.split("/")[0]!,
        izin: r.remote.permission, erpIzinleri: r.erpPermissions, parametreler: [...r.remote.paramNames], standartDonemler: [] as string[],
        sonKosum: son ? toRequest(son) : null,
      };
    }),
  };
}
