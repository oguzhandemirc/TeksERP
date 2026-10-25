// =============================================================================
// BİLDİRİM YAZICISI — `notification_outbox`un TEK yazarı (plan §3.1, §3.6, §3.7)
// =============================================================================
// İş işleminin tx'inde çağrılır: rollback → bildirim de yok; token replay iş kaydını yeniden
// yaratmadığı için emit de tekrarlanmaz. Bayrak (`bildirim.gelenKutusuEnabled`) kapalıyken
// no-op: tek satır okunur, hiçbir şey yazılmaz (bugünkü davranış bayt-eşit).
// Dağıtıcıyı dürtme COMMIT SONRASIdır: `pg_notify` yalnız commit'te teslim edilir (rollback'te
// hiç gitmez); dağıtıcının LISTEN bağlantısı onu birleştiriciye çevirir, kaçarsa 5 sn süpürme alır.
// AST bekçisi `test_bildirim_tek_kaynak`: outbox'a INSERT yalnız bu dosyadadır.
// =============================================================================
import type { Prisma } from "@prisma/client";
import {
  getNotificationEntry,
  NOTIFICATION_CATALOG,
  type NotificationKind,
  type NotificationPhase,
} from "../../constants/notification-catalog";
import { readNotificationInboxEnabled } from "../system-setting.service";
import { uyari } from "../../lib/logger";

/** LISTEN/NOTIFY kanalı — dağıtıcı (jobs/notification-dispatch.job.ts) aynı adı dinler. */
export const NOTIFICATION_NOTIFY_CHANNEL = "tekserp_bildirim";

const SUBJECT_KEY_MAX = 160;
const DEDUPE_KEY_MAX = 200;
const SUBJECT_TYPE_MAX = 32;

export type EmitDb = Pick<Prisma.TransactionClient, "notificationOutbox" | "systemSetting" | "$executeRaw">;

export interface NotificationSubject {
  /** Konu türü (`order`, `work_order`, `system`…); görüntü/derin bağlantı için. */
  type: string;
  /** Konunun UUID'si (polimorfik, FK'sız); sistem koşullarında yok. */
  id?: string | null;
  /** Konunun kimliği (koşulda `notification_conditions.subjectKey`). */
  key: string;
}

export interface EmitOptions {
  actorUserId?: string | null;
  /** Varsayılan: OLAY türünde `OLAY`, KOSUL türünde `ACILDI`, ALARM'da `OLAY`. */
  phase?: NotificationPhase;
  conditionId?: string | null;
}

/**
 * Katalog `tekilKalibi`ni payload'dan doldurur → birleştirme anahtarı `<kind>:<kalıp>`.
 * Kalıbın bir alanı eksikse konu kimliğine düşer: eksik alan farklı konuları TEK satırda
 * birleştirmesin (sahte birleşme, kaybolan bildirim demektir).
 */
/** Plan sözleşmesi `(tx, kind, subject, payload, opts?)` — çağrı biçimi değişmesin diye adlı demet (max-params 4). */
export type EmitArgs = [
  tx: EmitDb,
  kind: NotificationKind,
  subject: NotificationSubject,
  payload: Record<string, unknown>,
  opts?: EmitOptions,
];

export function notificationDedupeKey(
  kind: NotificationKind,
  subjectKey: string,
  payload: Record<string, unknown>,
): string {
  const kalip = getNotificationEntry(kind).tekilKalibi;
  let eksik = false;
  const dolu = kalip.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, ad: string) => {
    const v = payload[ad];
    if ((typeof v === "string" && v.trim() !== "") || (typeof v === "number" && Number.isFinite(v))) return String(v);
    eksik = true;
    return "";
  });
  const body = eksik ? subjectKey : dolu;
  return `${kind}:${body}`.slice(0, DEDUPE_KEY_MAX);
}

/**
 * Outbox satırı yazar (aynı tx). Döner: yazılan satırın id'si; bayrak kapalıysa `null`.
 * INSERT düşerse iş tx'i de düşer — bu yüzden yazım yalnız küçük bir INSERT'tir ve `kind`de CHECK yoktur.
 */
export async function emitNotification(...args: EmitArgs): Promise<string | null> {
  const [tx, kind, subject, payload, opts = {}] = args;
  if (!(await readNotificationInboxEnabled(tx))) return null;
  const entry = NOTIFICATION_CATALOG[kind];
  if (!entry) {
    // Tip sistemi dışından gelen tür (ham dize): iş işlemini düşürme, iz bırak.
    uyari("bildirim", `katalog dışı tür yazılmadı: ${String(kind)}`);
    return null;
  }
  const phase: NotificationPhase = opts.phase ?? (entry.altTur === "KOSUL" ? "ACILDI" : "OLAY");
  const subjectKey = subject.key.slice(0, SUBJECT_KEY_MAX);
  const row = await tx.notificationOutbox.create({
    data: {
      kind,
      phase,
      subjectType: subject.type.slice(0, SUBJECT_TYPE_MAX),
      subjectId: subject.id ?? null,
      subjectKey,
      conditionId: opts.conditionId ?? null,
      actorUserId: opts.actorUserId ?? null,
      payload: payload as Prisma.InputJsonValue,
      dedupeKey: notificationDedupeKey(kind, subjectKey, payload),
    },
    select: { id: true },
  });
  await tx.$executeRaw`SELECT pg_notify(${NOTIFICATION_NOTIFY_CHANNEL}, '')`;
  return row.id;
}
