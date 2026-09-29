// DESTEK KUTUSU (portal): liste · ayrıntı · ek · yanıtla · kapat. Yanıt ve kapanış DEFTERE satır
// yazar (`destek_olayi`), talebin durumu atomik claim ile geçer; kuruluma zil `destek` çalar
// (COMMIT'te) → fabrika yoklar ve yanıtı yoklama yanıtından alır.
import type { DestekDurumu } from "@prisma/client";
import { SUPPORT_TEXT_MAX } from "../lisans-protokol";
import { VendorError, notFoundError, stateConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import { cursorArgs, page } from "../portal/queries";
import { notifyDoorbell } from "./doorbell";

export const SUPPORT_STATES = ["ACIK", "YANITLANDI", "KAPANDI"] as const satisfies readonly DestekDurumu[];

const INSTALLATION_VIEW = {
  select: { id: true, kurulumId: true, ad: true, tesis: { select: { ad: true, musteri: { select: { id: true, ad: true } } } } },
} as const;

export async function listSupportTickets(db: Db, g: { status?: DestekDurumu; cursor?: string; limit: number }) {
  const rows = await db.destekTalebi.findMany({
    where: g.status ? { durum: g.status } : {},
    select: {
      id: true, talepNo: true, konu: true, acan: true, durum: true, ekTuru: true, createdAt: true, updatedAt: true,
      kurulum: INSTALLATION_VIEW,
    },
    ...cursorArgs(g.cursor, g.limit),
  });
  return page(rows, g.limit);
}

export async function supportTicketDetail(db: Db, id: string) {
  const row = await db.destekTalebi.findUnique({
    where: { id },
    select: {
      id: true, talepId: true, talepNo: true, konu: true, aciklama: true, acan: true, panelSurum: true, ekTuru: true,
      saglik: true, ortam: true, durum: true, kapanisZamani: true, createdAt: true, updatedAt: true,
      kurulum: INSTALLATION_VIEW,
      olaylar: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, tur: true, metin: true, yapan: true, createdAt: true } },
    },
  });
  if (!row) throw notFoundError("Destek talebi");
  return row;
}

/** Ek görüntü (ikili) — yalnız portal okuma izniyle, `Content-Type` beyan edilen görüntü türü. */
export async function supportAttachment(db: Db, id: string): Promise<{ tur: string; veri: Buffer }> {
  const row = await db.destekTalebi.findUnique({ where: { id }, select: { ek: true, ekTuru: true } });
  if (!row || !row.ek || !row.ekTuru) throw notFoundError("Ek");
  return { tur: row.ekTuru, veri: Buffer.from(row.ek) };
}

export async function findSupportTicket(id: string): Promise<{ id: string; kurulumId: string; talepNo: string }> {
  const row = await prisma.destekTalebi.findUnique({ where: { id }, select: { id: true, kurulumId: true, talepNo: true } });
  if (!row) throw notFoundError("Destek talebi");
  return row;
}

function requireText(text: string): string {
  const t = text.trim();
  if (t.length === 0 || t.length > SUPPORT_TEXT_MAX) throw new VendorError(400, "GOVDE_GECERSIZ", "Yanıt metni 1–5000 karakter olmalı");
  return t;
}

/** Satıcı yanıtı: kapalı talebe yazılmaz (önce yeniden açılış yok — v1 fabrika yeni talep açar). */
export async function replySupportTicketTx(tx: Tx, g: { ticket: { id: string; kurulumId: string }; text: string; actor: string }) {
  await lockInstallation(tx, g.ticket.kurulumId);
  const text = requireText(g.text);
  const claim = await tx.destekTalebi.updateMany({
    where: { id: g.ticket.id, durum: { in: ["ACIK", "YANITLANDI"] } },
    data: { durum: "YANITLANDI" },
  });
  if (claim.count === 0) throw stateConflict("Talep kapalı; yanıt yazılamaz");
  const olay = await tx.destekOlayi.create({ data: { talepId: g.ticket.id, tur: "YANIT", metin: text, yapan: g.actor } });
  await notifyDoorbell(tx, g.ticket.kurulumId, "destek");
  return { olayId: olay.id, durum: "YANITLANDI" as const };
}

/** Kapanış: durum geçişi + defter satırı (isteğe bağlı kapanış notu); zaten kapalıysa 409. */
export async function closeSupportTicketTx(tx: Tx, g: { ticket: { id: string; kurulumId: string }; note: string | null; actor: string }) {
  await lockInstallation(tx, g.ticket.kurulumId);
  const note = g.note === null || g.note.trim() === "" ? null : requireText(g.note);
  const claim = await tx.destekTalebi.updateMany({
    where: { id: g.ticket.id, durum: { not: "KAPANDI" } },
    data: { durum: "KAPANDI", kapanisZamani: new Date() },
  });
  if (claim.count === 0) throw stateConflict("Talep zaten kapalı");
  const olay = await tx.destekOlayi.create({ data: { talepId: g.ticket.id, tur: "KAPATILDI", metin: note, yapan: g.actor } });
  await notifyDoorbell(tx, g.ticket.kurulumId, "destek");
  return { olayId: olay.id, durum: "KAPANDI" as const };
}
