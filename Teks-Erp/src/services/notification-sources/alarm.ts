// =============================================================================
// TEZGAH ALARMI → BİLDİRİM KANALI (plan §3.11, N2-ALARM)
// =============================================================================
// Alarm motorunun yazıcıları (`loom-alarm.service.ts`) olayı AYNI tx'te outbox'a bırakır; alarmın kendi
// tabloları ve kademe motoru değişmez. Dağıtıcı ALARM yolunda alıcıyı YENİDEN ÇÖZMEZ: RAISED satırına
// donmuş liste (`LoomAlarmRecipient`) okunur; kip BY_PERMISSION ise "izni olan herkes" bugünkü davranıştır.
// İki yolda da görme süzgeciyle KESİŞİM uygulanır (liste yetki genişletmez); aktör düşmez (ALARM istisnası).
// `reason` nöbeti taşır: HALL_SHIFT/DUTY_OVERRIDE/USER → NOBET, PERMISSION ve BY_PERMISSION → ALARM_ALICISI.
// =============================================================================
import { LoomAlarmEventKind, LoomAlarmRecipientMode, LoomAlarmRecipientSource, type LoomAlarmKind, type Prisma } from "@prisma/client";
import type { NotificationPhase } from "../../constants/notification-catalog";
import { emitNotification } from "../helpers/notification-emit.helper";
import { visibleUsersFor } from "../helpers/notification-visibility.helper";
import { readNotificationInboxEnabled } from "../system-setting.service";
import { registerRecipientResolver, type InboxReason, type RecipientResolver } from "../notification-dispatch.service";

type Tx = Prisma.TransactionClient;

export const LOOM_ALARM_NOTIFICATION_KIND = "dokuma.tezgah-alarmi" as const;

/** Alarm türünün görüntü adı (panel `audit-labels.ts` ile aynı metin). */
const ALARM_KIND_LABEL: Record<LoomAlarmKind, string> = { STOP_OVERDUE: "Duruş hedefi aşıldı" };

/** Donmuş kaynak → gelen kutusu sebebi (Karar Y2: sessiz saat kararı N4-MOTOR'da bundan verilir). */
export const RECIPIENT_SOURCE_REASON: Record<LoomAlarmRecipientSource, InboxReason> = {
  [LoomAlarmRecipientSource.HALL_SHIFT]: "NOBET",
  [LoomAlarmRecipientSource.DUTY_OVERRIDE]: "NOBET",
  [LoomAlarmRecipientSource.USER]: "NOBET",
  [LoomAlarmRecipientSource.PERMISSION]: "ALARM_ALICISI",
};

/** Durumu değiştiren kişi olayları (not ekleme/geri çekme alarmın durumunu değiştirmez → yayılmaz). */
const STATE_ACTOR_EVENTS: ReadonlySet<LoomAlarmEventKind> = new Set([
  LoomAlarmEventKind.ACK, LoomAlarmEventKind.ACK_RELEASE, LoomAlarmEventKind.SNOOZE, LoomAlarmEventKind.UNSNOOZE,
]);

/**
 * Defter satırı yazıldıktan sonra (aynı tx) olayın bildirim evresi: RAISED → OLAY · RESOLVED/CANCELLED →
 * KAPANDI · üstlen/bırak/sustur/kaldır → GUNCELLENDI · diğerleri (kademe atlaması, not) bildirim değildir.
 */
export async function emitForAlarmEventTx(
  tx: Tx,
  alarmId: string,
  ev: { kind: LoomAlarmEventKind; id?: string; userId?: string | null },
): Promise<void> {
  if (ev.kind === LoomAlarmEventKind.RAISED) return emitLoomAlarmNotificationTx(tx, alarmId, { phase: "OLAY", raisedEventId: ev.id });
  if (ev.kind === LoomAlarmEventKind.RESOLVED || ev.kind === LoomAlarmEventKind.CANCELLED) return emitLoomAlarmNotificationTx(tx, alarmId, { phase: "KAPANDI" });
  if (STATE_ACTOR_EVENTS.has(ev.kind)) return emitLoomAlarmNotificationTx(tx, alarmId, { phase: "GUNCELLENDI", actorUserId: ev.userId ?? null });
}

/**
 * Alarm olayını aynı tx'te outbox'a bırakır. Bayrak kapalıyken hiçbir okuma yapılmaz (tek ayar okuması),
 * yani alarm tx'inin sorgu dizisi bugünküyle aynı kalır. `olayId` = RAISED satırı → dağıtıcı donmuş listeyi okur.
 */
export async function emitLoomAlarmNotificationTx(
  tx: Tx,
  alarmId: string,
  o: { phase: NotificationPhase; raisedEventId?: string; actorUserId?: string | null },
): Promise<void> {
  if (!(await readNotificationInboxEnabled(tx))) return;
  const a = await tx.loomAlarm.findUniqueOrThrow({
    where: { id: alarmId },
    select: { kind: true, tier: true, state: true, snoozedUntil: true, machine: { select: { code: true, name: true, station: { select: { name: true } } } } },
  });
  const payload: Record<string, unknown> = {
    alarmId,
    tezgahNo: a.machine.code,
    alarmAd: ALARM_KIND_LABEL[a.kind],
    salonAd: a.machine.station.name,
    kademe: a.tier,
    durum: a.state,
    susturmaBitis: a.snoozedUntil?.toISOString() ?? null,
    ...(o.raisedEventId ? { olayId: o.raisedEventId } : {}),
  };
  // Tür literal: AST bekçisi (`test_bildirim_patron_siparisi` §0) yayma noktasını türüyle sayar.
  await emitNotification(tx, "dokuma.tezgah-alarmi", { type: "loom_alarm", id: alarmId, key: alarmId }, payload, {
    phase: o.phase,
    actorUserId: o.actorUserId ?? null,
  });
}

/** Outbox satırının RAISED olayı: payload `olayId`; yoksa (eski satır) alarmın o ana kadarki son RAISED'ı. */
async function raisedEventOf(tx: Tx, alarmId: string, payload: unknown, at: Date) {
  const olayId = (payload as { olayId?: unknown } | null)?.olayId;
  const select = { id: true, recipientMode: true, recipients: { select: { userId: true, source: true } } } as const;
  if (typeof olayId === "string") {
    return tx.loomAlarmEvent.findFirst({ where: { id: olayId, alarmId, kind: LoomAlarmEventKind.RAISED }, select });
  }
  return tx.loomAlarmEvent.findFirst({
    where: { alarmId, kind: LoomAlarmEventKind.RAISED, createdAt: { lte: at } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select,
  });
}

/** ALARM alıcı çözücüsü: DONMUŞ liste ∩ görme süzgeci. Aktör düşmez. */
export const resolveLoomAlarmRecipients: RecipientResolver = async (ctx) => {
  const alarmId = ctx.row.subjectId;
  if (!alarmId) return [];
  const ev = await raisedEventOf(ctx.tx, alarmId, ctx.row.payload, ctx.row.occurredAt);
  if (!ev) return [];
  const visible = new Set(ctx.grants.size === 0 ? [] : await visibleUsersFor(ctx.tx, ctx.kind, ctx.env, { grants: ctx.grants }));
  if (ev.recipientMode === LoomAlarmRecipientMode.LISTED) {
    // Aynı kullanıcı iki kaynaktan donmuşsa nöbet kazanır (sessiz saat onu bastırmamalı).
    const best = new Map<string, InboxReason>();
    for (const r of ev.recipients) {
      if (!visible.has(r.userId)) continue;
      const reason = RECIPIENT_SOURCE_REASON[r.source];
      if (best.get(r.userId) !== "NOBET") best.set(r.userId, reason);
    }
    return [...best].map(([userId, reason]) => ({ userId, reason }));
  }
  return [...visible].map((userId) => ({ userId, reason: "ALARM_ALICISI" as const }));
};

/** Dağıtıcıya kayıt (iş başlarken ve bekçide; tekrar çağrı zararsız). */
export function registerLoomAlarmRecipientResolver(): void {
  registerRecipientResolver(LOOM_ALARM_NOTIFICATION_KIND, resolveLoomAlarmRecipients);
}
