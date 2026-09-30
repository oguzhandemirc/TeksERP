// PORTAL "BİLDİRİMLER" GÖRÜNÜMÜ — satıcı yalnız KENDİ giden kutusunu okur (gönderici ayrı konteynerde; satıcı ona
// bağlanmaz): kanal durumu satırların sonucundan TÜRER — son sonuç KAPALI → "yapılandırılmamış", HATA → "hata",
// GONDERILDI → "çalışıyor"; vadesi 10 dk'dan uzun süredir geçmiş bekleyen varsa "gönderici yanıtsız" (yan
// konteyner çalışmıyor). Deneme bildirimi giden kutusuna İŞLEM KİMLİĞİYLE satır yazar (aynı kimlik ikinci satır doğurmaz).
import type { BildirimDurumu, BildirimKanali, BildirimOlayi, Prisma } from "@prisma/client";
import type { VendorConfig } from "../config";
import type { Db, Tx } from "../lib/prisma";
import { cursorArgs, page } from "../portal/queries";
import { NOTIFICATION_CHANNELS } from "./catalog";
import { enqueueNotificationTx } from "./outbox";

/** Bekleyen bu kadar süredir vadesini geçmişse gönderici yanıtsız sayılır. */
export const SENDER_STALE_MS = 10 * 60_000;

export type ChannelHealth = "CALISIYOR" | "HATA" | "YAPILANDIRILMAMIS" | "GONDERICI_YANITSIZ" | "BILINMIYOR";

const LIST_SELECT = {
  id: true,
  olay: true,
  kanal: true,
  durum: true,
  deneme: true,
  sonrakiDeneme: true,
  sonHata: true,
  gonderimZamani: true,
  govde: true,
  kurulumId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.BildirimSelect;

export async function listNotifications(db: Db, g: { status?: BildirimDurumu; channel?: BildirimKanali; event?: BildirimOlayi; cursor?: string; limit: number }) {
  const rows = await db.bildirim.findMany({
    where: { ...(g.status ? { durum: g.status } : {}), ...(g.channel ? { kanal: g.channel } : {}), ...(g.event ? { olay: g.event } : {}) },
    select: LIST_SELECT,
    ...cursorArgs(g.cursor, g.limit),
  });
  return page(rows, g.limit);
}

async function channelOverview(db: Db, kanal: BildirimKanali, nowMs: number) {
  const last = await db.bildirim.findFirst({
    where: { kanal, durum: { in: ["GONDERILDI", "HATA", "KAPALI"] } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { durum: true, sonHata: true, updatedAt: true },
  });
  const lastSent = await db.bildirim.findFirst({ where: { kanal, durum: "GONDERILDI" }, orderBy: [{ gonderimZamani: "desc" }, { id: "desc" }], select: { gonderimZamani: true } });
  const pending = await db.bildirim.count({ where: { kanal, durum: { in: ["BEKLIYOR", "GONDERILIYOR"] } } });
  const overdue = await db.bildirim.count({ where: { kanal, durum: "BEKLIYOR", sonrakiDeneme: { lt: new Date(nowMs - SENDER_STALE_MS) } } });
  const status: ChannelHealth =
    overdue > 0 ? "GONDERICI_YANITSIZ" : last?.durum === "KAPALI" ? "YAPILANDIRILMAMIS" : last?.durum === "HATA" ? "HATA" : last?.durum === "GONDERILDI" ? "CALISIYOR" : "BILINMIYOR";
  return {
    kanal,
    durum: status,
    sonGonderim: lastSent?.gonderimZamani ?? null,
    sonSonuc: last ? { durum: last.durum, kod: last.sonHata, zaman: last.updatedAt } : null,
    bekleyen: pending,
    geciken: overdue,
  };
}

/** Kanal durumu + tarama eşikleri (satıcının yapılandırmasından; gönderici ayarları yan konteynerde). */
export async function notificationOverview(db: Db, config: VendorConfig, nowMs: number) {
  const kanallar = [];
  for (const k of NOTIFICATION_CHANNELS) kanallar.push(await channelOverview(db, k, nowMs));
  return {
    kanallar,
    esikler: {
      sessizSaat: config.BILDIRIM_SESSIZ_SAAT,
      vadeGun: config.BILDIRIM_VADE_GUN,
      taramaDk: config.BILDIRIM_TARAMA_DK,
      sessizSiniflar: config.BILDIRIM_SESSIZ_SINIFLAR,
    },
  };
}

/** Deneme bildirimi: her kanala bir satır, tekillik işlem kimliğinden (kurulumsuz; gövdede yalnız yol + not). */
export function enqueueTestNotificationTx(tx: Tx, clientToken: string): Promise<number> {
  return enqueueNotificationTx(tx, { event: "DENEME", keyParts: [clientToken], installationDbId: null, portalPath: "/bildirimler", referans: "Portaldan istenen deneme — kanal ayarı doğrulanıyor" });
}
