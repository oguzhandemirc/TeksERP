// =============================================================================
// BİLDİRİM GÖRME SÜZGECİ — "bu kullanıcı bu türü görür mü"nün TEK cevabı (B4, plan §3.7)
// =============================================================================
// Yüklem = izin (DNF: konjonksiyonlardan biri tam) ∧ modül (ModulKey → bayrak okuyucusu, lisans
// tavanı dahil; `cekirdek:*`/`planlanan:*` hep açık) ∧ ek kapı (`tezgahAlarm`). Dağıtım, gelen
// kutusu okuması ve tercih ekranı AYNI yüklemi çağırır (`test_bildirim_tek_kaynak`); toplu sürüm
// `visibleUsersFor` tekil yüklemi kullanıcı başına çağırır — ikinci bir izin hesabı yoktur.
// Ortam (modül/kapı) bir kez okunur ve saf yükleme verilir: tur başına N×M ayar okuması olmasın.
// =============================================================================
import type { Prisma } from "@prisma/client";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_KINDS,
  type NotificationCatalogEntry,
  type NotificationKind,
} from "../../constants/notification-catalog";
import type { EkranModul, ModulKey } from "../../constants/screen-catalog";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import {
  readDepoMultiEnabled,
  readDevereEnabled,
  readDokumaEnabled,
  readEmanetEnabled,
  readFinanceEnabled,
  readIplikEnabled,
  readKaliteGuvenceEnabled,
  readKumasTeknikEnabled,
  readGelenBelgeEnabled,
  readMaliyetEnabled,
  readProductionEnabled,
  readTezgahEnabled,
  readTicaretEnabled,
  resolveTezgahAlarmEnabled,
} from "../system-setting.service";
import { loadEffectiveGrants } from "./loom-alarm-recipient.helper";

type SettingDb = Pick<Prisma.TransactionClient, "systemSetting">;
type GateKey = "tezgahAlarm";

/** Görme kararı için kullanıcıdan gereken tek bilgi: o an geçerli izin kodları. */
export interface NotificationViewer {
  permissions: readonly string[];
}

/** Kurulumun o anki modül/kapı durumu; okunmamış anahtar KAPALI sayılır (fail-closed). */
export interface NotificationVisibilityEnv {
  modules: Partial<Record<ModulKey, boolean>>;
  gates: Partial<Record<GateKey, boolean>>;
}

/** Tam liste tip-zorunlu (yeni ModulKey derlenmez); açık çağrı: lisans tavanı bekçisi okuyucuyu AST'de izler. */
const MODULE_READERS: Record<ModulKey, (db: SettingDb) => Promise<boolean>> = {
  productionEnabled: (db) => readProductionEnabled(db),
  financeEnabled: (db) => readFinanceEnabled(db),
  ticaretEnabled: (db) => readTicaretEnabled(db),
  iplikEnabled: (db) => readIplikEnabled(db),
  depoMultiEnabled: (db) => readDepoMultiEnabled(db),
  kumasTeknikEnabled: (db) => readKumasTeknikEnabled(db),
  tezgahEnabled: (db) => readTezgahEnabled(db),
  devereEnabled: (db) => readDevereEnabled(db),
  dokumaEnabled: (db) => readDokumaEnabled(db),
  emanetEnabled: (db) => readEmanetEnabled(db),
  maliyetEnabled: (db) => readMaliyetEnabled(db),
  kaliteGuvenceEnabled: (db) => readKaliteGuvenceEnabled(db),
  gelenBelgeEnabled: (db) => readGelenBelgeEnabled(db),
};
const GATE_READERS: Record<GateKey, (db: SettingDb) => Promise<boolean>> = {
  tezgahAlarm: (db) => resolveTezgahAlarmEnabled(db),
};

/** Geniş tipli okuma: ham dize tür (DB'den) katalog dışıysa `undefined` döner. */
function entryOf(kind: string): NotificationCatalogEntry | undefined {
  return (NOTIFICATION_CATALOG as Record<string, NotificationCatalogEntry>)[kind];
}

function isModulKey(m: EkranModul): m is ModulKey {
  return Object.prototype.hasOwnProperty.call(MODULE_READERS, m);
}

/** Verilen türlerin ihtiyaç duyduğu modül ve kapıları okur (varsayılan: bütün katalog). */
export async function loadNotificationVisibilityEnv(
  db: SettingDb,
  kinds: readonly NotificationKind[] = NOTIFICATION_KINDS,
): Promise<NotificationVisibilityEnv> {
  const env: NotificationVisibilityEnv = { modules: {}, gates: {} };
  for (const kind of new Set(kinds)) {
    const entry = entryOf(kind);
    if (!entry) continue;
    if (isModulKey(entry.modul) && env.modules[entry.modul] === undefined) {
      env.modules[entry.modul] = await MODULE_READERS[entry.modul](db);
    }
    if (entry.kapi && env.gates[entry.kapi] === undefined) {
      env.gates[entry.kapi] = await GATE_READERS[entry.kapi](db);
    }
  }
  return env;
}

/** TEK yüklem. Bilinmeyen tür, okunmamış modül/kapı → görmez. */
export function canSeeNotificationType(
  viewer: NotificationViewer,
  kind: NotificationKind,
  env: NotificationVisibilityEnv,
): boolean {
  const entry = entryOf(kind);
  if (!entry) return false;
  if (isModulKey(entry.modul) && env.modules[entry.modul] !== true) return false;
  if (entry.kapi && env.gates[entry.kapi] !== true) return false;
  const codes = [...viewer.permissions];
  return entry.izinler.some((konj) => konj.every((code) => matchesPermission(codes, code)));
}

export function visibleKindsFor(viewer: NotificationViewer, env: NotificationVisibilityEnv): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((kind) => canSeeNotificationType(viewer, kind, env));
}

/** Türlerin görme izinlerinde geçen bütün kodlar (izin sahiplerini tek sorguda okumak için). */
export function visibilityPermissionCodes(kinds: readonly NotificationKind[]): string[] {
  const out = new Set<string>();
  for (const kind of kinds) for (const konj of entryOf(kind)?.izinler ?? []) for (const c of konj) out.add(c);
  return [...out];
}

/** "N tür yetkiniz dışında": modülü/kapısı açık, izni olmayan (izin verilse görülecek) tür sayısı. */
export function permissionDeniedKindCount(viewer: NotificationViewer, env: NotificationVisibilityEnv): number {
  return NOTIFICATION_KINDS.filter(
    (kind) => !canSeeNotificationType(viewer, kind, env)
      && canSeeNotificationType({ permissions: visibilityPermissionCodes([kind]) }, kind, env),
  ).length;
}

/**
 * Toplu sürüm (dağıtıcı): aday kullanıcılardan türü GÖREBİLENLER. Kod kümesi `loadEffectiveGrants`ten
 * (aktif, sistem dışı, süresi geçerli atama) — `grants` verilirse yeniden okunmaz. Karar tekil yüklemdir.
 */
export async function visibleUsersFor(
  db: Pick<Prisma.TransactionClient, "userPermission">,
  kind: NotificationKind,
  env: NotificationVisibilityEnv,
  opts: { userIds?: readonly string[]; at?: Date; grants?: ReadonlyMap<string, readonly string[]> } = {},
): Promise<string[]> {
  const grants = opts.grants
    ?? await loadEffectiveGrants(db, visibilityPermissionCodes([kind]), opts.at ?? new Date(), opts.userIds);
  const allow = opts.userIds ? new Set(opts.userIds) : null;
  const out: string[] = [];
  for (const [userId, codes] of grants) {
    if (allow && !allow.has(userId)) continue;
    if (canSeeNotificationType({ permissions: codes }, kind, env)) out.push(userId);
  }
  return out.sort();
}
