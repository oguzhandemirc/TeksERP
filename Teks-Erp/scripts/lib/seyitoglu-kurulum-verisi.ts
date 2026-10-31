// =============================================================================
// SEYİTOĞLU KURULUM VERİSİ — SY-I1 (TASARIM-2026-10-31 §10.5, §13.5)
// =============================================================================
// Duruş kurulumu AYAR değil VERİDİR: sebep kataloğu (MACHINE_STOP), vardiya, salon.
// Ayar paketi betiği (`scripts/seyitoglu-ayar-paketi.ts`) planı buradan alır; yazım
// servisler üzerinden (doğrulama + audit), asla toplu UPDATE/DELETE değil.
// Ölçüt: var olan veriye DOKUNULMAZ — yalnız eksik olan yaratılır (VAR → atla).
// Vardiya saatleri ve salon adı fabrika teyidine kadar VARSAYIMDIR (soru S8);
// fabrikada vardiya tanımlıysa paket vardiya eklemez (çakışma uyarısı doğmasın).
// =============================================================================
import type { MachineStopLossClass } from "@prisma/client";

export type SetupAction = "CREATE" | "EXISTS" | "SKIP" | "MISSING";

export interface SetupRow {
  group: "REASON" | "REASON_CATALOG" | "SHIFT" | "HALL";
  label: string;
  action: SetupAction;
  note?: string;
}

export interface StopReasonSeed {
  label: string;
  stopLossClass: MachineStopLossClass;
}

export interface ShiftSeed {
  code: string;
  name: string;
  startMinute: number;
  durationMinutes: number;
}

/** Sistem kataloğunda (`MACHINE_STOP_REASONS`) olmayan, leventi DIŞARIDAN alan tül dokumasına özgü iki sebep. */
export const SEYITOGLU_STOP_REASONS: readonly StopReasonSeed[] = [
  { label: "Levent bekleniyor (devereci)", stopLossClass: "UNPLANNED" },
  { label: "Döner çözgü kopuşu", stopLossClass: "UNPLANNED" },
];

/** 3 × 8 saat; S8 cevabına kadar varsayım (Vardiya Tanımları ekranından düzenlenir). */
export const SEYITOGLU_SHIFTS: readonly ShiftSeed[] = [
  { code: "SY-V1", name: "Sabah (08–16)", startMinute: 8 * 60, durationMinutes: 480 },
  { code: "SY-V2", name: "Akşam (16–24)", startMinute: 16 * 60, durationMinutes: 480 },
  { code: "SY-V3", name: "Gece (00–08)", startMinute: 0, durationMinutes: 480 },
];

export const SEYITOGLU_HALL_NAME = "Dokuma Salonu";

/** SAF kısım ayrı: DB okuması `readSetupState`, karar burada (bekçi fikstürsüz ölçer). */
export interface SetupState {
  stopReasonCodes: ReadonlySet<string>;
  stopReasonLabelsFolded: ReadonlySet<string>;
  systemCatalogMissing: readonly string[];
  activeShiftCount: number;
  shiftCodes: ReadonlySet<string>;
  activeWeavingHallCount: number;
}

export function planSetup(
  state: SetupState,
  slug: (label: string) => string,
  fold: (s: string) => string,
  reasons: readonly StopReasonSeed[] = SEYITOGLU_STOP_REASONS,
  shifts: readonly ShiftSeed[] = SEYITOGLU_SHIFTS,
): SetupRow[] {
  const rows: SetupRow[] = [];
  rows.push(
    state.systemCatalogMissing.length === 0
      ? { group: "REASON_CATALOG", label: "Sistem duruş sebepleri", action: "EXISTS" }
      : {
          group: "REASON_CATALOG",
          label: "Sistem duruş sebepleri",
          action: "MISSING",
          note: `eksik ${state.systemCatalogMissing.length} kod — sunucu açılışında uzlaştırılır`,
        },
  );
  for (const r of reasons) {
    const exists = state.stopReasonCodes.has(slug(r.label)) || state.stopReasonLabelsFolded.has(fold(r.label));
    rows.push({ group: "REASON", label: r.label, action: exists ? "EXISTS" : "CREATE", note: r.stopLossClass });
  }
  for (const s of shifts) {
    if (state.shiftCodes.has(s.code)) rows.push({ group: "SHIFT", label: s.name, action: "EXISTS", note: s.code });
    else if (state.activeShiftCount > 0)
      rows.push({ group: "SHIFT", label: s.name, action: "SKIP", note: `fabrikada ${state.activeShiftCount} vardiya tanımlı` });
    else rows.push({ group: "SHIFT", label: s.name, action: "CREATE", note: s.code });
  }
  rows.push(
    state.activeWeavingHallCount > 0
      ? { group: "HALL", label: SEYITOGLU_HALL_NAME, action: "EXISTS", note: `${state.activeWeavingHallCount} dokuma salonu var` }
      : { group: "HALL", label: SEYITOGLU_HALL_NAME, action: "CREATE" },
  );
  return rows;
}

export async function readSetupState(): Promise<SetupState> {
  const { default: prisma } = await import("../../src/lib/prisma");
  const { MACHINE_STOP_REASONS } = await import("../../src/constants/reason-presets");
  const { foldNameForCompare } = await import("../../src/services/helpers/name-normalize.helper");
  const presets = await prisma.reasonPreset.findMany({ where: { kind: "MACHINE_STOP" }, select: { code: true, label: true } });
  const codes = new Set(presets.map((p) => p.code));
  const shiftRows = await prisma.shiftDefinition.findMany({ select: { code: true, isActive: true } });
  return {
    stopReasonCodes: codes,
    stopReasonLabelsFolded: new Set(presets.map((p) => foldNameForCompare(p.label))),
    systemCatalogMissing: MACHINE_STOP_REASONS.map((r) => r.code).filter((c) => !codes.has(c)),
    activeShiftCount: shiftRows.filter((s) => s.isActive).length,
    shiftCodes: new Set(shiftRows.map((s) => s.code)),
    activeWeavingHallCount: await prisma.station.count({ where: { kind: "WEAVING", isActive: true } }),
  };
}

export async function planSetupFromDb(
  reasons: readonly StopReasonSeed[] = SEYITOGLU_STOP_REASONS,
  shifts: readonly ShiftSeed[] = SEYITOGLU_SHIFTS,
): Promise<SetupRow[]> {
  const { slugifyReasonCode } = await import("../../src/constants/reason-presets");
  const { foldNameForCompare } = await import("../../src/services/helpers/name-normalize.helper");
  return planSetup(await readSetupState(), slugifyReasonCode, foldNameForCompare, reasons, shifts);
}

/** Yalnız CREATE satırlarını servis yoluyla yazar (audit servis içinde); yazılan satır sayısını döner. */
export async function applySetup(
  rows: readonly SetupRow[],
  userId: string,
  reasons: readonly StopReasonSeed[] = SEYITOGLU_STOP_REASONS,
  shifts: readonly ShiftSeed[] = SEYITOGLU_SHIFTS,
): Promise<number> {
  const { ReasonPresetService } = await import("../../src/services/reason-preset.service");
  const { createShiftDefinition } = await import("../../src/services/shift-definition.service");
  let written = 0;
  for (const row of rows) {
    if (row.action !== "CREATE") continue;
    if (row.group === "REASON") {
      const seed = reasons.find((r) => r.label === row.label);
      if (!seed) continue;
      await ReasonPresetService.create({ kind: "MACHINE_STOP", label: seed.label, stopLossClass: seed.stopLossClass }, userId);
    } else if (row.group === "SHIFT") {
      const seed = shifts.find((s) => s.name === row.label);
      if (!seed) continue;
      await createShiftDefinition({ ...seed, plannedBreakMinutes: 0, activeWeekdays: [], sortOrder: shifts.indexOf(seed) }, userId);
    } else if (row.group === "HALL") {
      // Salon = WEAVING istasyonu (Tezgah Salonu bunu okur); rotada adım değil, levent tüketir.
      const { stationService } = await import("../../src/routes/station.routes");
      await stationService.create(
        { name: SEYITOGLU_HALL_NAME, type: "INTERNAL", kind: "WEAVING", department: "DOKUMA", allowAsWorkOrderStep: false, consumesWarpBeam: true },
        userId,
      );
    } else continue;
    written++;
  }
  return written;
}
