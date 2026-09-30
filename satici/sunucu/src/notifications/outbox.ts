// GİDEN KUTUSUNA YAZIM — olayı doğuran tx'in İÇİNDE çağrılır (ilk parametre `tx`; bekçi `test_bildirim_giden_kutusu`
// §0 çağrı yerlerini ölçer): olay geri alınırsa bildirim de yoktur, bildirim yazılamazsa olay da yazılmaz. Satıcı
// DIŞARI BAĞLANMAZ — gönderim yan konteynerin işidir. Kanal başına bir satır; tekillik anahtarı + kanal UNIQUE
// (`skipDuplicates`) aynı olayı ikinci kez yazdırmaz (tekrar gönderim, yeniden deneme, iki zamanlayıcı).
import type { BildirimOlayi } from "@prisma/client";
import type { Tx } from "../lib/prisma";
import { NOTIFICATION_CHANNELS, dedupeKey, notificationBody, type NotificationBodyInput } from "./catalog";

export interface EnqueueInput {
  readonly event: BildirimOlayi;
  /** Tekillik anahtarının olay önekinden sonraki parçaları (kayıt kimliği, dönem…). */
  readonly keyParts: readonly (string | number)[];
  /** Satıcı kaydının id'si (kurulum.id); kurulumsuz olayda null — ad/lisans no alanları boş kalır. */
  readonly installationDbId: string | null;
  readonly relatedId?: string | null;
  readonly portalPath: string;
  readonly konu?: string | null;
  readonly referans?: string | null;
  readonly tarih?: Date | null;
}

type Labels = Pick<NotificationBodyInput, "musteri" | "tesis" | "kurulum" | "lisansNo" | "sinif">;

/** Kurulumun ETİKETLERİ (müşteri · tesis · kurulum adı · lisans no · sınıf) — başka hiçbir alan okunmaz. */
async function installationLabels(tx: Tx, installationDbId: string): Promise<Labels> {
  const k = await tx.kurulum.findUnique({
    where: { id: installationDbId },
    select: {
      ad: true,
      kurulumId: true,
      sinif: true,
      tesis: { select: { ad: true, musteri: { select: { ad: true } } } },
      haklar: { where: { aktif: true }, select: { lisansNo: true }, take: 1 },
    },
  });
  if (!k) return {};
  return { musteri: k.tesis.musteri.ad, tesis: k.tesis.ad, kurulum: k.ad ?? k.kurulumId.slice(0, 8), lisansNo: k.haklar[0]?.lisansNo ?? null, sinif: k.sinif };
}

/** Olay × her kanal için satır (varsa dokunmaz). Dönüş: yeni yazılan satır sayısı. */
export async function enqueueNotificationTx(tx: Tx, g: EnqueueInput): Promise<number> {
  const labels = g.installationDbId ? await installationLabels(tx, g.installationDbId) : {};
  const govde = notificationBody({ ...labels, konu: g.konu, referans: g.referans, tarih: g.tarih, portalYolu: g.portalPath });
  const tekillikAnahtari = dedupeKey(g.event, ...g.keyParts);
  const r = await tx.bildirim.createMany({
    data: NOTIFICATION_CHANNELS.map((kanal) => ({
      olay: g.event,
      kanal,
      tekillikAnahtari,
      kurulumId: g.installationDbId,
      ilgiliKayit: g.relatedId ?? null,
      govde,
    })),
    skipDuplicates: true,
  });
  return r.count;
}
