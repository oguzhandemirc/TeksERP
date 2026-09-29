// DESTEK EŞİTLEME (3d-2): yerel talebi satıcıya kurulum imzalı `POST /v1/destek` ile gönderir (giden
// kutusu: gönderilemeyen talep `GONDERILMEDI` kalır, yoklama sonrası yeniden denenir) ve yoklama
// yanıtındaki `destek` güncellemelerini yerel talebe + yanıt kopyasına yazar. Satıcı `talepId` ile
// idempotenttir: aynı talebin ikinci gönderimi aynı numarayı döndürür.
import prisma from "../lib/prisma";
import { uyari } from "../lib/logger";
import { buildPollHealthSummary } from "../lib/poll-health-summary";
import { getLicenseSnapshot } from "../lib/license/runtime";
import {
  ENDPOINTS,
  SupportResponseSchema,
  VersionTextSchema,
  readSupportUpdates,
  type SupportTicketUpdate,
} from "../lib/license/protocol";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { buildEnvironment, egressTransport, vendorPost, type VendorTransport } from "./helpers/license-wire.helper";

/** Bir yoklama turunda yeniden denenen en çok talep — satıcıya yağmur olmasın. */
const RESEND_BATCH = 5;

export type SupportSendOutcome = "GONDERILDI" | "BEKLIYOR";

/** Talebi satıcıya gönderir; başarıda numara + durum yazılır, başarısızlıkta yalnız sayaç ve hata KODU. */
export async function sendSupportTicket(ticketId: string, transport: VendorTransport = egressTransport): Promise<SupportSendOutcome> {
  const t = await prisma.supportTicket.findUnique({ where: { id: ticketId }, include: { createdBy: { select: { fullName: true } } } });
  if (!t || t.status !== "GONDERILMEDI") return "GONDERILDI";
  const snap = getLicenseSnapshot();
  let code: string | null = null;
  if (!snap.activated || !snap.licenseId) code = "LISANS_ETKIN_DEGIL";
  let json: unknown = null;
  if (code === null) {
    try {
      const panelVersion = VersionTextSchema.safeParse(t.panelVersion);
      const result = await vendorPost(
        ENDPOINTS.SUPPORT,
        "destek",
        async () => ({
          v: 1,
          talepId: t.id,
          konu: t.subject,
          aciklama: t.description,
          acan: t.createdBy.fullName.slice(0, 120) || null,
          panelSurum: panelVersion.success ? panelVersion.data : null,
          ek: t.screenshot && t.screenshotType ? { tur: t.screenshotType, veri: Buffer.from(t.screenshot).toString("base64") } : null,
          saglik: await buildPollHealthSummary(),
          ortam: buildEnvironment(),
        }),
        transport,
      );
      if (result.ok) json = result.json;
      else code = result.code;
    } catch (err) {
      code = err instanceof AppError ? String(err.details?.code ?? "GONDERILEMEDI") : "GONDERILEMEDI";
    }
  }
  const parsed = code === null ? SupportResponseSchema.safeParse(json) : null;
  if (!parsed?.success || parsed.data.talepId !== t.id) {
    await prisma.supportTicket.updateMany({
      where: { id: t.id, status: "GONDERILMEDI" },
      data: { sendAttempts: { increment: 1 }, lastErrorCode: (code ?? "YANIT_GECERSIZ").slice(0, 60) },
    });
    return "BEKLIYOR";
  }
  // Atomik claim: yalnız hâlâ gönderilmemişse ilerler (eşzamanlı ikinci gönderim sayacı ezmez).
  const claim = await prisma.supportTicket.updateMany({
    where: { id: t.id, status: "GONDERILMEDI" },
    data: { status: parsed.data.durum, ticketNo: parsed.data.talepNo, sentAt: new Date(), lastSyncedAt: new Date(), sendAttempts: { increment: 1 }, lastErrorCode: null },
  });
  if (claim.count > 0) {
    void AuditService.log({
      userId: undefined,
      action: "UPDATE",
      tableName: "SUPPORT_TICKET",
      recordId: t.id,
      changes: [{ field: "status", old: "GONDERILMEDI", new: parsed.data.durum }, { field: "ticketNo", old: null, new: parsed.data.talepNo }],
    });
  }
  return "GONDERILDI";
}

/** Yoklama sonrası: gönderilememiş taleplerin en eskilerini yeniden dener. */
export async function sendPendingSupportTickets(transport: VendorTransport = egressTransport): Promise<number> {
  const pending = await prisma.supportTicket.findMany({
    where: { status: "GONDERILMEDI" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: RESEND_BATCH,
    select: { id: true },
  });
  let sent = 0;
  for (const p of pending) if ((await sendSupportTicket(p.id, transport)) === "GONDERILDI") sent++;
  return sent;
}

/** Yoklama yanıtının `destek` alanı → yerel durum + yanıt kopyası. Bilinmeyen talep yok sayılır. */
export async function applySupportUpdates(updates: readonly SupportTicketUpdate[]): Promise<number> {
  let changed = 0;
  for (const u of updates) {
    const t = await prisma.supportTicket.findUnique({ where: { id: u.talepId }, select: { id: true, status: true, ticketNo: true } });
    if (!t) continue;
    if (u.yanitlar.length > 0) {
      const r = await prisma.supportTicketReply.createMany({
        data: u.yanitlar.map((y) => ({ ticketId: t.id, vendorReplyId: y.yanitId, body: y.metin, repliedAt: new Date(y.zaman) })),
        skipDuplicates: true,
      });
      changed += r.count;
    }
    const next = { status: u.durum, ticketNo: u.talepNo };
    if (t.status !== next.status || t.ticketNo !== next.ticketNo) {
      // Gönderim yanıtı kaybolmuş (belirsiz hata) talep satıcıda VAR: yoklama onu gönderilmiş sayar.
      const sent = t.status === "GONDERILMEDI" ? { sentAt: new Date(), lastErrorCode: null } : {};
      await prisma.supportTicket.updateMany({ where: { id: t.id, status: t.status }, data: { ...next, ...sent, lastSyncedAt: new Date() } });
      void AuditService.log({ userId: undefined, action: "UPDATE", tableName: "SUPPORT_TICKET", recordId: t.id, changes: [{ field: "status", old: t.status, new: next.status }] });
      changed++;
    }
  }
  return changed;
}

/** Yoklama turunun sonunda (kira kabul edildikten sonra) çağrılır; hata yoklamayı düşürmez. */
export async function syncSupportAfterPoll(pollResponse: unknown, transport: VendorTransport = egressTransport): Promise<void> {
  try {
    await applySupportUpdates(readSupportUpdates(pollResponse));
    await sendPendingSupportTickets(transport);
  } catch (err) {
    uyari("destek", "destek eşitlemesi tamamlanamadı", err instanceof Error ? err.message : err);
  }
}
