// =============================================================================
// KAYIT TAKİBİ UÇLARI — `takip/:tur/:id` GET/PUT/DELETE (plan §5.3, §5.6 F4)
// =============================================================================
// Kayıt görülemiyorsa (izin/modül/yok) 404: varlık sızdırılmaz. Bırakmak durum geçişidir (silme yok),
// böylece oluşturan otomatiği (`followAsCreatorTx`, DO NOTHING) bir daha ezmez.
// =============================================================================
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { readDokumaEnabled } from "./system-setting.service";
import { followTargetOf, type FollowTarget } from "./helpers/record-follow.helper";
import type { PreferenceViewer } from "./notification-preference.service";

export const FOLLOW_KINDS = ["siparis", "is-emri", "dokuma-isi"] as const;
export type FollowKind = (typeof FOLLOW_KINDS)[number];

// Kod listeleri ayrı sabitlerde: izin kataloğu bekçisi sabitteki dizeleri okur (tür anahtarları izin değildir).
const ORDER_FOLLOW_PERMISSIONS = ["order:read"] as const;
const WORK_ORDER_FOLLOW_PERMISSIONS = ["workorder:read", "mobile:fason-sevk", "mobile:hizli-is-emri"] as const;
const WEAVING_FOLLOW_PERMISSIONS = ["weavingorder:read"] as const;
const FOLLOW_PERMISSIONS: Record<FollowKind, readonly string[]> = {
  siparis: ORDER_FOLLOW_PERMISSIONS,
  "is-emri": WORK_ORDER_FOLLOW_PERMISSIONS,
  "dokuma-isi": WEAVING_FOLLOW_PERMISSIONS,
};

/** Kayıt görülemiyorsa (izin/modül/yok) 404 — varlığı sızdırılmaz. */
async function followTargetFor(v: PreferenceViewer, rawKind: string, rawId: string): Promise<FollowTarget> {
  const notFound = () => AppError.notFound("Kayıt bulunamadı.", { code: "FOLLOW_TARGET_NOT_FOUND" });
  if (!(FOLLOW_KINDS as readonly string[]).includes(rawKind)) {
    throw AppError.badRequest("Takip türü: siparis · is-emri · dokuma-isi.", { code: "FOLLOW_KIND_INVALID" });
  }
  if (!z.string().uuid().safeParse(rawId).success) throw AppError.badRequest("Geçersiz kayıt kimliği.", { code: "INVALID_UUID" });
  const kind = rawKind as FollowKind;
  if (!FOLLOW_PERMISSIONS[kind].some((c) => matchesPermission([...v.permissions], c))) throw notFound();
  let exists: { id: string } | null;
  if (kind === "siparis") exists = await prisma.order.findUnique({ where: { id: rawId }, select: { id: true } });
  else if (kind === "is-emri") exists = await prisma.workOrder.findUnique({ where: { id: rawId }, select: { id: true } });
  else {
    if (!(await readDokumaEnabled())) throw notFound();
    exists = await prisma.weavingOrder.findUnique({ where: { id: rawId }, select: { id: true } });
  }
  if (!exists) throw notFound();
  return kind === "siparis" ? { orderId: rawId } : kind === "is-emri" ? { workOrderId: rawId } : { weavingOrderId: rawId };
}

function followWhere(userId: string, t: FollowTarget): Prisma.RecordFollowWhereInput {
  const { column, id } = followTargetOf(t);
  return { userId, [column]: id };
}

async function followState(userId: string, t: FollowTarget) {
  const row = await prisma.recordFollow.findFirst({ where: followWhere(userId, t), select: { state: true, reason: true } });
  return { takip: row?.state === "TAKIP", durum: row?.state ?? null, neden: row?.reason ?? null };
}

export async function getFollow(v: PreferenceViewer, kind: string, id: string) {
  return followState(v.userId, await followTargetFor(v, kind, id));
}

/** Elle takip: satır yoksa TAKIP/ELLE doğar, BIRAKTI ise TAKIP'e döner (atomik; yarışan ikinci istek etkisiz). */
export async function putFollow(v: PreferenceViewer, kind: string, id: string) {
  const t = await followTargetFor(v, kind, id);
  const { column } = followTargetOf(t);
  const resumed = await prisma.recordFollow.updateMany({ where: { ...followWhere(v.userId, t), state: "BIRAKTI" }, data: { state: "TAKIP", reason: "ELLE" } });
  if (resumed.count === 0) {
    const col = Prisma.raw(`"${column}"`);
    await prisma.$executeRaw`
      INSERT INTO record_follows (id, "userId", ${col}, state, reason, "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${v.userId}::uuid, ${followTargetOf(t).id}::uuid, 'TAKIP', 'ELLE', now(), now()) -- tz-ok: record_follows zaman kolonları timestamptz, çıplak now() mutlak anı yazar
      ON CONFLICT ("userId", ${col}) WHERE ${col} IS NOT NULL DO NOTHING`;
  }
  return followState(v.userId, t);
}

/** Bırak = durum geçişi TAKIP → BIRAKTI (silinmez: oluşturan otomatiği bir daha ezmez). */
export async function deleteFollow(v: PreferenceViewer, kind: string, id: string) {
  const t = await followTargetFor(v, kind, id);
  await prisma.recordFollow.updateMany({ where: { ...followWhere(v.userId, t), state: "TAKIP" }, data: { state: "BIRAKTI" } });
  return followState(v.userId, t);
}
