// =============================================================================
// TeksERP — MAKİNE DURUŞU REJİMİ (D4-A1, ister 5.5) · TEK yüklem
// =============================================================================
// "Bu kurulumda makine duruşu kaydedilebilir mi?" sorusunun TEK cevabı:
//   dokuma  ∨  (üretim ∧ `uretim.makineDurusTakibi`)
// Rota kapısı (`requireMachineStopRegime`), servis tür kontrolü (`assertMachineStopKindAllowed`),
// liste kapsamı (`machineStopScopeWhere`) ve vardiya takvimi bu dosyadan okur. Ayar okuyucusunu
// başka yerde çağırmak İKİNCİ rejim yüklemi demektir — `test_makine_durus_rejimi` (AST) reddeder.
// Tür kontrolü ve kapsam süzgeci YALNIZ dokumasız genel rejimde (`!weaving ∧ general`) devreye girer:
// dokuma açıkken ya da ayar kapalıyken her dal bugünküyle bayt-aynı (kapalı rejimin kapısı rotadadır).
// =============================================================================
import { Prisma, StationKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { SETTING_KEYS, readDokumaEnabled, readMachineStopTrackingEnabled, readProductionEnabled } from "../system-setting.service";
import { licenseModuleError } from "../../lib/license/module-ceiling";

export interface MachineStopRegime {
  /** Dokuma modülü etkin (bugünkü rejim; tezgah dahil her makine). */
  weaving: boolean;
  /** Dokumasız genel rejim: üretim ∧ `uretim.makineDurusTakibi`. */
  general: boolean;
}

/** Dokumasız rejimde duruş açılabilen istasyon türleri (§2: kurşun · iç brode = PROCESS_QC, tambur = TAMBUR). */
export const GENERAL_STOP_STATION_KINDS: readonly StationKind[] = [StationKind.PROCESS_QC, StationKind.TAMBUR];

type SettingClient = Pick<typeof prisma, "systemSetting">;

/** Rejimin okuma varyantı — kapı, servis ve iş aynı yüklemi çağırır. */
export async function machineStopRegime(tx?: SettingClient): Promise<MachineStopRegime> {
  const weaving = await readDokumaEnabled(tx);
  const general = (await readProductionEnabled(tx)) && (await readMachineStopTrackingEnabled(tx));
  return { weaving, general };
}

export function machineStopRegimeOpen(r: MachineStopRegime): boolean {
  return r.weaving || r.general;
}

/** Dokumasız genel rejim: dokuma kapalı, ayar açık — tür kontrolü ve kapsam yalnız burada. */
function generalOnly(r: MachineStopRegime): boolean {
  return !r.weaving && r.general;
}

/**
 * Liste/özet kapsamı: dokumasız genel rejim dışında `{}` (bugünkü küme, bayt-aynı); o rejimde tezgah
 * (WEAVING) duruşları kapsam dışı. `stationKinds` istemci süzgecidir (sunucuda uygulanır).
 */
export function machineStopScopeWhere(r: MachineStopRegime, stationKinds: readonly StationKind[] = []): Prisma.MachineStopEventWhereInput {
  const scoped = generalOnly(r);
  if (!scoped && stationKinds.length === 0) return {};
  return {
    machine: {
      station: {
        kind: {
          ...(scoped ? { not: StationKind.WEAVING } : {}),
          ...(stationKinds.length > 0 ? { in: [...stationKinds] } : {}),
        },
      },
    },
  };
}

/**
 * Servis kapısı (`openStopCore`): dokuma açıkken / ayar kapalıyken her makine (bugünkü). Dokumasız rejimde tezgah
 * 403 MODULE_DISABLED (dokuma), desteklenmeyen tür 400 `STOP_STATION_KIND_UNSUPPORTED`.
 */
export function assertMachineStopKindAllowed(r: MachineStopRegime, kind: StationKind): void {
  if (!generalOnly(r)) return;
  if (kind === StationKind.WEAVING) {
    throw licenseModuleError(SETTING_KEYS.DOKUMA_ENABLED, "Dokuma iş emri") ??
      AppError.forbidden("Tezgah duruşu Dokuma modülü kapalıyken kaydedilemez.", { code: "MODULE_DISABLED", modul: "dokuma" });
  }
  if (!GENERAL_STOP_STATION_KINDS.includes(kind)) {
    throw AppError.badRequest("Bu istasyon türündeki makineye duruş girilemez; yalnız kurşun, brode ve tambur makineleri desteklenir.", {
      code: "STOP_STATION_KIND_UNSUPPORTED", stationKind: kind,
    });
  }
}
