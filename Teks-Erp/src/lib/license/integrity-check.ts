// Çalışan backend'in BÜTÜNLÜK DENETİMİ (açılışta + günlük). İmza ve dosya özeti lisans çekirdeğinde
// (üretimde native); bu dosya çekirdeğin sormadığı iki kararı ekler: kapsam dizinlerinde listede
// olmayan FAZLA dosya ve hazırlık PAKET anahtarının sınıf kuralı. Sonuç lisans durumuna girer.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPlainObject, parseJws } from "./protocol";
import type { IntegrityReport, PackageKey } from "./integrity";
import type { LicenseCore } from "./license-core";
import type { IntegrityStatus } from "./state-rules";
import {
  INTEGRITY_FILE,
  STAGING_PACKAGE_CLASSES,
  isStagingPackageKid,
  listScopedFiles,
} from "./integrity-scope";
import { BUILD_WATERMARK, watermarkMatches, type BuildWatermark } from "./watermark";

/** Çekirdeğin dışındaki (TS ikinci katman) bütünlük kodları. */
export const INTEGRITY_GUARD_CODES = [
  "BUTUNLUK_LISTE_YOK",
  "BUTUNLUK_FAZLA",
  "BUTUNLUK_HAZIRLIK_ANAHTARI",
  "BUTUNLUK_SINIF_BILINMIYOR",
  "BUTUNLUK_FILIGRAN",
] as const;
export type IntegrityGuardCode = (typeof INTEGRITY_GUARD_CODES)[number];

const EXTRA_LIST_CAP = 50;

export interface IntegrityOutcome {
  readonly durum: IntegrityStatus;
  readonly kod: string | null;
  /** İmzalayan PAKET anahtarının kimliği (imza doğrulandıysa). */
  readonly kid: string | null;
  /** İmzalı künye — yalnız imza doğrulandıysa VE anahtar bu sınıfa yetkiliyse. */
  readonly kunye: { readonly derlemeTarihi: string; readonly musteri: string | null; readonly paketId: string; readonly surum: string } | null;
  readonly rapor: IntegrityReport | null;
  readonly fazla: readonly string[];
  readonly fazlaSayisi: number;
  readonly denetlendi: string;
}

export interface IntegrityCheckInput {
  /** Paket kökü (süreç `app/` kökünde başlar). */
  readonly root: string;
  /** Zorunlu kip (korumalı paket): liste yoksa GEÇERSİZ; değilse KAPSAM DIŞI (geliştirme). */
  readonly required: boolean;
  readonly core: LicenseCore;
  /** Verilmezse çekirdeğin GÖMÜLÜ PAKET çapası (üretim yolu); yalnız testler verir. */
  readonly keys?: readonly PackageKey[];
  /** Doğrulanmış HAK'ın sınıfı; HAK yoksa null. */
  readonly entitlementClass: string | null;
  /** Bayt kodu filigranı (varsayılan bu derlemeninki); yalnız testler verir. */
  readonly watermark?: BuildWatermark | null;
  readonly nowMs?: number;
}

function outcome(o: Partial<IntegrityOutcome> & Pick<IntegrityOutcome, "durum" | "kod">, nowMs: number): IntegrityOutcome {
  return { kid: null, kunye: null, rapor: null, fazla: [], fazlaSayisi: 0, ...o, denetlendi: new Date(nowMs).toISOString() };
}

async function readList(root: string): Promise<string | null> {
  try {
    return (await readFile(path.join(root, INTEGRITY_FILE), "utf8")).trim();
  } catch {
    return null;
  }
}

/** İmzası çekirdekte doğrulanmış listenin yolları (yük yeniden ayrıştırılır; imza kararı çekirdeğindir). */
function manifestPaths(token: string): Set<string> {
  const p = parseJws(token);
  const files = p.ok ? p.value.payload.dosyalar : null;
  const out = new Set<string>();
  if (Array.isArray(files)) for (const f of files) if (isPlainObject(f) && typeof f.yol === "string") out.add(f.yol);
  return out;
}

export async function runIntegrityCheck(g: IntegrityCheckInput): Promise<IntegrityOutcome> {
  const now = g.nowMs ?? Date.now();
  const token = await readList(g.root);
  if (token === null) {
    return g.required ? outcome({ durum: "GECERSIZ", kod: "BUTUNLUK_LISTE_YOK" }, now) : outcome({ durum: "KAPSAM_DISI", kod: null }, now);
  }
  const r = await g.core.verifyIntegrity(token, g.root, g.keys);
  if (!r.ok) return outcome({ durum: "OLCULEMEDI", kod: r.code }, now);
  const rapor = r.value;
  if (rapor.paket === null) return outcome({ durum: rapor.durum, kod: rapor.kod, rapor }, now);

  const header = parseJws(token);
  const kid = header.ok ? header.value.header.kid : null;
  const inManifest = manifestPaths(token);
  const extra = (await listScopedFiles(g.root)).filter((f) => !inManifest.has(f));
  const base = { kid, rapor, fazla: extra.slice(0, EXTRA_LIST_CAP), fazlaSayisi: extra.length };
  const kunye = { derlemeTarihi: rapor.paket.derlemeTarihi, musteri: rapor.paket.musteri, paketId: rapor.paket.paketId, surum: rapor.paket.surum };

  if (kid !== null && isStagingPackageKid(kid)) {
    if (g.entitlementClass === null) return outcome({ ...base, durum: "OLCULEMEDI", kod: "BUTUNLUK_SINIF_BILINMIYOR" }, now);
    if (!STAGING_PACKAGE_CLASSES.includes(g.entitlementClass)) return outcome({ ...base, durum: "GECERSIZ", kod: "BUTUNLUK_HAZIRLIK_ANAHTARI" }, now);
  }
  const mark = g.watermark === undefined ? BUILD_WATERMARK : g.watermark;
  if (!watermarkMatches(mark, kunye)) return outcome({ ...base, durum: "GECERSIZ", kod: "BUTUNLUK_FILIGRAN" }, now);
  if (rapor.durum === "GECERLI" && extra.length > 0) return outcome({ ...base, kunye, durum: "GECERSIZ", kod: "BUTUNLUK_FAZLA" }, now);
  return outcome({ ...base, kunye, durum: rapor.durum, kod: rapor.kod }, now);
}
