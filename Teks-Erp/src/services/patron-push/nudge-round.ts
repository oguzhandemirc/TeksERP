// =============================================================================
// Patron telefonu DÜRT adımı — `runPatronPushRound` turunun son adımı (giden iş kuyruğu; ikinci süreç yok)
// =============================================================================
// Kapı kapalı / kurulum uygun değil → canlı satırlar ATLANDI (dışarı istek YOK, birikme yok). Açıkken: bayat claim geri →
// 24 sa'ten eski BEKLIYOR vazgeçilir → okunmuş/çözülmüş kutunun dürtü İPTAL → hız bütçesi kadar vadesi gelen satır, her
// biri ATOMİK CLAIM (BEKLIYOR→GONDERILIYOR; count 0 = başka tur aldı). Ham belirteç yalnız istek gövdesinde yaşar; metin
// gönderim anında kutudan render edilir. Sonuç yalnız satır hâlâ GONDERILIYOR iken yazılır.
// =============================================================================
import prisma from "../../lib/prisma";
import { nudgeTokens } from "../../cloud-sync/push-bridge-client";
import type { CloudCallContext } from "../../cloud-sync/cloud-client";
import { PUSH_BRIDGE_MAX_TOKENS, PushTokenSchema } from "../../cloud-sync/wire";
import { finishData, inboxWantsNudge, NUDGE_INBOX_LIVE_WHERE, NUDGE_LIVE_STATES } from "./nudge-states";
import { applyNudgeResult, type NudgeDecision } from "./nudge-outcome";
import { buildNudgeBody, isNotificationKind } from "./nudge-payload";
import { noteNudgeSent, nudgeBudget, pauseNudges } from "./nudge-rate";
import { LIVE_STATES, pushBackoffMs } from "./states";
import { openPushToken } from "./token-seal";
import { loadNotificationVisibilityEnv, visibleUsersFor } from "../helpers/notification-visibility.helper";

/** Bir dürt bu süreden sonra gönderilmez (bayat bildirim telefonu yanıltır). */
export const NUDGE_GIVE_UP_MS = 24 * 60 * 60 * 1000;
/** GONDERILIYOR'da kalan (süreç düştü) satır bu süreden sonra yeniden sıraya girer; bulut aynı kimliği yinelemez. */
const STALE_CLAIM_MS = 5 * 60_000;
/** Tur başına en çok dürt (hız bütçesinin yarısı: 30 sn'lik turda dakikalık tavan aşılmaz). */
const ROUND_MAX = 60;

export interface NudgeRoundSummary {
  gonderilen: number;
  tekrar: number;
  iptal: number;
  atlanan: number;
  vazgecilen: number;
  /** Hız bütçesi yüzünden bu turda gönderilmeyip sırada kalan vadesi gelmiş satır. */
  sirada: number;
  /** Tur erken durduysa (lisans 401/403 · hız 429) kısa kod. */
  durdu?: string;
}

const emptySummary = (): NudgeRoundSummary => ({ gonderilen: 0, tekrar: 0, iptal: 0, atlanan: 0, vazgecilen: 0, sirada: 0 });

/** Kapı kapalı ya da kurulum uygun değil: canlı satırlar beklemez, ATLANDI olarak kapanır. */
export async function skipLiveNudges(code: string, now: Date): Promise<number> {
  const r = await prisma.patronPushNudge.updateMany({ where: { state: { in: [...NUDGE_LIVE_STATES] } }, data: finishData("ATLANDI", code, now) });
  return r.count;
}

async function housekeeping(now: Date, s: NudgeRoundSummary): Promise<void> {
  await prisma.patronPushNudge.updateMany({
    where: { state: "GONDERILIYOR", claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
    data: { state: "BEKLIYOR", claimedAt: null },
  });
  s.vazgecilen += (await prisma.patronPushNudge.updateMany({
    where: { state: "BEKLIYOR", createdAt: { lt: new Date(now.getTime() - NUDGE_GIVE_UP_MS) } },
    data: finishData("VAZGECILDI", "SURE_DOLDU", now),
  })).count;
  s.iptal += (await prisma.patronPushNudge.updateMany({
    where: { state: "BEKLIYOR", inbox: { isNot: NUDGE_INBOX_LIVE_WHERE } },
    data: finishData("IPTAL", "OKUNDU", now),
  })).count;
}

/** Satırın kararını yazar (yalnız hâlâ GONDERILIYOR ise). */
async function settle(row: { id: string; attempts: number }, d: NudgeDecision, now: Date, s: NudgeRoundSummary): Promise<void> {
  const where = { id: row.id, state: "GONDERILIYOR" };
  if (d.kind === "FINISH") {
    const n = (await prisma.patronPushNudge.updateMany({ where, data: finishData(d.state, d.code, now) })).count;
    if (d.state === "GONDERILDI") s.gonderilen += n;
    else if (d.state === "ATLANDI") s.atlanan += n;
    else s.vazgecilen += n;
    return;
  }
  const attempts = d.kind === "RETRY" ? row.attempts + 1 : row.attempts;
  const delay = d.kind === "RETRY" ? pushBackoffMs(attempts) : d.delayMs;
  await prisma.patronPushNudge.updateMany({
    where,
    data: { state: "BEKLIYOR", claimedAt: null, attempts, nextAttemptAt: new Date(now.getTime() + delay), lastErrorCode: d.code },
  });
  s.tekrar += 1;
}

/** Claim edilmiş tek satır: kutu → belirteçler → gövde → köprü → karar. */
async function sendOne(ctx: CloudCallContext, row: { id: string; inboxId: string }, now: Date): Promise<NudgeDecision | "IPTAL"> {
  const inbox = await prisma.notificationInbox.findUnique({
    where: { id: row.inboxId },
    select: { id: true, userId: true, kind: true, klass: true, payload: true, readAt: true, resolvedAt: true },
  });
  if (!inbox || !inboxWantsNudge(inbox)) return "IPTAL";
  if (!isNotificationKind(inbox.kind)) return { kind: "FINISH", state: "ATLANDI", code: "BILINMEYEN_TUR" };
  // Kuyruk ile gönderim arasında izin/modül/kapı kapanmış olabilir: tam metin yalnız türü HÂLÂ görene gider.
  const env = await loadNotificationVisibilityEnv(prisma, [inbox.kind]);
  if ((await visibleUsersFor(prisma, inbox.kind, env, { userIds: [inbox.userId], at: now })).length === 0) {
    return { kind: "FINISH", state: "ATLANDI", code: "GORMEZ" };
  }
  const tokens = await prisma.patronPushToken.findMany({
    where: { userId: inbox.userId, cloudState: { in: [...LIVE_STATES] } },
    orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    take: PUSH_BRIDGE_MAX_TOKENS,
    select: { tokenDigest: true, tokenSealed: true, cloudState: true },
  });
  if (tokens.length === 0) return { kind: "FINISH", state: "ATLANDI", code: "BELIRTEC_YOK" };
  const bound = tokens.filter((t) => t.cloudState === "KAYITLI");
  // Belirteç henüz buluta bağlanmadı (aynı turun `kaydet` adımı bağlar): dürt bekler.
  if (bound.length === 0) return { kind: "RETRY", code: "BAGLANMA_BEKLENIYOR" };
  const opened: Array<{ raw: string; digest: string }> = [];
  for (const t of bound) {
    const raw = t.tokenSealed ? openPushToken(t.tokenSealed, t.tokenDigest) : null;
    if (raw && PushTokenSchema.safeParse(raw).success) opened.push({ raw, digest: t.tokenDigest });
  }
  if (opened.length === 0) return { kind: "FINISH", state: "ATLANDI", code: "BELIRTEC_ACILAMADI" };
  const body = buildNudgeBody({ id: inbox.id, kind: inbox.kind, payload: inbox.payload, klass: inbox.klass }, opened.map((o) => o.raw));
  noteNudgeSent(now.getTime());
  const res = await nudgeTokens(ctx, body);
  return applyNudgeResult(res, opened.map((o) => o.digest), now);
}

/** Dürt adımı — kapı ve uygunluk ÇAĞIRANDA (`cloud-round.service.ts`) denetlenmiştir. */
export async function runNudgePhase(ctx: CloudCallContext, now: Date): Promise<NudgeRoundSummary> {
  const s = emptySummary();
  await housekeeping(now, s);
  const dueWhere = { state: "BEKLIYOR", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] };
  const budget = Math.min(nudgeBudget(now.getTime()), ROUND_MAX);
  const due = budget === 0 ? [] : await prisma.patronPushNudge.findMany({
    where: dueWhere,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: budget,
    select: { id: true, inboxId: true, attempts: true },
  });
  for (const row of due) {
    const claimed = await prisma.patronPushNudge.updateMany({ where: { id: row.id, state: "BEKLIYOR" }, data: { state: "GONDERILIYOR", claimedAt: now } });
    if (claimed.count === 0) continue;
    const d = await sendOne(ctx, row, now);
    if (d === "IPTAL") {
      s.iptal += (await prisma.patronPushNudge.updateMany({ where: { id: row.id, state: "GONDERILIYOR" }, data: finishData("IPTAL", "OKUNDU", now) })).count;
      continue;
    }
    await settle(row, d, now, s);
    if (d.kind === "HOLD") {
      if (d.pause) pauseNudges(now.getTime() + d.delayMs);
      s.durdu = d.code;
      break;
    }
  }
  s.sirada = await prisma.patronPushNudge.count({ where: dueWhere });
  return s;
}
