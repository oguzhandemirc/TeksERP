// Alarm sorumluları — backend `loom-alarm-duty.service.ts` DTO aynası (`/api/loom-alarm-duty`).
export type DutyTier = 1 | 2;
export type DutyRuleKind = "HALL_SHIFT" | "USER" | "PERMISSION";

export interface DutyPerson {
  id: string;
  name: string;
  /** Alarm görme yetkisi (`loom:alarm-view` ya da mobil Uyarılar; sunucunun tek listesi) yoksa bildirim gitmez — ekranda uyarı. */
  canViewAlarms: boolean;
}

export interface DutyRef {
  id: string;
  name: string;
}

export interface DutyShiftRef {
  id: string;
  code: string;
  name: string;
}

export interface DutyResponsible {
  id: string;
  tier: number;
  createdAt: string;
  station: DutyRef;
  shiftDefinition: DutyShiftRef;
  user: DutyPerson;
}

export interface DutyShiftInstance {
  id: string;
  factoryDayKey: string;
  startsAt: string;
  endsAt: string;
  isCancelled: boolean;
  ended: boolean;
  shiftDefinition: DutyShiftRef;
}

export interface DutyOverride {
  id: string;
  tier: number;
  note: string | null;
  createdAt: string;
  shiftInstance: DutyShiftInstance;
  station: DutyRef;
  user: DutyPerson;
}

export interface DutyRule {
  id: string;
  tier: number;
  kind: DutyRuleKind;
  permissionCode: string | null;
  createdAt: string;
  user: DutyPerson | null;
}

export interface DutyOverview {
  responsibles: DutyResponsible[];
  overrides: DutyOverride[];
  rules: DutyRule[];
  warnings: string[];
}

export interface DutyCandidate {
  id: string;
  name: string;
  canViewAlarms: boolean;
  canEscalate: boolean;
}

export interface DutyPermissionOption {
  code: string;
  description: string;
}

/** Ekranın başvuru verisi — hol (dokuma istasyonu), aktif vardiya tanımı, yetki kataloğu (tek uçtan; ayrı izin istemez). */
export interface DutyOptions {
  halls: DutyRef[];
  shifts: DutyShiftRef[];
  permissions: DutyPermissionOption[];
}

export interface ResponsibleBody { stationId: string; shiftDefinitionId: string; tier: DutyTier; userId: string }
export interface OverrideBody { shiftInstanceId: string; stationId: string; tier: DutyTier; userId: string; note: string | null }
export interface RuleBody { tier: DutyTier; kind: DutyRuleKind; userId: string | null; permissionCode: string | null }
