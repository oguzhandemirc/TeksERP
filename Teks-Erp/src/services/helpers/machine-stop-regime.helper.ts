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
import { assertStopShiftWritableTx } from "./machine-stop-context.helper";

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
 * Kapının İZİN boyutu: isteği yalnız `mobile:makine-durus` taşıyorsa (dokuma izni yok) duruş, rejimden bağımsız,
 * kurşun/brode/tambur makinelerine daralır — kurşun operatörü tezgah duruşuna dokunamaz.
 */
export interface MachineStopKindScope {
  generalKindsOnly?: boolean;
}

/**
 * Liste/özet kapsamı: dokumasız genel rejim dışında `{}` (bugünkü küme, bayt-aynı); o rejimde tezgah
 * (WEAVING) duruşları kapsam dışı. `stationKinds` istemci süzgecidir (sunucuda uygulanır).
 */
export function machineStopScopeWhere(
  r: MachineStopRegime,
  stationKinds: readonly StationKind[] = [],
  scope: MachineStopKindScope = {},
): Prisma.MachineStopEventWhereInput {
  const scoped = generalOnly(r);
  const kinds = scope.generalKindsOnly
    ? (stationKinds.length > 0 ? stationKinds.filter((k) => GENERAL_STOP_STATION_KINDS.includes(k)) : [...GENERAL_STOP_STATION_KINDS])
    : [...stationKinds];
  const filterKinds = scope.generalKindsOnly || stationKinds.length > 0;
  if (!scoped && !filterKinds) return {};
  return {
    machine: {
      station: {
        kind: {
          ...(scoped ? { not: StationKind.WEAVING } : {}),
          ...(filterKinds ? { in: kinds } : {}),
        },
      },
    },
  };
}

/**
 * Servis kapısı (`openStopCore`): dokuma açıkken / ayar kapalıyken her makine (bugünkü). Dokumasız rejimde tezgah
 * 403 MODULE_DISABLED (dokuma), desteklenmeyen tür 400 `STOP_STATION_KIND_UNSUPPORTED`. `generalKindsOnly`
 * (yalnız `mobile:makine-durus`) rejimden bağımsız kurşun/brode/tambur dışını 403 `STOP_STATION_KIND_FORBIDDEN` yapar.
 */
export function assertMachineStopKindAllowed(r: MachineStopRegime, kind: StationKind, scope: MachineStopKindScope = {}): void {
  assertKindInPermissionScope(kind, scope);
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

function assertKindInPermissionScope(kind: StationKind, scope: MachineStopKindScope): void {
  if (scope.generalKindsOnly && !GENERAL_STOP_STATION_KINDS.includes(kind)) {
    throw AppError.forbidden("Bu izinle yalnız kurşun, brode ve tambur makinelerinin duruşuna erişilebilir.", {
      code: "STOP_STATION_KIND_FORBIDDEN", stationKind: kind,
    });
  }
}

/**
 * İzin kapsamı (yalnız `mobile:makine-durus`) var olan duruşa yazmadan ÖNCE: duruşun makinesi değişmez, bu yüzden
 * kontrol rota başında yeterli (rejim kapısı ayrıca servis tx'inde). Duruş yoksa karar servisin 404'üne kalır.
 */
export async function assertStopInPermissionScope(stopId: string, scope: MachineStopKindScope): Promise<void> {
  if (!scope.generalKindsOnly) return;
  const stop = await prisma.machineStopEvent.findUnique({ where: { id: stopId }, select: { machine: { select: { station: { select: { kind: true } } } } } });
  if (stop) assertKindInPermissionScope(stop.machine.station.kind, scope);
}

/**
 * Var olan duruşa YAZAN insan yolları (kapa · sınıfla · yeniden sınıfla · geri al; toplu karşılıkları bunlardan geçer)
 * için aynı tür kapısı: dokumasız rejimde dokuma döneminden kalmış tezgah duruşu 403. Kapı gerekmiyorsa makine okunmaz.
 */
export async function assertStopMachineWritableTx(tx: Pick<typeof prisma, "systemSetting" | "machine">, machineId: string): Promise<void> {
  const r = await machineStopRegime(tx);
  if (!generalOnly(r)) return;
  const machine = await tx.machine.findUniqueOrThrow({ where: { id: machineId }, select: { station: { select: { kind: true } } } });
  assertMachineStopKindAllowed(r, machine.station.kind);
}

/**
 * Var olan duruşa yazmanın TEK ön kapısı: tür kapısı (`kindGate`; insan yolları) + mühür/iptal vardiya kapısı.
 * Makine sinyali/watchdog kapanışı ve makine sınıflaması `kindGate=false` geçer — kendi duruşunu her rejimde kapatır.
 */
export async function assertStopWritableTx(
  tx: Prisma.TransactionClient,
  cur: { shiftInstanceId: string | null; machineId: string },
  kindGate = true,
): Promise<void> {
  if (kindGate) await assertStopMachineWritableTx(tx, cur.machineId);
  await assertStopShiftWritableTx(tx, cur);
}
