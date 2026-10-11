// =============================================================================
// TEZGAH ALARMI — kademe alıcısının çözümü (A4: hol × vardiya sorumlusu, nöbet değişikliği, kademe kuralı)
// =============================================================================
// Kademe çaldığı an alıcı listesi çözülür ve RAISED satırına DONAR (`LoomAlarmRecipient`); tanımın
// sonradan değişmesi geçmiş alarmı etkilemez. Çözüm saf (`resolveAlarmRecipients`), okuma tek yerde
// (`loadRecipientConfig`). Sonuç boşsa kip BY_PERMISSION = bugünkü davranış (izni olan herkes).
// "Rol" alıcısı YETKİ kodudur: programda kalıcı rol üyeliği yok, yetki kişiye atanır.
// =============================================================================
import { LoomAlarmRecipientMode, LoomAlarmRecipientSource, LoomAlarmRuleRecipientKind, type Prisma } from "@prisma/client";
import { matchesPermission } from "../../middlewares/rbac.middleware";

type Db = Pick<Prisma.TransactionClient, "loomAlarmTierRule" | "shiftInstance" | "hallShiftResponsible" | "hallShiftDutyOverride" | "userPermission">;

/** Alarmı GÖRME hakkı veren kodlar (panel + mobil Uyarılar ikizi): uç kapısı ve alıcı uygunluğu bu TEK listeden. */
export const ALARM_VIEW_PERMISSIONS = ["loom:alarm-view", "mobile:tezgah-uyari"] as const;
export const ALARM_ESCALATION_PERMISSION = "loom:alarm-escalation";

/** Alarm yetki sorularının tek yeri (izin bekçisi bu dosyanın sabitlerini okur). Alıcı olabilmenin şartı görmektir. */
export const hasAlarmView = (codes: readonly string[]): boolean => ALARM_VIEW_PERMISSIONS.some((p) => matchesPermission([...codes], p));
export const hasAlarmEscalation = (codes: readonly string[]): boolean => matchesPermission([...codes], ALARM_ESCALATION_PERMISSION);

export interface DutyShiftWindow { id: string; shiftDefinitionId: string; startsAt: Date; endsAt: Date; isCancelled: boolean }

export interface RecipientConfig {
  rules: ReadonlyArray<{ tier: number; kind: LoomAlarmRuleRecipientKind; userId: string | null; permissionCode: string | null }>;
  /** Çalma anının nöbet pencereleri (`pickDutyShifts`). */
  shifts: ReadonlyArray<DutyShiftWindow>;
  responsibles: ReadonlyArray<{ stationId: string; shiftDefinitionId: string; tier: number; userId: string }>;
  overrides: ReadonlyArray<{ shiftInstanceId: string; stationId: string; tier: number; userId: string }>;
  /** Aktif, sistem dışı kullanıcıların o an geçerli (ilgili) yetki kodları. Haritada olmayan kullanıcı uygun değildir. */
  grants: ReadonlyMap<string, readonly string[]>;
}

export type ResolvedRecipients =
  | { mode: typeof LoomAlarmRecipientMode.BY_PERMISSION; recipients: [] }
  | { mode: typeof LoomAlarmRecipientMode.LISTED; recipients: Array<{ userId: string; source: LoomAlarmRecipientSource }> };

/** Nöbet pencereleri: anı kapsayan canlı vardiyalar; hiçbiri yoksa en son başlamış canlı vardiya. */
export function pickDutyShifts(windows: ReadonlyArray<DutyShiftWindow>, now: Date): DutyShiftWindow[] {
  const t = now.getTime();
  const live = windows.filter((w) => !w.isCancelled && w.startsAt.getTime() <= t);
  const covering = live.filter((w) => w.endsAt.getTime() > t);
  if (covering.length > 0) return covering;
  let last: DutyShiftWindow | null = null;
  for (const w of live) if (last === null || w.startsAt.getTime() > last.startsAt.getTime()) last = w;
  return last ? [last] : [];
}

function hallShiftUsers(cfg: RecipientConfig, stationId: string, tier: number): Array<{ userId: string; source: LoomAlarmRecipientSource }> {
  const out: Array<{ userId: string; source: LoomAlarmRecipientSource }> = [];
  for (const s of cfg.shifts) {
    const ov = cfg.overrides.filter((o) => o.shiftInstanceId === s.id && o.stationId === stationId && o.tier === tier);
    if (ov.length > 0) {
      for (const o of ov) out.push({ userId: o.userId, source: LoomAlarmRecipientSource.DUTY_OVERRIDE });
      continue;
    }
    for (const r of cfg.responsibles) {
      if (r.shiftDefinitionId === s.shiftDefinitionId && r.stationId === stationId && r.tier === tier) {
        out.push({ userId: r.userId, source: LoomAlarmRecipientSource.HALL_SHIFT });
      }
    }
  }
  return out;
}

/**
 * Hol × kademe için alıcılar. Kademede etkin kural yoksa örtük kural = holün vardiya sorumlusu.
 * Tekilleştirilir (ilk kaynak kalır), alarmı göremeyen düşer; liste boşsa BY_PERMISSION.
 */
export function resolveAlarmRecipients(cfg: RecipientConfig, stationId: string, tier: number): ResolvedRecipients {
  const rules = cfg.rules.filter((r) => r.tier === tier);
  const effective = rules.length > 0 ? rules : [{ tier, kind: LoomAlarmRuleRecipientKind.HALL_SHIFT, userId: null, permissionCode: null }];
  const raw: Array<{ userId: string; source: LoomAlarmRecipientSource }> = [];
  for (const rule of effective) {
    if (rule.kind === LoomAlarmRuleRecipientKind.HALL_SHIFT) raw.push(...hallShiftUsers(cfg, stationId, tier));
    else if (rule.kind === LoomAlarmRuleRecipientKind.USER && rule.userId) raw.push({ userId: rule.userId, source: LoomAlarmRecipientSource.USER });
    else if (rule.kind === LoomAlarmRuleRecipientKind.PERMISSION && rule.permissionCode) {
      const code = rule.permissionCode;
      const holders = [...cfg.grants].filter(([, codes]) => matchesPermission(codes, code)).map(([userId]) => userId).sort();
      for (const userId of holders) raw.push({ userId, source: LoomAlarmRecipientSource.PERMISSION });
    }
  }
  const seen = new Set<string>();
  const recipients: Array<{ userId: string; source: LoomAlarmRecipientSource }> = [];
  for (const r of raw) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    const codes = cfg.grants.get(r.userId);
    if (!codes || !hasAlarmView(codes)) continue;
    recipients.push(r);
  }
  return recipients.length > 0
    ? { mode: LoomAlarmRecipientMode.LISTED, recipients }
    : { mode: LoomAlarmRecipientMode.BY_PERMISSION, recipients: [] };
}

/** Bir kodu karşılayan atanabilir kodlar: kendisi, alan jokeri, genel joker (`matchesPermission` ile aynı küme). */
function codesSatisfying(code: string): string[] {
  const colon = code.indexOf(":");
  return colon > 0 ? [code, `${code.slice(0, colon)}:*`, "*"] : [code, "*"];
}

/** Aktif, sistem dışı kullanıcıların `at` anında geçerli yetkilerinden yalnız `codes`u karşılayanlar. */
export async function loadEffectiveGrants(db: Pick<Db, "userPermission">, codes: readonly string[], at: Date, userIds?: readonly string[]): Promise<Map<string, string[]>> {
  const wanted = [...new Set(codes.flatMap(codesSatisfying))];
  const rows = await db.userPermission.findMany({
    where: {
      permission: { code: { in: wanted } },
      user: { isActive: true, isSystemAccount: false },
      ...(userIds ? { userId: { in: [...userIds] } } : {}),
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: at } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: at } }] },
      ],
    },
    select: { userId: true, permission: { select: { code: true } } },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.userId) ?? [];
    list.push(r.permission.code);
    map.set(r.userId, list);
  }
  return map;
}

/** Çözümün girdisi — motor turunda ilk kademe çalarken BİR KEZ okunur. */
export async function loadRecipientConfig(db: Db, now: Date): Promise<RecipientConfig> {
  const rules = await db.loomAlarmTierRule.findMany({
    where: { revokedAt: null },
    select: { tier: true, kind: true, userId: true, permissionCode: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const shiftSelect = { id: true, shiftDefinitionId: true, startsAt: true, endsAt: true, isCancelled: true } as const;
  const covering = await db.shiftInstance.findMany({ where: { isCancelled: false, startsAt: { lte: now }, endsAt: { gt: now } }, select: shiftSelect });
  const latest = covering.length > 0 ? [] : await db.shiftInstance.findMany({
    where: { isCancelled: false, startsAt: { lte: now } }, select: shiftSelect, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: 1,
  });
  const shifts = pickDutyShifts([...covering, ...latest], now);
  const responsibles = shifts.length === 0 ? [] : await db.hallShiftResponsible.findMany({
    where: { revokedAt: null, shiftDefinitionId: { in: shifts.map((s) => s.shiftDefinitionId) } },
    select: { stationId: true, shiftDefinitionId: true, tier: true, userId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const overrides = shifts.length === 0 ? [] : await db.hallShiftDutyOverride.findMany({
    where: { revokedAt: null, shiftInstanceId: { in: shifts.map((s) => s.id) } },
    select: { shiftInstanceId: true, stationId: true, tier: true, userId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const codes = [...ALARM_VIEW_PERMISSIONS, ...rules.flatMap((r) => (r.permissionCode ? [r.permissionCode] : []))];
  const grants = await loadEffectiveGrants(db, codes, now);
  return { rules, shifts, responsibles, overrides, grants };
}

