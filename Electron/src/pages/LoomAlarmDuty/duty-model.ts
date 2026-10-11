// Alarm sorumluları ekranının saf katmanı — ızgara, etiketler, form doğrulaması (React'siz; test burada).
import type { DutyOverride, DutyRef, DutyResponsible, DutyRule, DutyRuleKind, DutyShiftRef, DutyTier, RuleBody } from "./types";

export const DUTY_TIERS: readonly DutyTier[] = [1, 2];

export const RULE_KIND_LABEL: Readonly<Record<DutyRuleKind, string>> = {
  HALL_SHIFT: "Holün vardiya sorumlusu",
  USER: "Belirli kişi",
  PERMISSION: "Belirli yetkiye sahip herkes",
};

export interface DutyCell {
  shift: DutyShiftRef;
  byTier: Record<DutyTier, DutyResponsible[]>;
}

export interface DutyGridRow {
  hall: DutyRef;
  cells: DutyCell[];
}

/** Listede olmayan ama ataması duran hol/vardiya da çizilir — atama sessizce gözden kaybolmaz. */
function withAssigned<T extends { id: string }>(base: readonly T[], extra: readonly T[]): T[] {
  const seen = new Set(base.map((x) => x.id));
  const out = [...base];
  for (const x of extra) {
    if (!seen.has(x.id)) {
      seen.add(x.id);
      out.push(x);
    }
  }
  return out;
}

export function buildDutyGrid(halls: readonly DutyRef[], shifts: readonly DutyShiftRef[], responsibles: readonly DutyResponsible[]): {
  shifts: DutyShiftRef[];
  rows: DutyGridRow[];
} {
  const allShifts = withAssigned(shifts, responsibles.map((r) => r.shiftDefinition));
  const allHalls = withAssigned(halls, responsibles.map((r) => r.station));
  const rows = allHalls.map((hall) => ({
    hall,
    cells: allShifts.map((shift) => {
      const mine = responsibles.filter((r) => r.station.id === hall.id && r.shiftDefinition.id === shift.id);
      return { shift, byTier: { 1: mine.filter((r) => r.tier === 1), 2: mine.filter((r) => r.tier === 2) } };
    }),
  }));
  return { shifts: allShifts, rows };
}

/** Bitmiş vardiyanın değişikliği salt-okunur geçmiştir (backend de yazmaz/kaldırmaz). */
export function splitOverrides(overrides: readonly DutyOverride[]): { upcoming: DutyOverride[]; past: DutyOverride[] } {
  return {
    upcoming: overrides.filter((o) => !o.shiftInstance.ended),
    past: overrides.filter((o) => o.shiftInstance.ended),
  };
}

export function ruleTarget(rule: DutyRule): string {
  if (rule.kind === "USER") return rule.user?.name ?? "—";
  if (rule.kind === "PERMISSION") return rule.permissionCode ?? "—";
  return "Hol × vardiya tablosundaki sorumlu";
}

/** Kademede kural yoksa örtük kural çalışır (backend `resolveAlarmRecipients`). */
export function tierRulesSummary(rules: readonly DutyRule[], tier: DutyTier): string | null {
  return rules.some((r) => r.tier === tier) ? null : "Kural yok — holün vardiya sorumlusuna gider; o da yoksa yetkisi olan herkese.";
}

/** Kural formu doğrulaması — backend `DUTY_RULE_INVALID` ile aynı ölçüt; null = geçerli. */
export function ruleBodyError(body: RuleBody): string | null {
  if (body.kind === "USER" && !body.userId) return "Kişi seçin.";
  if (body.kind === "PERMISSION" && !body.permissionCode) return "Yetki seçin.";
  return null;
}

export function shiftWindowLabel(i: { shiftDefinition: DutyShiftRef; factoryDayKey: string }): string {
  const [y, m, d] = i.factoryDayKey.slice(0, 10).split("-");
  return `${d}.${m}.${y} · ${i.shiftDefinition.name}`;
}

/** Türün almadığı alan gövdeye girmez (backend "bu kural türü kişi almaz" der). */
export function toRuleBody(f: { tier: DutyTier; kind: DutyRuleKind; userId: string | null; permissionCode: string | null }): RuleBody {
  return {
    tier: f.tier,
    kind: f.kind,
    userId: f.kind === "USER" ? f.userId : null,
    permissionCode: f.kind === "PERMISSION" ? f.permissionCode : null,
  };
}


export interface PersonOption { id: string; label: string; subLabel: string | null; warning: string | null }

/** Aday kişi → seçici satırı (alarmı göremeyen seçilebilir ama uyarılır; backend de uyarır). */
export function personOptions(cands: readonly { id: string; name: string; canViewAlarms: boolean; canEscalate: boolean }[]): PersonOption[] {
  return cands.map((c) => ({
    id: c.id,
    label: c.name,
    subLabel: c.canEscalate ? "Üst kademe yetkisi var" : null,
    warning: c.canViewAlarms ? null : "Alarmları görme yetkisi yok — bildirim gitmez",
  }));
}
