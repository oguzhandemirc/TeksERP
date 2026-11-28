// =============================================================================
// TAHAR PLANI (DrawingInPlan) — kumaşa ait tel→çerçeve tekrar dizisi (T1, Seyitoğlu 2026-11-28)
// =============================================================================
// Kod `drawingInPlan` serisinden (istemci gönderirse aynen); dizi kısaltmalı yazımdan sunucuda açılır
// (`constants/drawing-in-plan.ts` tek kaynak), çerçeve sayısı ayar üst sınırına (vars. 12) bağlı.
// Silinmez, pasife alınır; arşivlenmemiş kumaş bağlıyken pasif 409 (MV-06). BaseController KULLANILMAZ.
// =============================================================================
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { p2002TargetsCode, withBarcodeRetry } from "../utils/barcode-retry";
import { AuditService } from "./audit.service";
import { BaseService } from "./base.service";
import { nextSeriesNo } from "./number-series.service";
import { codeCountsForCounter } from "./helpers/series-format.helper";
import { isUniqueViolation, parseTextField } from "./helpers/cost-input.helper";
import { readDokumaDrawingInMaxFrames } from "./system-setting/weave-settings";
import {
  compressDrawingIn,
  DRAWING_IN_NOTATION_MAX,
  drawingInCanonical,
  drawingInSequenceError,
  parseDrawingInNotation,
} from "../constants/drawing-in-plan";

export const DRAWING_IN_PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  frameCount: true,
  threading: true,
  notation: true,
  threadingKey: true,
  selvedgeThreading: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
  _count: { select: { fabricItems: true } },
} satisfies Prisma.DrawingInPlanSelect;

export type DrawingInPlanRow = Prisma.DrawingInPlanGetPayload<{ select: typeof DRAWING_IN_PLAN_SELECT }>;

const ALLOWED = new Set(["code", "name", "frameCount", "notation", "threading", "selvedgeThreading", "notes"]);

function rejectUnknown(body: Record<string, unknown>): void {
  const unknown = Object.keys(body).filter((k) => !ALLOWED.has(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan alan: ${unknown.join(", ")}`);
}

const bad = (message: string, code = "DRAWING_IN_PLAN_INVALID"): AppError => AppError.badRequest(message, { code });

/** Eşleştirme özeti: en kısa tekrar biriminin sha256'sı (aynı tahar = aynı anahtar; rapor kaç kez yazılmış olursa olsun). */
export function threadingKeyOf(sequence: readonly number[]): string {
  return createHash("sha256").update(drawingInCanonical(sequence)).digest("hex");
}

function parseFrameCount(raw: unknown, maxFrames: number): number {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw bad("Çerçeve sayısı 1 ve üstü tam sayı olmalı.", "DRAWING_IN_FRAME_COUNT_INVALID");
  if (n > maxFrames) {
    throw bad(`Çerçeve sayısı en çok ${maxFrames} olabilir (Ayarlar → Dokuma → Tahar planında en çok çerçeve).`, "DRAWING_IN_FRAME_COUNT_OVER_MAX");
  }
  return n;
}

/** Dizi gövdesi: sayı listesi ya da kısaltmalı yazım metni. */
function parseSequenceInput(raw: unknown, label: string): number[] {
  if (typeof raw === "string") {
    const r = parseDrawingInNotation(raw);
    if (!r.ok) throw bad(`${label}: ${r.message}`, "DRAWING_IN_NOTATION_INVALID");
    return r.sequence;
  }
  if (!Array.isArray(raw)) throw bad(`${label} çerçeve numarası listesi ya da kısaltmalı yazım olmalı.`);
  return raw.map((v) => {
    if (typeof v !== "number" || !Number.isInteger(v)) throw bad(`${label} yalnız tam sayı çerçeve numarası içerebilir.`);
    return v;
  });
}

const sameSeq = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

interface ThreadingData { threading: number[]; notation: string; threadingKey: string }

/** `notation` ve/veya `threading` → tutarlı üçlü; ikisi birlikte gelip uyuşmazsa 400. */
function parseThreading(body: Record<string, unknown>): ThreadingData | undefined {
  const hasNotation = body.notation !== undefined && body.notation !== null && body.notation !== "";
  const hasThreading = body.threading !== undefined && body.threading !== null;
  if (!hasNotation && !hasThreading) return undefined;
  let notation: string | null = null;
  let threading: number[];
  if (hasNotation) {
    if (typeof body.notation !== "string") throw bad("Tahar yazımı metin olmalı.");
    notation = body.notation.trim();
    if (notation.length > DRAWING_IN_NOTATION_MAX) throw bad(`Tahar yazımı en çok ${DRAWING_IN_NOTATION_MAX} karakter olabilir.`);
    threading = parseSequenceInput(notation, "Tahar dizisi");
    if (hasThreading && !sameSeq(threading, parseSequenceInput(body.threading, "Tahar dizisi"))) {
      throw bad("Tahar yazımı ile çerçeve dizisi birbirini tutmuyor — birini düzeltin.", "DRAWING_IN_NOTATION_MISMATCH");
    }
  } else {
    threading = parseSequenceInput(body.threading, "Tahar dizisi");
  }
  if (threading.length === 0) throw bad("Tahar dizisi boş — en az bir çerçeve numarası yazın.");
  return { threading, notation: notation ?? compressDrawingIn(threading), threadingKey: threadingKeyOf(threading) };
}

function requiredText(raw: unknown, label: string, max: number): string {
  const v = parseTextField(raw, label, max);
  if (!v) throw AppError.badRequest(`${label} zorunludur.`);
  return v;
}

async function parseWrite(body: Record<string, unknown>, current: DrawingInPlanRow | null): Promise<Prisma.DrawingInPlanUncheckedUpdateInput> {
  const out: Prisma.DrawingInPlanUncheckedUpdateInput = {};
  const partial = current !== null;
  if (body.code !== undefined && body.code !== null && body.code !== "") out.code = requiredText(body.code, "Tahar planı kodu", 32);
  else if (partial && body.code !== undefined) throw bad("Tahar planı kodu boş bırakılamaz.");
  if (body.name !== undefined || !partial) out.name = requiredText(body.name, "Tahar planı adı", 100);
  if (body.frameCount !== undefined || !partial) out.frameCount = parseFrameCount(body.frameCount, await readDokumaDrawingInMaxFrames());
  const thr = parseThreading(body);
  if (!thr && !partial) throw bad("Tahar dizisi zorunludur — çerçeve numaralarını sırayla girin.");
  if (thr) Object.assign(out, thr);
  if (body.selvedgeThreading !== undefined) {
    out.selvedgeThreading = body.selvedgeThreading === null || body.selvedgeThreading === "" ? [] : parseSequenceInput(body.selvedgeThreading, "Kenar taharı");
  }
  const notes = parseTextField(body.notes, "Not", 500);
  if (notes !== undefined) out.notes = notes;
  // Çerçeve sınırı yazım SONRASI değerlerle (yalnız çerçeve sayısı düşse de eski dizi kontrol edilir).
  const frames = (out.frameCount as number | undefined) ?? current!.frameCount;
  const err = drawingInSequenceError((out.threading as number[] | undefined) ?? current!.threading, frames)
    ?? drawingInSequenceError((out.selvedgeThreading as number[] | undefined) ?? current?.selvedgeThreading ?? [], frames, "Kenar taharı");
  if (err) throw bad(err, "DRAWING_IN_FRAME_OUT_OF_RANGE");
  return out;
}

function conflict(e: unknown): never {
  if (isUniqueViolation(e)) throw AppError.conflict("Bu kod ya da adla bir tahar planı zaten var.", { code: "DRAWING_IN_PLAN_DUPLICATE" });
  throw e;
}

function auditView(r: DrawingInPlanRow): Record<string, unknown> {
  return {
    code: r.code, name: r.name, frameCount: r.frameCount, notation: r.notation, threadingLength: r.threading.length,
    threadingKey: r.threadingKey, selvedgeThreading: r.selvedgeThreading, notes: r.notes,
  };
}

async function nextDrawingInPlanCode(): Promise<string> {
  return nextSeriesNo("drawingInPlan", async (prefix, fmt) =>
    (await prisma.drawingInPlan.findMany({ where: { code: { startsWith: prefix } }, select: { code: true, createdAt: true } }))
      .filter((r) => codeCountsForCounter(fmt, r.code)), new Date());
}

export async function listDrawingInPlans(opts: { includeInactive?: boolean; search?: string }): Promise<DrawingInPlanRow[]> {
  const s = opts.search?.trim();
  return prisma.drawingInPlan.findMany({
    where: {
      AND: [
        opts.includeInactive ? {} : { isActive: true },
        s ? { OR: [{ code: { contains: s, mode: "insensitive" } }, { name: { contains: s, mode: "insensitive" } }, { notation: { contains: s, mode: "insensitive" } }] } : {},
      ],
    },
    select: DRAWING_IN_PLAN_SELECT,
    orderBy: [{ code: "asc" }],
  });
}

export async function getDrawingInPlan(id: string): Promise<DrawingInPlanRow> {
  const row = await prisma.drawingInPlan.findUnique({ where: { id }, select: DRAWING_IN_PLAN_SELECT });
  if (!row) throw AppError.notFound("Tahar planı bulunamadı.");
  return row;
}

export async function createDrawingInPlan(body: Record<string, unknown>, userId?: string): Promise<DrawingInPlanRow> {
  rejectUnknown(body);
  const data = await parseWrite(body, null) as Prisma.DrawingInPlanUncheckedCreateInput;
  const manualCode = typeof data.code === "string" ? data.code : null;
  let row: DrawingInPlanRow;
  try {
    row = await withBarcodeRetry(
      async () => prisma.drawingInPlan.create({
        data: { ...data, code: manualCode ?? (await nextDrawingInPlanCode()), createdById: userId ?? null, updatedById: userId ?? null },
        select: DRAWING_IN_PLAN_SELECT,
      }),
      undefined,
      // Yalnız otomatik kodun sayaç çakışması tekrarlanır; ad seddi ve elle kod Türkçe 409'a düşer.
      (err) => manualCode === null && p2002TargetsCode(err),
      "Tahar planı kodu",
    );
  } catch (e) {
    conflict(e);
  }
  await AuditService.log({ userId, action: "CREATE", tableName: "DRAWING_IN_PLAN", recordId: row.id, newData: auditView(row) });
  return row;
}

export async function updateDrawingInPlan(id: string, body: Record<string, unknown>, userId?: string): Promise<DrawingInPlanRow> {
  rejectUnknown(body);
  const before = await getDrawingInPlan(id);
  const data = await parseWrite(body, before);
  if (Object.keys(data).length === 0) throw AppError.badRequest("Güncellenecek alan yok.");
  let after: DrawingInPlanRow;
  try {
    after = await prisma.drawingInPlan.update({ where: { id }, data: { ...data, updatedById: userId ?? null }, select: DRAWING_IN_PLAN_SELECT });
  } catch (e) {
    conflict(e);
  }
  await AuditService.log({ userId, action: "UPDATE", tableName: "DRAWING_IN_PLAN", recordId: id, oldData: auditView(before), newData: auditView(after) });
  return after;
}

/** Pasife al — arşivlenmemiş kumaş bağlıyken 409 + liste (MV-06); atomik claim. */
export async function deactivateDrawingInPlan(id: string, userId?: string): Promise<{ id: string }> {
  await getDrawingInPlan(id);
  const users = await prisma.item.findMany({ where: { drawingInPlanId: id, lifecycleStatus: { not: "ARCHIVED" } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" }, take: 50 });
  if (users.length > 0) {
    throw AppError.conflict(`Tahar planı ${users.length} arşivlenmemiş kumaşta kullanılıyor — önce kumaşlardan kaldırın.`, { code: "DRAWING_IN_PLAN_IN_USE", items: users });
  }
  const claim = await prisma.drawingInPlan.updateMany({ where: { id, isActive: true }, data: { isActive: false, updatedById: userId ?? null } });
  if (claim.count === 0) throw AppError.conflict("Tahar planı zaten pasif.");
  await AuditService.log({ userId, action: "UPDATE", tableName: "DRAWING_IN_PLAN", recordId: id, oldData: { isActive: true }, newData: { isActive: false } });
  return { id };
}

export async function activateDrawingInPlan(id: string, userId?: string): Promise<{ id: string }> {
  await getDrawingInPlan(id);
  const claim = await prisma.drawingInPlan.updateMany({ where: { id, isActive: false }, data: { isActive: true, updatedById: userId ?? null } });
  if (claim.count === 0) throw AppError.conflict("Tahar planı zaten aktif.");
  await AuditService.log({ userId, action: "UPDATE", tableName: "DRAWING_IN_PLAN", recordId: id, oldData: { isActive: false }, newData: { isActive: true } });
  return { id };
}

// Benzer-ad uyarısı (yalnız OKUR, engellemez): trigram sorgusunun tek sahibi BaseService; burada yalnız o
// metot kullanılır — yazma yolları yukarıdaki fonksiyonlarda kalır (BaseController yok).
const similarNameReader = new BaseService({ modelName: "drawingInPlan", tableName: "DRAWING_IN_PLAN", uniqueField: "code", similarNameField: "name" });

export function findSimilarDrawingInPlanNames(name: string, excludeId?: string): ReturnType<BaseService["findSimilarNames"]> {
  return similarNameReader.findSimilarNames(name, excludeId ? { excludeId } : {});
}
