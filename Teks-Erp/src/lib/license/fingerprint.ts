// Parmak izi ÖLÇÜMÜ: OS etkenleri (f1..f4, çok yollu) ve tuzlu özet LİSANS ÇEKİRDEĞİNDE (üretimde native),
// PostgreSQL etkeni (F5) burada okunur; okunamayan etken 24 saate dek önbellekten (`fingerprint-cache.ts`, K8).
// Ham F5 bu dosyadan dışarı yalnız çekirdeğe gider — loga, audit'e, uca GİRMEZ.
import prisma from "../prisma";
import { pgTool, runProcess } from "../../services/helpers/pg-tool.helper";
import { FINGERPRINT_FACTORS, msToIso, normalizeFactor, type Fingerprint, type FingerprintFactor } from "./protocol";
import type { LicenseCore } from "./license-core";
import { getLicenseCore } from "./native";
import { selectFactor, type FactorReading, type FactorReadState } from "./fingerprint-paths";
import {
  applyFingerprintCache,
  readFingerprintCache,
  writeFingerprintCache,
  type CachedFactor,
  type FactorSource,
  type FingerprintCache,
} from "./fingerprint-cache";
import { getLicenseStore } from "./store";

/** Etken başına okuma raporu — değer ve özet YOK; ekran ve yoklama bunu gösterir/taşır. */
export interface FactorReport {
  /** Kullanılan özetin kaynağı: bu ölçüm · ≤ 24 sa önbellek · yok (kayıp ya da hiç okunmadı). */
  readonly kaynak: FactorSource;
  /** Bu ölçümün durumu (OKUNDU · DEGER_YOK · OKUNAMADI). */
  readonly durum: FactorReadState;
  /** Bu ölçümde kazanan yol (önbellekten geliyorsa önbelleğe yazıldığı yol). */
  readonly yol: string | null;
  /** Son başarılı okuma (ISO; hiç okunmadıysa `null`). */
  readonly sonOkuma: string | null;
  readonly celiski: readonly string[];
  readonly hatali: readonly string[];
}

export interface MeasuredFingerprint {
  /** Kullanılan özet: canlı okuma, okunamayan etkende ≤ 24 sa önbellek (K8). */
  readonly digest: Fingerprint;
  /** Etken BU ÖLÇÜMDE okunabildi mi — ekran bunu gösterir (değerin kendisini değil). */
  readonly measured: Readonly<Record<FingerprintFactor, boolean>>;
  readonly measuredAt: string;
  /** Çok yollu okuma raporu (elle kurulan test ölçümlerinde yok). */
  readonly okuma?: Readonly<Record<FingerprintFactor, FactorReport>>;
  /** Önbellek dosyası bozuk/başka tuzla yazılmış bulundu (yok sayıldı, bu ölçümle yeniden yazıldı). */
  readonly onbellekBozuk?: boolean;
  /** Bu ölçümden sonraki önbellek (imzalı durum kaydına ve DB izine kopyalanır; L2-6). */
  readonly onbellek?: FingerprintCache;
}

const F5_PATHS = [
  { tur: 1, id: "f5.sql" },
  { tur: 1, id: "f5.pg-controldata" },
] as const;
const PG_CONTROLDATA_TIMEOUT_MS = 10_000;

/** F5 yolu 1: kümenin kimliği SQL'den (`pg_control_system()` PUBLIC'e açık). Düşerse OKUNAMADI. */
async function postgresSql(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string | null }>>`SELECT system_identifier::text AS id FROM pg_control_system()`;
    return rows[0]?.id ?? "";
  } catch {
    return null;
  }
}

/** F5 yolu 2: `pg_controldata` veri dizininden (yalnız `PGDATA_DIR` biliniyorsa; dil C — etiket çevrilmesin). */
async function postgresControlData(dataDir: string): Promise<string | null> {
  const res = await runProcess(pgTool("pg_controldata"), ["-D", dataDir], {
    timeoutMs: PG_CONTROLDATA_TIMEOUT_MS,
    captureStdout: true,
    env: { LC_ALL: "C", LANG: "C", LC_MESSAGES: "C" },
  });
  if (res.code !== 0 || res.spawnError) return null;
  return /^Database system identifier:\s*([0-9]+)\s*$/m.exec(res.stdout ?? "")?.[1] ?? "";
}

/** F5 çok yollu: SQL kullanılabilir değer verdiyse ikinci yol hiç koşmaz (raporda da yer almaz). */
async function postgresFactor(): Promise<{ readonly raw: string | null; readonly reading: FactorReading }> {
  const sql = await postgresSql();
  const dataDir = process.env.PGDATA_DIR?.trim();
  if (normalizeFactor("f5", sql) !== null || !dataDir) return selectFactor("f5", F5_PATHS.slice(0, 1), { "f5.sql": sql });
  return selectFactor("f5", F5_PATHS, { "f5.sql": sql, "f5.pg-controldata": await postgresControlData(dataDir) });
}

export interface MeasureOptions {
  /** Önbellek dizini (varsayılan: kullanılabilir lisans deposu; yoksa önbelleksiz). */
  readonly cacheDir?: string | null;
  readonly nowMs?: number;
  /** İmzalı durum kaydındaki önbellek kopyası: dosya silinse de son okuma 24 saate dek köprülenir (etken başına en yeni). */
  readonly recordCache?: FingerprintCache;
  /** `false`: önbellek okunur ama YAZILMAZ (doğrulama kipi lisans durumunu yalnız okur). Varsayılan yazar. */
  readonly persistCache?: boolean;
}

/** İki önbellekten etken başına EN YENİ okuma (dosya silinirse kayıt kopyası köprüler; eskisi yeniyi ezmez). */
export function mergeFingerprintCaches(a: FingerprintCache, b: FingerprintCache | undefined): FingerprintCache {
  if (!b) return a;
  const out: Partial<Record<FingerprintFactor, CachedFactor>> = { ...a };
  for (const f of FINGERPRINT_FACTORS) {
    const x = b[f];
    const y = out[f];
    if (x && (!y || x.an > y.an)) out[f] = x;
  }
  return out;
}

function defaultCacheDir(): string | null {
  const store = getLicenseStore();
  return store && !store.problem && store.key ? store.dir : null;
}

/** Beş etkeni ölçer, kurulum tuzuyla özetler ve 24 sa önbelleği uygular (çekirdek kullanılamıyorsa OS etkenleri okunamadı). */
export async function measureFingerprint(salt: Uint8Array, core: LicenseCore = getLicenseCore(), options: MeasureOptions = {}): Promise<MeasuredFingerprint> {
  const nowMs = options.nowMs ?? Date.now();
  const f5 = await postgresFactor();
  const c = await core.collectFingerprint(salt, f5.raw);
  const readings: Record<FingerprintFactor, FactorReading> = { ...c.okuma, f5: f5.reading };
  const liveYol = Object.fromEntries(FINGERPRINT_FACTORS.map((f) => [f, c.digest[f] === null ? null : readings[f].yol])) as Record<FingerprintFactor, string | null>;
  const dir = options.cacheDir === undefined ? defaultCacheDir() : options.cacheDir;
  const read = dir ? readFingerprintCache(dir, salt) : { cache: {}, durum: "YOK" as const };
  const d = applyFingerprintCache(c.digest, liveYol, mergeFingerprintCaches(read.cache, options.recordCache), nowMs);
  if (dir && d.changed && options.persistCache !== false) {
    try {
      writeFingerprintCache(dir, salt, d.next);
    } catch {
      /* yazılamayan önbellek ölçümü düşürmez: bir sonraki ölçüm yeniden dener */
    }
  }
  const report = Object.fromEntries(
    FINGERPRINT_FACTORS.map((f) => {
      const r = readings[f];
      const last = d.sonOkuma[f];
      const winningPath = d.kaynak[f] === "onbellek" ? (d.next[f]?.yol ?? null) : r.yol;
      return [f, { kaynak: d.kaynak[f], durum: r.durum, yol: winningPath, sonOkuma: last === null ? null : msToIso(last), celiski: r.celiski, hatali: r.hatali }];
    }),
  ) as Record<FingerprintFactor, FactorReport>;
  return {
    digest: d.effective,
    measured: c.measured,
    measuredAt: msToIso(nowMs),
    okuma: report,
    onbellek: d.next,
    ...(read.durum === "BOZUK" ? { onbellekBozuk: true } : {}),
  };
}
