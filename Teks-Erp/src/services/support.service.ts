// DESTEK TALEBİ (3d-2) — panelden açılır: konu + açıklama + isteğe bağlı ekran görüntüsü; sağlık
// özeti gönderim anında otomatik eklenir (yoklamanın allowlist'i). Kayıt clientToken'la idempotent
// doğar, hemen gönderilmeye çalışılır; olmazsa `GONDERILMEDI` kalır ve yoklama sonrası yeniden denenir.
import { z } from "zod";
import prisma from "../lib/prisma";
import { SUPPORT_ATTACHMENT_TYPES, SUPPORT_SUBJECT_MAX, SUPPORT_TEXT_MAX } from "../lib/license/protocol";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import type { VendorTransport } from "./helpers/license-wire.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import { sendSupportTicket } from "./support-sync.service";

/** Panel ekran görüntüsünü bu sınırın altına sıkıştırır: base64 hâli 1 MB'lık genel gövde sınırına sığar. */
export const SUPPORT_SCREENSHOT_MAX_BYTES = 700 * 1024;
export const SUPPORT_LOCAL_STATES = ["GONDERILMEDI", "ACIK", "YANITLANDI", "KAPANDI"] as const;

const MAGIC: Readonly<Record<string, readonly number[]>> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

export const CreateSupportTicketSchema = z.strictObject({
  clientToken: z.uuid("İşlem kimliği geçersiz"),
  konu: z.string().trim().min(1, "Konu boş olamaz").max(SUPPORT_SUBJECT_MAX, "Konu en çok 200 karakter olabilir"),
  aciklama: z.string().trim().min(1, "Açıklama boş olamaz").max(SUPPORT_TEXT_MAX, "Açıklama en çok 5000 karakter olabilir"),
  ekranGoruntusu: z
    .strictObject({ tur: z.enum(SUPPORT_ATTACHMENT_TYPES, "Ekran görüntüsü PNG ya da JPEG olmalı"), veri: z.string().min(1).max(1_000_000) })
    .nullable()
    .optional(),
});
export type CreateSupportTicketInput = z.infer<typeof CreateSupportTicketSchema>;

function decodeScreenshot(e: CreateSupportTicketInput["ekranGoruntusu"]): { type: string; bytes: Buffer } | null {
  if (!e) return null;
  const bytes = Buffer.from(e.veri, "base64");
  if (bytes.length === 0 || bytes.length > SUPPORT_SCREENSHOT_MAX_BYTES) {
    throw AppError.badRequest("Ekran görüntüsü boş ya da çok büyük (en çok 700 KB).", { code: "SUPPORT_SCREENSHOT_TOO_LARGE" });
  }
  const magic = MAGIC[e.tur] ?? [];
  if (magic.length === 0 || !magic.every((b, i) => bytes[i] === b)) {
    throw AppError.badRequest("Ekran görüntüsü beyan edilen türde değil.", { code: "SUPPORT_SCREENSHOT_INVALID" });
  }
  return { type: e.tur, bytes };
}

const TICKET_VIEW = {
  id: true, subject: true, description: true, status: true, ticketNo: true, screenshotType: true, panelVersion: true,
  sentAt: true, lastSyncedAt: true, sendAttempts: true, lastErrorCode: true, createdAt: true, updatedAt: true,
  createdBy: { select: { id: true, fullName: true } },
} as const;

async function ticketView(id: string) {
  const row = await prisma.supportTicket.findUnique({
    where: { id },
    select: { ...TICKET_VIEW, replies: { orderBy: [{ repliedAt: "asc" }, { id: "asc" }], select: { id: true, body: true, repliedAt: true } } },
  });
  if (!row) throw AppError.notFound("Destek talebi bulunamadı.", { code: "SUPPORT_TICKET_NOT_FOUND" });
  return row;
}
export type SupportTicketView = Awaited<ReturnType<typeof ticketView>>;

/** Gövde kapısı gelen yükle kurulur: aynı kimlik başka konu/açıklamayla gelirse 409 (eşzamanlı çağrılar paylaşmaz). */
function replayFor(input: CreateSupportTicketInput) {
  return tokenReplay<{ id: string; subject: string; description: string }, SupportTicketView>({
    find: (db, clientToken) => db.supportTicket.findUnique({ where: { clientToken }, select: { id: true, subject: true, description: true } }),
    alive: { neverDies: "destek talebi silinmez/iptal edilmez; satıcıda kapanır" },
    identity: (p) => [{ ad: "konu", mevcut: p.subject, gelen: input.konu }, { ad: "aciklama", mevcut: p.description, gelen: input.aciklama }],
    collision: "Bu işlem kimliği başka bir destek talebine ait; formu yeniden gönderin.",
    respond: (p) => ticketView(p.id),
  });
}

export async function createSupportTicket(g: {
  userId: string;
  input: CreateSupportTicketInput;
  panelVersion: string | null;
  /** Yalnız bekçi: satıcı taşıyıcısı (varsayılan gerçek çıkış). */
  transport?: VendorTransport;
}): Promise<SupportTicketView> {
  const screenshot = decodeScreenshot(g.input.ekranGoruntusu);
  return replayFor(g.input).run(g.input.clientToken, async () => {
    const row = await prisma.supportTicket.create({
      data: {
        clientToken: g.input.clientToken,
        subject: g.input.konu,
        description: g.input.aciklama,
        screenshot: screenshot ? new Uint8Array(screenshot.bytes) : null,
        screenshotType: screenshot?.type ?? null,
        panelVersion: g.panelVersion?.slice(0, 60) ?? null,
        createdById: g.userId,
      },
      select: { id: true },
    });
    void AuditService.log({ userId: g.userId, action: "CREATE", tableName: "SUPPORT_TICKET", recordId: row.id, newData: { konu: g.input.konu, ekranGoruntusu: screenshot !== null } });
    await sendSupportTicket(row.id, g.transport).catch(() => "BEKLIYOR");
    return ticketView(row.id);
  });
}

export async function listSupportTickets(g: { status?: (typeof SUPPORT_LOCAL_STATES)[number]; limit: number }) {
  return prisma.supportTicket.findMany({
    where: g.status ? { status: g.status } : {},
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: g.limit,
    select: { ...TICKET_VIEW, _count: { select: { replies: true } } },
  });
}

export async function getSupportTicket(id: string): Promise<SupportTicketView> {
  return ticketView(id);
}
