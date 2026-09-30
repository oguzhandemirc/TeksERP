// Çalışan backend'in BÜTÜNLÜK DENETİMİ (açılışta + günlük). İmza, dosya özeti ve FAZLA dosya lisans
// çekirdeğinde (üretimde native); bu dosya ikinci katmandır: FAZLA'yı imzalı kapsamda YENİDEN arar
// (yamalı çekirdek "geçerli" dese de) ve hazırlık PAKET anahtarının sınıf kuralını ekler.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodeDocument, isoToMs, parseJws } from "./protocol";
import { IntegrityManifestSchema, readIntegrityList, type IntegrityReport, type PackageKey } from "./integrity";
import { walkIntegrityScope } from "./integrity-list";
import type { LicenseCore } from "./license-core";
import type { IntegrityStatus } from "./state-rules";
import { INTEGRITY_FILE, STAGING_PACKAGE_CLASSES, isStagingPackageKid } from "./integrity-scope";
import { BUILD_WATERMARK, watermarkMatches, type BuildWatermark } from "./watermark";

/** Çekirdeğin dışındaki (TS ikinci katman) bütünlük kodları. */
export const INTEGRITY_GUARD_CODES = [
  "BUTUNLUK_LISTE_YOK",
  "BUTUNLUK_FAZLA",
  "BUTUNLUK_HAZIRLIK_ANAHTARI",
  "BUTUNLUK_SINIF_BILINMIYOR",
  "BUTUNLUK_FILIGRAN",
  "BUTUNLUK_YUKLEYICI",
] as const;
export type IntegrityGuardCode = (typeof INTEGRITY_GUARD_CODES)[number];

const EXTRA_LIST_CAP = 50;

/**
 * Korumalı pakette KOD ENJEKTE eden Node başlatma bayrakları: imzalı dosyalar uyuşsa da süreç yamalı koşar.
 * `ecosystem.config.js` imzalanamaz (kur.ps1 sunucununkini birleştirir) — `node_args` / `NODE_OPTIONS` bu yoldur.
 */
const LOADER_INJECTION_FLAG = /^(?:-r|--require|--import|--loader|--experimental-loader|--inspect(?:-[a-z]+)*)$/;

export interface LoaderInjection {
  readonly bayrak: string;
  readonly kaynak: "execArgv" | "NODE_OPTIONS";
}

/** `NODE_OPTIONS` Node'un kuralıyla bölünür: boşluk ayırır, çift tırnak birleştirir, tırnak içinde ters bölü kaçırır. */
export function splitNodeOptions(value: string): string[] {
  const out: string[] = [];
  let cur = "";
  let started = false;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (quoted && c === "\\" && i + 1 < value.length) {
      cur += value[++i];
      continue;
    }
    if (c === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && /\s/.test(c)) {
      if (started) out.push(cur);
      cur = "";
      started = false;
      continue;
    }
    cur += c;
    started = true;
  }
  if (started) out.push(cur);
  return out;
}

/** Bayrak adı (`=değer` atılır; Node alt çizgiyi tireyle eş tutar); enjeksiyon bayrağı değilse null. */
function injectionFlagName(token: string): string | null {
  if (!token.startsWith("-")) return null;
  const name = (token.split("=")[0] ?? "").replace(/_/g, "-");
  return LOADER_INJECTION_FLAG.test(name) ? name : null;
}

/** execArgv + NODE_OPTIONS içindeki enjeksiyon bayrakları (değerleri DEĞİL — yol/sır taşıyabilir). */
export function detectLoaderInjection(execArgv: readonly string[], nodeOptions: string | undefined): LoaderInjection[] {
  const found: LoaderInjection[] = [];
  const scan = (tokens: readonly string[], kaynak: LoaderInjection["kaynak"]): void => {
    for (const t of tokens) {
      const bayrak = injectionFlagName(t);
      if (bayrak !== null && !found.some((f) => f.bayrak === bayrak && f.kaynak === kaynak)) found.push({ bayrak, kaynak });
    }
  };
  scan(execArgv, "execArgv");
  scan(splitNodeOptions(nodeOptions ?? ""), "NODE_OPTIONS");
  return found;
}

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
  /** Korumalı kipte süreçte görülen enjeksiyon bayrakları (boş = temiz ya da korumasız kip). */
  readonly yukleyiciBayraklari: readonly LoaderInjection[];
  /** Kararın sınıftan bağımsız girdisi; yeni HAK'ın sınıfıyla karar dosyalar yeniden okunmadan verilir (`decideForClass`). */
  readonly olcum: PackageMeasurement | null;
  readonly denetlendi: string;
}

/** İmzası doğrulanmış paketin dosya ölçümü: çekirdek raporu + ikinci katman FAZLA + ölçümdeki filigran. */
export interface PackageMeasurement {
  readonly kid: string | null;
  readonly rapor: IntegrityReport;
  readonly paket: NonNullable<IntegrityReport["paket"]>;
  /** İkinci katmanın imzalı kapsamda bulduğu FAZLA girdiler (tavanlı) ve tam sayısı. */
  readonly ekFazla: readonly string[];
  readonly ekFazlaSayisi: number;
  readonly filigran: BuildWatermark | null;
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
  /** Sürecin başlatma bayrakları (varsayılan bu süreçinki); yalnız testler verir. */
  readonly runtimeFlags?: { readonly execArgv: readonly string[]; readonly nodeOptions: string | undefined };
  readonly nowMs?: number;
}

function outcome(o: Partial<IntegrityOutcome> & Pick<IntegrityOutcome, "durum" | "kod">, nowMs: number): IntegrityOutcome {
  return { kid: null, kunye: null, rapor: null, fazla: [], fazlaSayisi: 0, yukleyiciBayraklari: [], olcum: null, ...o, denetlendi: new Date(nowMs).toISOString() };
}

async function readList(root: string): Promise<string | null> {
  try {
    return (await readFile(path.join(root, INTEGRITY_FILE), "utf8")).trim();
  } catch {
    return null;
  }
}

/**
 * İkinci katman: imzası çekirdekte doğrulanmış yükün kapsamında listede olmayan girdiler. Yük burada
 * yeniden ayrıştırılır (imza kararı çekirdeğindir); liste okunamazsa ölçülmez (çekirdek raporu karar verir).
 */
async function extraEntries(token: string, root: string): Promise<string[]> {
  const p = parseJws(token);
  const m = p.ok ? decodeDocument(IntegrityManifestSchema, p.value.payload) : null;
  if (!m?.ok) return [];
  const list = await readIntegrityList(root, m.value.liste);
  if (!list.ok) return [];
  const expectedPaths = new Set(list.entries.map((f) => f.yol));
  return (await walkIntegrityScope(root, m.value.kapsam)).entries.filter((e) => !expectedPaths.has(e));
}

/**
 * Bütünlük = imzalı dosyalar + (korumalı kipte) sürecin başlatma bayrakları. Enjeksiyon dosya sonucundan
 * bağımsız ölçülür ve onu GECERSIZ'e çeker (merdiven: ek süre → kısıtlı; gözlem kipinde yalnız rapor);
 * dosya raporu ve imzalı künye korunur (panel sayıları, bakım kuralı, ek süre çapası paketi tanır).
 */
export async function runIntegrityCheck(g: IntegrityCheckInput): Promise<IntegrityOutcome> {
  const files = await checkPackageFiles(g);
  if (!g.required) return files;
  const flags = g.runtimeFlags ?? { execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS };
  return withLoaderInjection(files, detectLoaderInjection(flags.execArgv, flags.nodeOptions));
}

function withLoaderInjection(files: IntegrityOutcome, injected: readonly LoaderInjection[]): IntegrityOutcome {
  if (injected.length === 0) return files;
  return { ...files, durum: "GECERSIZ", kod: "BUTUNLUK_YUKLEYICI", yukleyiciBayraklari: injected };
}

/**
 * Aynı ölçümün kararı başka bir HAK sınıfıyla — dosyalar yeniden okunmaz, `denetlendi` ölçüm anı kalır.
 * Ölçümü olmayan sonuçta (liste yok · çekirdek ölçemedi · imza/şema düştü) null: tam denetim beklenir.
 */
export function decideForClass(o: IntegrityOutcome, entitlementClass: string | null): IntegrityOutcome | null {
  if (o.olcum === null) return null;
  return withLoaderInjection(decidePackage(o.olcum, entitlementClass, isoToMs(o.denetlendi)), o.yukleyiciBayraklari);
}

/** İnsan okur neden (health lisans bloğu); yalnız bayrak adı ve kaynağı — değer basılmaz. */
export function integrityReason(o: IntegrityOutcome | null): string | null {
  if (!o || o.yukleyiciBayraklari.length === 0) return null;
  return `Node başlatma bayrağıyla kod enjeksiyonu: ${o.yukleyiciBayraklari.map((f) => `${f.bayrak} (${f.kaynak})`).join(", ")}`;
}

async function checkPackageFiles(g: IntegrityCheckInput): Promise<IntegrityOutcome> {
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
  const extra = await extraEntries(token, g.root);
  const measurement: PackageMeasurement = {
    kid: header.ok ? header.value.header.kid : null,
    rapor,
    paket: rapor.paket,
    ekFazla: extra.slice(0, EXTRA_LIST_CAP),
    ekFazlaSayisi: extra.length,
    filigran: g.watermark === undefined ? BUILD_WATERMARK : g.watermark,
  };
  return decidePackage(measurement, g.entitlementClass, now);
}

/** Ölçümden karar (tek sıra): hazırlık anahtarının sınıf kuralı → filigran → ikinci katman FAZLA → çekirdek raporu. */
function decidePackage(m: PackageMeasurement, entitlementClass: string | null, now: number): IntegrityOutcome {
  const { kid, rapor } = m;
  const shown = m.ekFazlaSayisi > 0 ? m.ekFazla : rapor.fazla;
  const base = { kid, rapor, olcum: m, fazla: shown.slice(0, EXTRA_LIST_CAP), fazlaSayisi: Math.max(m.ekFazlaSayisi, rapor.fazlaSayisi) };
  const kunye = { derlemeTarihi: m.paket.derlemeTarihi, musteri: m.paket.musteri, paketId: m.paket.paketId, surum: m.paket.surum };

  if (kid !== null && isStagingPackageKid(kid)) {
    if (entitlementClass === null) return outcome({ ...base, durum: "OLCULEMEDI", kod: "BUTUNLUK_SINIF_BILINMIYOR" }, now);
    if (!STAGING_PACKAGE_CLASSES.includes(entitlementClass)) return outcome({ ...base, durum: "GECERSIZ", kod: "BUTUNLUK_HAZIRLIK_ANAHTARI" }, now);
  }
  if (!watermarkMatches(m.filigran, kunye)) return outcome({ ...base, durum: "GECERSIZ", kod: "BUTUNLUK_FILIGRAN" }, now);
  if (rapor.durum === "GECERLI" && m.ekFazlaSayisi > 0) return outcome({ ...base, kunye, durum: "GECERSIZ", kod: "BUTUNLUK_FAZLA" }, now);
  return outcome({ ...base, kunye, durum: rapor.durum, kod: rapor.kod }, now);
}
