// Satıcıya bildirilen lisans v2 YETENEKLERİ: daraltan yeni biçimler yalnız bildiren kuruluma gider. Küme süreç
// başına BİR KEZ hesaplanır, yalnız büyüyebilir (güncelleyicinin `paket-zinciri`si görülünce eklenir) — yoklamadan
// yoklamaya düşen yetenek satıcıda `YETENEK_DUSUSU` açar.
import { LICENSE_CAPABILITIES, type LicenseCapability } from "./protocol";
import { CORE_UNAVAILABLE_CODE, type CoreResult, type LicenseCore } from "./license-core";
import { getLicenseCore } from "./native";
import { readUpdaterStatus, resolveUpdaterDir } from "./updater-ipc";

/** Fabrika kodunun kendi tükettiği biçimler: ödenmiş tarih (P) ve kiradaki parmak izi kuralı. */
const ALWAYS_DECLARED: readonly LicenseCapability[] = ["odenmis-tarih", "parmak-izi-v2"];
/** Doğrulaması çekirdekte olan biçimler: ara imzalı HAK ve iptal belgesi — çekirdek cevap vermiyorsa bildirilmez. */
const CORE_DECLARED: readonly LicenseCapability[] = ["hak-ara", "iptal"];
const PROBE_TOKEN = "x";

/** Çekirdek canlı mı: biçimsiz belgeyi KENDİ protokol koduyla reddetmeli (`CEKIRDEK_YOK` cevap değildir). */
function answers(r: CoreResult<unknown>): boolean {
  return !r.ok && r.code !== CORE_UNAVAILABLE_CODE;
}

export function capabilitiesFor(core: LicenseCore): LicenseCapability[] {
  const live = core.source !== "yok" && answers(core.verifyRevocation(PROBE_TOKEN)) && answers(core.verifyEntitlement(PROBE_TOKEN));
  const declared = new Set<LicenseCapability>([...ALWAYS_DECLARED, ...(live ? CORE_DECLARED : [])]);
  return LICENSE_CAPABILITIES.filter((c) => declared.has(c));
}

let computed: readonly LicenseCapability[] | null = null;
let updaterChainSeen = false;

/** Güncelleyici `durum.json`unda `paketZinciri: true` — süreç içinde bir kez görülünce kalır (yetenek düşmez). */
function updaterVerifiesPackageChain(): boolean {
  if (updaterChainSeen) return true;
  const { dir } = resolveUpdaterDir();
  const read = dir === null ? null : readUpdaterStatus(dir);
  updaterChainSeen = read?.kind === "ok" && read.doc.paketZinciri === true;
  return updaterChainSeen;
}

export function licenseCapabilities(): readonly LicenseCapability[] {
  computed ??= Object.freeze(capabilitiesFor(getLicenseCore()));
  if (!computed.includes("paket-zinciri") && updaterVerifiesPackageChain()) {
    const base = computed;
    computed = Object.freeze(LICENSE_CAPABILITIES.filter((c) => c === "paket-zinciri" || base.includes(c)));
  }
  return computed;
}

/** İstek gövdesindeki alan — liste boşsa alan HİÇ gitmez (eski satıcı KATI şemayla tanımadığı anahtarı reddeder). */
export function capabilitiesField(): { yetenekler?: LicenseCapability[] } {
  const list = licenseCapabilities();
  return list.length > 0 ? { yetenekler: [...list] } : {};
}

/** Test-only: bir sonraki çağrı kümeyi yeniden hesaplar. */
export function __resetLicenseCapabilitiesForTests(): void {
  computed = null;
  updaterChainSeen = false;
}
