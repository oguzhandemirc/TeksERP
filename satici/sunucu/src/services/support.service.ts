// DESTEK (fabrika tarafı): `POST /v1/destek` talebi açar (kurulum imzalı; `talepId` fabrikanın yerel
// kimliği → tekrar gönderim aynı talebi döndürür) ve yoklama yanıtına kurulumun güncel taleplerini
// + satıcı yanıtlarını ekler. Talep DURUM tablosu, olan her şey `destek_olayi` DEFTERİNDE.
import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_REPLY_LIMIT,
  SUPPORT_UPDATE_LIMIT,
  type SupportRequest,
  type SupportTicketUpdate,
} from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import { enqueueNotificationTx } from "../notifications/outbox";
import type { AuthenticatedRequest } from "./installation-auth";

/** Yoklama yanıtı son bu kadar günde hareket görmüş talepleri taşır. */
export const SUPPORT_UPDATE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
export const SUPPORT_ACTOR = "kurulum";

/** Ek yalnız beyan edilen görüntü türündeyse kabul (imza baytları) — keyfi dosya taşınmaz. */
const MAGIC: Readonly<Record<string, readonly number[]>> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

export function decodeAttachment(ek: SupportRequest["ek"]): { tur: string; veri: Buffer } | null {
  if (!ek) return null;
  const veri = Buffer.from(ek.veri, "base64");
  if (veri.length === 0 || veri.length > SUPPORT_ATTACHMENT_MAX_BYTES) {
    throw new VendorError(400, "GOVDE_GECERSIZ", "Ek boş ya da 1 MB sınırını aşıyor");
  }
  const magic = MAGIC[ek.tur] ?? [];
  if (magic.length === 0 || !magic.every((b, i) => veri[i] === b)) {
    throw new VendorError(400, "GOVDE_GECERSIZ", "Ek beyan edilen görüntü türünde değil");
  }
  return { tur: ek.tur, veri };
}

async function nextTicketNo(tx: Tx): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('destek_talep_no_seq') AS n`;
  return `DST-${String(rows[0]?.n ?? 0).padStart(6, "0")}`;
}

export interface SupportOpened {
  readonly v: 1;
  readonly talepId: string;
  readonly talepNo: string;
  readonly durum: "ACIK" | "YANITLANDI" | "KAPANDI";
}

export async function openSupportTicket(auth: AuthenticatedRequest, body: SupportRequest): Promise<SupportOpened> {
  const attachment = decodeAttachment(body.ek);
  const kurulumId = auth.installation.id;
  const r = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, kurulumId);
    const existing = await tx.destekTalebi.findUnique({
      where: { kurulumId_talepId: { kurulumId, talepId: body.talepId } },
      select: { id: true, talepNo: true, durum: true },
    });
    if (existing) return { created: false, row: existing };
    const row = await tx.destekTalebi.create({
      data: {
        kurulumId,
        talepId: body.talepId,
        talepNo: await nextTicketNo(tx),
        konu: body.konu,
        aciklama: body.aciklama,
        acan: body.acan,
        panelSurum: body.panelSurum,
        ekTuru: attachment?.tur ?? null,
        ek: attachment ? new Uint8Array(attachment.veri) : null,
        saglik: body.saglik,
        ortam: body.ortam,
      },
      select: { id: true, talepNo: true, durum: true },
    });
    await tx.destekOlayi.create({ data: { talepId: row.id, tur: "ACILDI", metin: body.aciklama, yapan: SUPPORT_ACTOR } });
    // Bildirim AYNI tx'te: yalnız konu + talep no (açıklama, açan, ek, sağlık GİTMEZ — allowlist).
    await enqueueNotificationTx(tx, { event: "DESTEK_TALEBI", keyParts: [row.id], installationDbId: kurulumId, relatedId: row.id, portalPath: `/destek/${row.id}`, konu: body.konu, referans: row.talepNo });
    return { created: true, row };
  });
  if (r.created) {
    void recordAudit({
      event: "DESTEK_ACILDI",
      entity: "DestekTalebi",
      entityId: r.row.id,
      actor: SUPPORT_ACTOR,
      summary: { talepNo: r.row.talepNo, kurulumId: auth.installation.kurulumId, ekVar: attachment !== null },
    });
  }
  return { v: 1, talepId: body.talepId, talepNo: r.row.talepNo, durum: r.row.durum };
}

/** Yoklama yanıtının `destek` alanı: son 30 günde hareketli ≤20 talep + her birinin son ≤50 satıcı yanıtı. */
export async function supportUpdatesFor(db: Db, installationDbId: string, nowMs: number): Promise<SupportTicketUpdate[]> {
  const rows = await db.destekTalebi.findMany({
    where: { kurulumId: installationDbId, updatedAt: { gte: new Date(nowMs - SUPPORT_UPDATE_WINDOW_DAYS * DAY_MS) } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: SUPPORT_UPDATE_LIMIT,
    select: {
      talepId: true,
      talepNo: true,
      durum: true,
      updatedAt: true,
      olaylar: {
        where: { tur: { in: ["YANIT", "KAPATILDI"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: SUPPORT_REPLY_LIMIT,
        select: { id: true, metin: true, createdAt: true },
      },
    },
  });
  return rows.map((r) => ({
    talepId: r.talepId,
    talepNo: r.talepNo,
    durum: r.durum,
    guncellendi: r.updatedAt.toISOString(),
    yanitlar: r.olaylar
      .filter((o) => (o.metin ?? "").length > 0)
      .reverse()
      .map((o) => ({ yanitId: o.id, metin: o.metin ?? "", zaman: o.createdAt.toISOString() })),
  }));
}
