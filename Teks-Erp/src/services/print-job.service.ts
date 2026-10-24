// =============================================================================
// YAZDIRMA GEÇMİŞİ — `print_jobs`in TEK yazarı, okuyucusu ve budayıcısı (izlenebilirlik A1)
// =============================================================================
// Tasarım: docs/design/IZLENEBILIRLIK-CIHAZ-PLAN.md §3.1–§3.6 · kural: docs/kurallar/belge-etiket.md.
// TELEMETRİ: hiçbir iş kararı bu tabloyu okumaz (top iptal guard'ı `rolls.labelPrintedAt` okur) ve
// geçmiş audit'ten TÜRETİLMEZ (audit yalnız ayak izi). `prisma.printJob` erişimi bu dosya dışında
// yasak — bekçi `test_print_jobs` §10 (AST).
//
// İki yazım biçimi:
//   · `recordPrintJob` — iş ucunun YAN ürünü: tx dışı, best-effort, sayaçlı; hata iş yanıtını DEĞİŞTİRMEZ.
//   · `reportPrintJob` — `POST /api/print-jobs`: satır işin KENDİSİ; `clientToken` zorunlu, replay tek boğazdan.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { currentOrigin } from "../lib/request-context";
import { hata } from "../lib/logger";
import { AppError } from "../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../utils/cursor";
import {
  PRINT_STATUSES,
  PRINT_SUBJECT_KINDS,
  PRINT_SUBJECT_TABLES,
  isPrintSubjectKind,
  type PrintStatus,
} from "../constants/print-subject-catalog";
import { tokenReplay } from "./helpers/token-replay.helper";
import { printJobPurgeCutoff } from "./helpers/print-job-retention.helper";
import type { PrintJobRequestContext } from "./helpers/print-job-context.helper";
import { clip, normalizeMeta, type PrintJobInput, type PrintJobReport } from "./helpers/print-job-input.helper";
import {
  PRINT_JOB_PAGE_DEFAULT,
  PRINT_JOB_PAGE_MAX,
  PRINT_JOB_SELECT,
  type PrintJobDto,
  type PrintJobSummary,
} from "./helpers/print-job-filter.helper";

// Çağıranlar tek kapıdan alsın: sözleşme ve süzgeç yardımcıları buradan da görünür.
export * from "./helpers/print-job-input.helper";
export * from "./helpers/print-job-filter.helper";
// ─── Sağlık sayacı ──────────────────────────────────────────────────────────

const health = { yazilan: 0, dusen: 0, sonHata: null as string | null, sonHataAt: null as string | null };

/** `/health` → `printJobs`: best-effort yazımın sessiz düşmesi burada görünür (`AuditService.getHealth` emsali). */
export function getPrintJobHealth(): { yazilan: number; dusen: number; sonHata: string | null; sonHataAt: string | null } {
  return { ...health };
}

/** Bekçi düzeneği (§11): yazımı yapay olarak düşürür. Üretimde çağrılmaz. */
let injectedFault: Error | null = null;
export function setPrintJobWriteFaultForTest(err: Error | null): void {
  injectedFault = err;
}

// ─── Yazım ──────────────────────────────────────────────────────────────────
async function buildRow(input: PrintJobInput): Promise<Prisma.PrintJobUncheckedCreateInput> {
  const origin = currentOrigin();
  let peripheralDeviceId = input.peripheralDeviceId ?? null;
  // Bilinmeyen/silinmiş yazıcı FK'yı düşürmesin: adı kalır, bağ boşalır.
  if (peripheralDeviceId) {
    const p = await prisma.peripheralDevice.findUnique({ where: { id: peripheralDeviceId }, select: { id: true } });
    peripheralDeviceId = p?.id ?? null;
  }
  return {
    clientToken: input.clientToken ?? null,
    requestId: origin.requestId,
    userId: input.ctx.userId,
    deviceRefId: input.ctx.deviceRefId,
    source: input.ctx.source,
    outputKind: input.outputKind ?? "PRINTER",
    appVersion: clip(input.ctx.appVersion, 32),
    stationId: input.ctx.stationId,
    machineId: input.ctx.machineId,
    subjectKind: input.subjectKind,
    docType: input.docType ?? null,
    subjectTable: input.subjectTable ?? null,
    subjectId: input.subjectId ?? null,
    subjectIds: input.subjectIds ?? [],
    subjectNo: clip(input.subjectNo, 64),
    printedDocumentId: input.printedDocumentId ?? null,
    docVersion: input.docVersion ?? null,
    itemCount: Math.max(1, input.itemCount ?? 1),
    copies: Math.max(1, input.copies ?? 1),
    isReprint: input.isReprint ?? null,
    transport: input.transport ?? null,
    peripheralDeviceId,
    printerName: clip(input.printerName, 120),
    printerAddress: clip(input.printerAddress, 128),
    language: input.language ?? null,
    status: input.status,
    errorCode: clip(input.errorCode, 60) ?? (input.status === "HATA" ? "BILINMIYOR" : null),
    errorMessage: clip(input.errorMessage, 300),
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? null,
    durationMs: input.durationMs ?? null,
    bytes: input.bytes ?? null,
    meta: normalizeMeta(input.subjectKind, input.meta),
  };
}

function isClientTokenDuplicate(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * İş ucunun yan ürünü olarak bir basım satırı yazar. TX DIŞI ve best-effort: hata yutulur,
 * sayaca ve log'a düşer — iş yanıtı hiçbir koşulda değişmez. Aynı `clientToken` ikinci kez
 * gelirse (ağ yeniden denemesi) satır zaten vardır: düşüş sayılmaz.
 */
export async function recordPrintJob(input: PrintJobInput): Promise<void> {
  try {
    if (injectedFault) throw injectedFault;
    await prisma.printJob.create({ data: await buildRow(input) });
    health.yazilan++;
  } catch (e) {
    if (input.clientToken && isClientTokenDuplicate(e)) return;
    health.dusen++;
    health.sonHata = (e as Error)?.message?.slice(0, 200) ?? String(e);
    health.sonHataAt = new Date().toISOString();
    hata("print-job", "basım satırı yazılamadı (iş yanıtı etkilenmedi)", e);
  }
}

const SUBJECT_TABLE_SET: ReadonlySet<string> = new Set(PRINT_SUBJECT_TABLES);

/** `subjectId` verilmişse kaydın kapalı kümedeki tabloda VAR olduğu doğrulanır (fail-closed). */
async function assertSubjectExists(table: string | undefined, id: string | undefined): Promise<void> {
  if (!id) return;
  if (!table) {
    throw AppError.badRequest("Kayıt kimliği verildiyse tablo (subjectTable) da verilmeli", { code: "PRINT_SUBJECT_TABLE_REQUIRED" });
  }
  if (!SUBJECT_TABLE_SET.has(table)) {
    throw AppError.badRequest(`Tanınmayan kayıt tablosu: ${table}`, { code: "PRINT_SUBJECT_TABLE_UNKNOWN" });
  }
  // Tablo adı kapalı kümeden geldiği için tanımlayıcı olarak güvenle gömülür.
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id}::uuid LIMIT 1`;
  if (rows.length === 0) {
    throw AppError.badRequest("Basılan kayıt bulunamadı", { code: "PRINT_SUBJECT_NOT_FOUND", subjectTable: table, subjectId: id });
  }
}

type PriorReport = { id: string; userId: string | null; subjectKind: string; status: string; subjectId: string | null; outputKind: string };

function reportReplay(ctx: PrintJobRequestContext, body: PrintJobReport) {
  return tokenReplay<PriorReport, PrintJobDto>({
    find: (db, clientToken) =>
      db.printJob.findUnique({
        where: { clientToken },
        select: { id: true, userId: true, subjectKind: true, status: true, subjectId: true, outputKind: true },
      }),
    alive: { neverDies: "basım satırı telemetridir: durum geçişi yok, yalnız yaşa göre budanır (budanmış token yeni satır doğurur)" },
    identity: (p) => [
      { ad: "kullanici", mevcut: p.userId, gelen: ctx.userId },
      { ad: "tur", mevcut: p.subjectKind, gelen: body.subjectKind },
      { ad: "sonuc", mevcut: p.status, gelen: body.status },
      { ad: "kayit", mevcut: p.subjectId, gelen: body.subjectId ?? null },
      { ad: "cikti", mevcut: p.outputKind, gelen: body.outputKind ?? "PRINTER" },
    ],
    collision: "Bu basım kimliği başka bir basım kaydına ait; yeni bir kimlikle yeniden bildirin.",
    respond: async (p) => getPrintJob(p.id),
  });
}

/**
 * `POST /api/print-jobs`: istemcinin bildirdiği basım. Kullanıcı ve cihaz İSTEKTEN (token/başlık),
 * gövdeden asla. Bilinmeyen tür 400 `PRINT_SUBJECT_UNKNOWN`; satır yazılamazsa hata FIRLAR
 * (istemci aynı token'la yeniden dener — burada satır işin kendisidir).
 */
export async function reportPrintJob(ctx: PrintJobRequestContext, body: PrintJobReport): Promise<PrintJobDto> {
  if (!isPrintSubjectKind(body.subjectKind)) {
    throw AppError.badRequest(`Tanınmayan basım türü: ${body.subjectKind}`, { code: "PRINT_SUBJECT_UNKNOWN", known: PRINT_SUBJECT_KINDS });
  }
  const kind = body.subjectKind;
  return reportReplay(ctx, body).run(body.clientToken, async () => {
    await assertSubjectExists(body.subjectTable, body.subjectId);
    const row = await buildRow({
      ctx: { ...ctx, source: body.source ?? ctx.source, appVersion: body.appVersion ?? ctx.appVersion },
      subjectKind: kind,
      status: body.status,
      outputKind: body.outputKind,
      transport: body.transport ?? null,
      clientToken: body.clientToken,
      docType: body.docType ?? null,
      subjectTable: body.subjectTable ?? null,
      subjectId: body.subjectId ?? null,
      subjectIds: body.subjectIds,
      subjectNo: body.subjectNo ?? null,
      printedDocumentId: body.printedDocumentId ?? null,
      docVersion: body.docVersion ?? null,
      itemCount: body.itemCount ?? Math.max(1, body.subjectIds?.length ?? 1),
      copies: body.copies,
      isReprint: body.isReprint ?? null,
      peripheralDeviceId: body.peripheralId ?? null,
      printerName: body.printerName ?? null,
      printerAddress: body.printerAddress ?? null,
      language: body.language ?? null,
      errorCode: body.errorCode ?? null,
      errorMessage: body.errorMessage ?? null,
      startedAt: body.startedAt ? new Date(body.startedAt) : null,
      finishedAt: body.finishedAt ? new Date(body.finishedAt) : null,
      durationMs: body.durationMs ?? null,
      bytes: body.bytes ?? null,
      meta: body.meta ?? null,
    });
    const created = await prisma.printJob.create({ data: row, select: { id: true } });
    health.yazilan++;
    return getPrintJob(created.id);
  });
}

// ─── Okuma ──────────────────────────────────────────────────────────────────
/** Cursor'lı liste (yeniden eskiye). */
export async function listPrintJobs(
  where: Prisma.PrintJobWhereInput,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ data: PrintJobDto[]; nextCursor: string | null }> {
  const limit = Math.min(PRINT_JOB_PAGE_MAX, Math.max(1, opts.limit ?? PRINT_JOB_PAGE_DEFAULT));
  const c = decodeCursor(opts.cursor);
  const page: Prisma.PrintJobWhereInput = c ? { AND: [where, cursorWhere(c)] } : where;
  const rows = await prisma.printJob.findMany({
    where: page,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: PRINT_JOB_SELECT,
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? buildNextCursor(data[data.length - 1]) : null };
}

/** Özet şeridi — listeyle AYNI where (sayım = liste uzunluğu). */
export async function summarizePrintJobs(where: Prisma.PrintJobWhereInput): Promise<PrintJobSummary> {
  const total = await prisma.printJob.count({ where });
  const byStatus = await prisma.printJob.groupBy({ by: ["status"], where, _count: { _all: true } });
  const pdf = await prisma.printJob.count({ where: { AND: [where, { outputKind: "PDF" }] } });
  const worst = await prisma.printJob.groupBy({
    by: ["peripheralDeviceId", "printerName"],
    where: { AND: [where, { status: "HATA" }] },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  const statusCounts = Object.fromEntries(PRINT_STATUSES.map((s) => [s, 0])) as Record<PrintStatus, number>;
  for (const r of byStatus) statusCounts[r.status as PrintStatus] = r._count._all;
  const w = worst[0];
  return {
    toplam: total,
    durum: statusCounts,
    basarili: statusCounts.ILETILDI,
    pdf,
    enCokHata: w ? { peripheralDeviceId: w.peripheralDeviceId, printerName: w.printerName, sayi: w._count._all } : null,
  };
}

export async function getPrintJob(id: string): Promise<PrintJobDto> {
  const row = await prisma.printJob.findUnique({ where: { id }, select: PRINT_JOB_SELECT });
  if (!row) throw AppError.notFound("Basım kaydı bulunamadı");
  return row;
}

// ─── Budama ─────────────────────────────────────────────────────────────────

/** Gece bakımı: yalnız YAŞ yüklemi (`createdAt < now - retentionDays`); 0 = budama yok. */
export async function prunePrintJobs(now: Date, retentionDays: number): Promise<{ deleted: number; cutoff: Date | null }> {
  const cutoff = printJobPurgeCutoff(retentionDays, now);
  if (!cutoff) return { deleted: 0, cutoff: null };
  const r = await prisma.printJob.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { deleted: r.count, cutoff };
}
