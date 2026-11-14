// =============================================================================
// Patron push bulut turu — yerel durumu buluttaki bağa eşler (giden iş kuyruğu; harici yoklama DEĞİL)
// =============================================================================
// Sıra: süpürme (yerel, her tur) → kapı (iki bayrak) kapalı ya da kurulum uygun değilse DUR (dışarı istek YOK; canlı dürt
// ATLANDI) → BEKLIYOR partisi `kaydet` → BIRAKILACAK partisi `birak` → dürt (`nudge-round.ts`). Sonuç yalnız satır hâlâ beklenen durumdaysa yazılır (koşullu
// updateMany): arada çıkış yapılırsa `kaydet`in başarısı satırı KAYITLI yapmaz, sonraki tur bırakır. Hata kullanıcı
// isteğine dokunmaz: satır başına geri çekilme (30 sn × 2^n, ≤ 1 sa) + kısa hata kodu; ham belirteç gövdeye girmez.
// =============================================================================
import prisma from "../../lib/prisma";
import { egressCloudTransport, type CloudCallContext, type CloudTransport } from "../../cloud-sync/cloud-client";
import { pushBridgeEligibility, type PushBridgeEligibility } from "../../cloud-sync/eligibility";
import { registerDigests, releaseDigests, type BridgeResult } from "../../cloud-sync/push-bridge-client";
import { PUSH_BRIDGE_MAX_TOKENS, PUSH_DEFAULT_SOUND, PushSoundSchema, type PushTokenSoundsSchema } from "../../cloud-sync/wire";
import type { z } from "zod";

type PushTokenSounds = z.infer<typeof PushTokenSoundsSchema>;
import { releaseOrphanPushTokens } from "./lifecycle";
import { patronPushGateOpen } from "./device.service";
import { pushBackoffMs } from "./states";
import { runNudgePhase, skipLiveNudges, type NudgeRoundSummary } from "./nudge-round";


export interface PushRoundDeps {
  readonly now?: Date;
  /** Test enjeksiyonu: sahte taşıyıcı (gerçek bulut/Expo çağrısı YOK). */
  readonly transport?: CloudTransport;
  /** Test enjeksiyonu: uygunluk kararı (varsayılan canlı lisans anlık görüntüsü). */
  readonly eligibility?: () => PushBridgeEligibility;
}

export type PushRoundSummary =
  | { readonly durum: "KAPALI" | "UYGUN_DEGIL"; readonly sebep?: string; readonly suprulen: number; readonly atlananDurt: number }
  | { readonly durum: "TAMAM"; readonly suprulen: number; readonly kaydedilen: number; readonly birakilan: number; readonly hata: number; readonly durt: NudgeRoundSummary };

type Phase = { from: "BEKLIYOR"; to: "KAYITLI" } | { from: "BIRAKILACAK"; to: "BIRAKILDI" };

interface DueRow {
  id: string;
  tokenDigest: string;
  attempts: number;
  soundNotification: string;
  soundAlarm: string;
}

async function dueBatch(state: Phase["from"], now: Date): Promise<DueRow[]> {
  return prisma.patronPushToken.findMany({
    where: { cloudState: state, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: PUSH_BRIDGE_MAX_TOKENS,
    select: { id: true, tokenDigest: true, attempts: true, soundNotification: true, soundAlarm: true },
  });
}

/**
 * `kaydet`in `sesler`i (S0): yalnız varsayılandan SAPAN satırlar — bulut olmayan özeti varsayılana kurar. Hepsi
 * varsayılansa alan hiç gitmez (sesi bilmeyen eski bulut katı şemayla 400'lemesin). Küme dışı değer (CHECK önler) atlanır.
 */
export function registerSounds(rows: readonly Pick<DueRow, "tokenDigest" | "soundNotification" | "soundAlarm">[]): PushTokenSounds[] | undefined {
  const out = rows.flatMap((r) => {
    const bildirim = PushSoundSchema.safeParse(r.soundNotification);
    const alarm = PushSoundSchema.safeParse(r.soundAlarm);
    if (!bildirim.success || !alarm.success) return [];
    if (bildirim.data === PUSH_DEFAULT_SOUND.BILDIRIM && alarm.data === PUSH_DEFAULT_SOUND.ALARM) return [];
    return [{ ozet: r.tokenDigest, bildirim: bildirim.data, alarm: alarm.data }];
  });
  return out.length > 0 ? out : undefined;
}

/** Satır başına geri çekilme; durum değiştiyse (claim tutmazsa) dokunulmaz. Parti ≤ 20 satır, sıralı yazım. */
async function backoff(rows: readonly { id: string; attempts: number }[], state: Phase["from"], code: string, now: Date): Promise<void> {
  for (const row of rows) {
    const attempts = row.attempts + 1;
    await prisma.patronPushToken.updateMany({
      where: { id: row.id, cloudState: state },
      data: { attempts, nextAttemptAt: new Date(now.getTime() + pushBackoffMs(attempts)), lastErrorCode: code.slice(0, 64) },
    });
  }
}

function mapOk<T, U>(r: BridgeResult<T>, f: (v: T) => U): BridgeResult<U> {
  return r.ok ? { ok: true, value: f(r.value) } : r;
}

async function runPhase(ctx: CloudCallContext, phase: Phase, now: Date): Promise<{ done: number; failed: number }> {
  const rows = await dueBatch(phase.from, now);
  if (rows.length === 0) return { done: 0, failed: 0 };
  const digests = rows.map((r) => r.tokenDigest);
  // `kaydet` yalnız bağladığı özetleri döner; dönmeyen satır başarısız sayılır (bir sonraki turda yeniden).
  const res: BridgeResult<readonly string[]> = phase.to === "KAYITLI"
    ? mapOk(await registerDigests(ctx, digests, registerSounds(rows)), (v) => v.bagli)
    : mapOk(await releaseDigests(ctx, digests), () => digests);
  if (!res.ok) {
    await backoff(rows, phase.from, res.status === 0 ? res.code : `${res.status}:${res.code}`, now);
    return { done: 0, failed: rows.length };
  }
  const okSet = new Set(res.value);
  const ok = rows.filter((r) => okSet.has(r.tokenDigest));
  const done = ok.length === 0 ? 0 : (await prisma.patronPushToken.updateMany({
    where: { id: { in: ok.map((r) => r.id) }, cloudState: phase.from },
    data: { cloudState: phase.to, attempts: 0, nextAttemptAt: null, lastErrorCode: null, ...(phase.to === "BIRAKILDI" ? { releasedAt: now } : {}) },
  })).count;
  const missed = rows.filter((r) => !okSet.has(r.tokenDigest));
  if (missed.length > 0) await backoff(missed, phase.from, "BAGLANMADI", now);
  return { done, failed: missed.length };
}

/** Tek tur. İş (`jobs/patron-push.job.ts`) tek uçuşla çağırır; bekçi sahte taşıyıcıyla doğrudan çağırır. */
export async function runPatronPushRound(deps: PushRoundDeps = {}): Promise<PushRoundSummary> {
  const now = deps.now ?? new Date();
  const suprulen = await releaseOrphanPushTokens(now);
  // Kapı/uygunluk yokken dürt kuyruğu BEKLEMEZ: canlı satırlar ATLANDI (birikme yok, dışarı istek yok).
  if (!(await patronPushGateOpen())) return { durum: "KAPALI", suprulen, atlananDurt: await skipLiveNudges("KAPI_KAPALI", now) };
  const elig = (deps.eligibility ?? pushBridgeEligibility)();
  if (!elig.ok) return { durum: "UYGUN_DEGIL", sebep: elig.reason, suprulen, atlananDurt: await skipLiveNudges(`UYGUN_DEGIL:${elig.reason}`, now) };
  const ctx: CloudCallContext = { baseUrl: elig.baseUrl, installationId: elig.installationId, transport: deps.transport ?? egressCloudTransport };
  const reg = await runPhase(ctx, { from: "BEKLIYOR", to: "KAYITLI" }, now);
  const rel = await runPhase(ctx, { from: "BIRAKILACAK", to: "BIRAKILDI" }, now);
  // Dürt EN SONDA: aynı turda bağlanan belirteç hemen kullanılır.
  const durt = await runNudgePhase(ctx, now);
  return { durum: "TAMAM", suprulen, kaydedilen: reg.done, birakilan: rel.done, hata: reg.failed + rel.failed, durt };
}
