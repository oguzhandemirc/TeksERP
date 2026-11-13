// =============================================================================
// PATRON OKUMA UCU — servis (V3a, 2026-11-13)
// =============================================================================
// Bulutun `/api/oturum`, `/api/veri/:p[/:id]`, `/api/anlik/:p` okumalarının ERP karşılığı: AYNI yanıt biçimi,
// veri KOPYADAN değil canlı ERP'den, fabrikanın projeksiyon kurucularıyla. İzin kararı bulutla aynı (ölçüldü,
// `patron/sunucu/src/services/data.service.ts:17-29`): sunulmayan ad 404, izinsiz kök 403, izinsiz alt satır
// anahtarsız. Önbellek yalnız ANLIK veridir (TTL tazelik); izin + modül kapısı her istekte önbellekten ÖNCE.
// =============================================================================
import { AppError } from "../../utils/app-error";
import { buildSnapshots } from "../../cloud-sync/snapshots";
import { readFinanceEnabled, readMaliyetEnabled, readProductionEnabled, readCompanyName } from "../system-setting.service";
import prisma from "../../lib/prisma";
import {
  PATRON_RECORD_SETS, canRead, effectiveCloudPermissions, patronSet, readableSetNames, type SetDef,
} from "./izin-esleme";
import { ID_FILTER_KEYS, KEY_FILTERS, SEARCH, getRecord, idFiltersOf, listRecords, type PatronListQuery, type PatronRecord } from "./kayit-sayfasi";
import { getLicenseInstallationId } from "../../lib/license/runtime";

/** Önbellek tazeliği (ms) — pahalı özetler (`ozet` = 9 rapor servisi) saniyede bir yeniden kurulmasın. */
export const SNAPSHOT_TTL_MS = 20_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: PatronSnapshot }>();

export interface PatronSnapshot { projeksiyon: string; veri: unknown; surum: string }
export interface PatronUser { readonly userId: string; readonly username: string; readonly permissions: readonly string[] }

const notFound = (what: string): AppError => AppError.notFound(`${what} bulunamadı`, { code: "PATRON_SET_NOT_FOUND" });

/** Bulut `readableDef`in aynası: ad/tür yoksa 404, izin kümesi eksikse 403. */
function readable(user: PatronUser, name: string, kind: "KAYIT" | "ANLIK"): { def: SetDef; cloud: ReadonlySet<string> } {
  const def = patronSet(name, kind);
  if (!def) throw notFound(kind === "ANLIK" ? "Anlık görüntü" : "Projeksiyon");
  const cloud = new Set(effectiveCloudPermissions(user.permissions));
  if (!canRead(cloud, def.requires)) throw AppError.forbidden("Bu veriyi görme yetkiniz yok", { code: "PATRON_SET_FORBIDDEN" });
  return { def, cloud };
}

const subRowsOf = (def: SetDef, cloud: ReadonlySet<string>) => ({
  finans: Boolean(def.subRows?.finans && canRead(cloud, def.subRows.finans)),
  kisisel: Boolean(def.subRows?.kisisel && canRead(cloud, def.subRows.kisisel)),
});

/** Route'un adlı kapılarını seçmesi için (modül + ticaret; kapalı → 403 MODULE_DISABLED). Tanınmayan ad → boş. */
export function setGates(name: string, kind: "KAYIT" | "ANLIK"): SetDef["gates"] {
  return patronSet(name, kind)?.gates ?? [];
}

export async function listSet(user: PatronUser, name: string, q: PatronListQuery, nowMs = Date.now()) {
  const { def, cloud } = readable(user, name, "KAYIT");
  return listRecords(def.projection!, q, subRowsOf(def, cloud), nowMs);
}

export async function getSetRecord(user: PatronUser, name: string, id: string, nowMs = Date.now()): Promise<PatronRecord> {
  const { def, cloud } = readable(user, name, "KAYIT");
  const r = await getRecord(def.projection!, id, subRowsOf(def, cloud), nowMs);
  if (!r) throw notFound("Kayıt");
  return r;
}

export async function getSnapshot(user: PatronUser, name: string, nowMs = Date.now()): Promise<PatronSnapshot> {
  const { def } = readable(user, name, "ANLIK");
  const key = `${user.userId}|${name}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < SNAPSHOT_TTL_MS) return hit.value;
  const production = await readProductionEnabled();
  const built = await buildSnapshots({
    now: new Date(nowMs), productionOn: production, financeOn: await readFinanceEnabled(),
    maliyetOn: production && (await readMaliyetEnabled()), cadences: new Set(), extra: new Set([def.builder!]),
  });
  const found = built.find((s) => s.projection === name);
  // Kurucu üretmediyse (ör. emanet kapalı) bulutta satır yoktur → aynı cevap.
  if (!found) throw notFound("Anlık görüntü");
  const value: PatronSnapshot = { projeksiyon: name, veri: found.data, surum: new Date(nowMs).toISOString() };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: nowMs, value });
  return value;
}

/** Bekçi kancası: önbelleği sıfırla (süreç içi). */
export function clearPatronSnapshotCache(): void {
  cache.clear();
}

/** Bu sunucunun liste yetenekleri (bulut `ListCapabilities` biçimi; yalnız sunulan kümeler). */
function listCapabilities() {
  const kimlikSuzgecleri: Record<string, string[]> = {};
  for (const key of ID_FILTER_KEYS) {
    const names = PATRON_RECORD_SETS.filter((n) => idFiltersOf(patronSet(n, "KAYIT")!.projection!).includes(key));
    if (names.length > 0) kimlikSuzgecleri[key] = names;
  }
  const served = new Set<string>(PATRON_RECORD_SETS);
  const anahtarSuzgecleri = Object.fromEntries(Object.entries(KEY_FILTERS).map(([k, v]) => [k, v.filter((n) => served.has(n))]).filter(([, v]) => v.length > 0));
  return { kimlikSuzgecleri, aranabilir: Object.keys(SEARCH), anahtarSuzgecleri };
}

/** `GET /oturum` — bulut `FacilityStatus` biçimi; eşitleme yok (veri canlı), hizmet aşaması hep ACIK. */
export async function facilityStatus(user: PatronUser) {
  const cloud = effectiveCloudPermissions(user.permissions);
  const me = await prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } });
  return {
    tesis: { id: getLicenseInstallationId() ?? "", ad: await readCompanyName(), saklamaAy: null },
    hesap: { id: user.userId, ad: me?.fullName ?? user.username, eposta: user.username, izinler: cloud },
    projeksiyonlar: readableSetNames(new Set(cloud)),
    esitleme: null,
    hizmet: { asama: "ACIK" as const, bitis: null, saltOkunurBitis: null },
    liste: listCapabilities(),
  };
}
