// Parmak izi ÇOK YOLLU okuma (K8): etken başına sabit öncelikli yol tablosu + saf seçim. G/Ç yok —
// toplayıcı (`fingerprint-os.ts`) yolların ham sonucunu üretir, seçim burada. Native çekirdek
// (`native/lisans-cekirdek/src/paths.rs`) bu dosyanın AYNASIDIR: tablo satır satır aynı (kâhin §0d'),
// seçim aynı vektörlerde aynı sonucu verir (`test-vektorleri/toplama.json`, cargo `tests/toplama.rs`).
import { FINGERPRINT_FACTORS, digestFingerprint, normalizeFactor, type Fingerprint, type FingerprintFactor } from "./protocol";

export type OsFactor = Exclude<FingerprintFactor, "f5">;
export const OS_FACTORS: readonly OsFactor[] = Object.freeze(["f1", "f2", "f3", "f4"]);
export const PROBE_PLATFORMS = ["win32", "linux", "darwin"] as const;
export type ProbePlatform = (typeof PROBE_PLATFORMS)[number];

/**
 * `tur` aynı DEĞERİ veren yolları toplar: bir tür ancak önceki türün en az bir yolu KESİN cevap verip (okundu ama
 * anlamsız/boş) hiçbiri kullanılabilir değer vermediyse denenir — önceki tür yalnız hata verdiyse etken OKUNAMADI
 * kalır (önbellek köprüler), geçici bir arıza başka türde bir değere geçip sahte uyuşmazlık doğurmaz.
 */
export interface FingerprintPath {
  readonly platform: ProbePlatform;
  readonly factor: OsFactor;
  readonly tur: number;
  readonly id: string;
}

// Kesin liste thinkpad-1 (Win11, NVMe) salt-okuma ölçümüyle dondu: aynı türün her yolu aynı özeti verdi.
// f3'te SERİ önce (Get-Disk · MSFT_Disk · Win32_DiskDrive üçü aynı değeri verir; Storage sağlayıcısı düşük
// yetkide reddetse de Win32_DiskDrive okur), UniqueId yalnız seri anlamsızsa (RAID "Volume0").
const TABLE = `
win32|f1|1|f1.kayit
win32|f1|1|f1.kayit-net64
win32|f2|1|f2.cim
win32|f2|1|f2.wmi
win32|f2|1|f2.donanim-kaydi
win32|f3|1|f3.disk-seri
win32|f3|1|f3.msft-disk-seri
win32|f3|1|f3.win32-disk-seri
win32|f3|2|f3.disk-kimlik
win32|f3|2|f3.msft-disk-kimlik
win32|f4|1|f4.cim-bios
win32|f4|1|f4.wmi-bios
win32|f4|1|f4.smbios-sistem
win32|f4|2|f4.cim-anakart
win32|f4|2|f4.wmi-anakart
win32|f4|2|f4.smbios-anakart
linux|f1|1|f1.machine-id
linux|f1|1|f1.dbus-machine-id
linux|f2|1|f2.dmi-uuid
linux|f2|1|f2.smbios-uuid
linux|f3|1|f3.udev-seri
linux|f3|2|f3.sysfs-aygit-seri
linux|f3|3|f3.sysfs-seri
linux|f3|4|f3.sysfs-wwid
linux|f4|1|f4.dmi-sistem
linux|f4|1|f4.smbios-sistem
linux|f4|2|f4.dmi-anakart
linux|f4|2|f4.smbios-anakart
darwin|f1|1|f1.ioreg-uuid
darwin|f4|1|f4.ioreg-seri
`;

/** Yol tablosunun satır metni (`platform|etken|tür|kimlik`) — kâhin Rust `PATHS` dizisiyle birebir kıyaslar. */
export const FINGERPRINT_PATH_LINES: readonly string[] = Object.freeze(TABLE.trim().split("\n"));

export const FINGERPRINT_PATHS: readonly FingerprintPath[] = Object.freeze(
  FINGERPRINT_PATH_LINES.map((line) => {
    const [platform, factor, tur, id] = line.split("|");
    return Object.freeze({ platform: platform as ProbePlatform, factor: factor as OsFactor, tur: Number(tur), id });
  }),
);

export function pathsFor(platform: ProbePlatform): readonly FingerprintPath[] {
  return FINGERPRINT_PATHS.filter((p) => p.platform === platform);
}

/** Yolun ham sonucu: metin (boş = okundu ama değer yok) ya da `null` = OKUNAMADI (hata · zaman aşımı · yanıt yok). */
export type PathOutcomes = Readonly<Record<string, string | null>>;

export const FACTOR_READ_STATES = ["OKUNDU", "DEGER_YOK", "OKUNAMADI"] as const;
export type FactorReadState = (typeof FACTOR_READ_STATES)[number];

export interface FactorReading {
  readonly durum: FactorReadState;
  /** Kazanan yol (yalnız OKUNDU). */
  readonly yol: string | null;
  /** Kazananla aynı türde kullanılabilir ama FARKLI değer veren yollar — yalnız bilgi. */
  readonly celiski: readonly string[];
  /** Hata veren yollar (tablo sırasıyla; yalnız bilgi — düşük yetkide hangi arayüz kapalı). */
  readonly hatali: readonly string[];
}

export type OsReadings = Readonly<Record<OsFactor, FactorReading>>;
export type OsRaw = Readonly<Record<OsFactor, string | null>>;

const UNREAD: FactorReading = Object.freeze({ durum: "OKUNAMADI", yol: null, celiski: Object.freeze([]), hatali: Object.freeze([]) });

/** Toplayıcı hiç koşamadıysa (çekirdek yok · sözleşme dışı yanıt): dört etken OKUNAMADI. */
export const UNREAD_OS_READINGS: OsReadings = Object.freeze({ f1: UNREAD, f2: UNREAD, f3: UNREAD, f4: UNREAD });

/** Tek etkenin seçimi: türler sırayla; tür içinde ilk kullanılabilir değer kazanır. */
export function selectFactor(
  factor: FingerprintFactor,
  paths: readonly { readonly tur: number; readonly id: string }[],
  outcomes: PathOutcomes,
): { readonly raw: string | null; readonly reading: FactorReading } {
  const outcomeOf = (id: string): string | null => (Object.prototype.hasOwnProperty.call(outcomes, id) ? outcomes[id] : null);
  const failed = paths.filter((p) => outcomeOf(p.id) === null).map((p) => p.id);
  const kinds = [...new Set(paths.map((p) => p.tur))].sort((a, b) => a - b);
  for (const kind of kinds) {
    const group = paths.filter((p) => p.tur === kind);
    const usable = group.flatMap((p) => {
      const raw = outcomeOf(p.id);
      const norm = normalizeFactor(factor, raw);
      return raw !== null && norm !== null ? [{ id: p.id, raw, norm }] : [];
    });
    if (usable.length > 0) {
      const [winner, ...rest] = usable;
      const conflicts = rest.filter((u) => u.norm !== winner.norm).map((u) => u.id);
      return { raw: winner.raw, reading: { durum: "OKUNDU", yol: winner.id, celiski: conflicts, hatali: failed } };
    }
    if (group.every((p) => outcomeOf(p.id) === null)) {
      return { raw: null, reading: { durum: "OKUNAMADI", yol: null, celiski: [], hatali: failed } };
    }
  }
  return { raw: null, reading: { durum: "DEGER_YOK", yol: null, celiski: [], hatali: failed } };
}

/** Platformun f1..f4 seçimi: ham kazanan değerler (özete gider) + etken başına okuma raporu. */
export function selectOsFactors(platform: ProbePlatform, outcomes: PathOutcomes): { readonly raw: OsRaw; readonly okuma: OsReadings } {
  const paths = pathsFor(platform);
  const raw: Record<OsFactor, string | null> = { f1: null, f2: null, f3: null, f4: null };
  const readings: Record<OsFactor, FactorReading> = { f1: UNREAD, f2: UNREAD, f3: UNREAD, f4: UNREAD };
  for (const factor of OS_FACTORS) {
    const s = selectFactor(factor, paths.filter((p) => p.factor === factor), outcomes);
    raw[factor] = s.raw;
    readings[factor] = s.reading;
  }
  return { raw, okuma: readings };
}

/** Toplayıcının çıktısı (çekirdek sözleşmesi `CollectedFingerprint`): tuzlu özet · ölçüldü mü · f1..f4 okuma raporu. */
export interface CollectedOs {
  readonly digest: Fingerprint;
  readonly measured: Readonly<Record<FingerprintFactor, boolean>>;
  readonly okuma: OsReadings;
}

/**
 * Yol sonuçlarından çekirdek çıktısına: seçim + çağıranın F5'i + tuzlu özet. TS çekirdeği ve vektörler bunu çağırır;
 * native `api.rs` `collected_value` aynası. Platform tabloda yoksa (`null`) dört etken OKUNAMADI.
 */
export function collectedFrom(platform: ProbePlatform | null, outcomes: PathOutcomes, salt: Uint8Array, f5: string | null): CollectedOs {
  const os = platform ? selectOsFactors(platform, outcomes) : { raw: { f1: null, f2: null, f3: null, f4: null }, okuma: UNREAD_OS_READINGS };
  const digest = digestFingerprint({ ...os.raw, f5 }, salt);
  const measured = Object.fromEntries(FINGERPRINT_FACTORS.map((f) => [f, digest[f] !== null])) as Record<FingerprintFactor, boolean>;
  return { digest, measured, okuma: os.okuma };
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Native'in (serde) hiç çözemediği satır — tek başına vekil (lone surrogate): TS de satırı bütünüyle yok sayar. */
function nativeRejects(v: unknown): boolean {
  if (typeof v === "string") return LONE_SURROGATE.test(v);
  if (Array.isArray(v)) return v.some(nativeRejects);
  if (typeof v === "object" && v !== null) return Object.entries(v).some(([k, x]) => LONE_SURROGATE.test(k) || nativeRejects(x));
  return false;
}

/**
 * Windows sondasının çıktısı: satır başına bir JSON nesnesi `{"y":<yol>,"v":<metin>}` ya da `{"y":<yol>,"h":1}`.
 * Süreç zaman aşımında öldürülse de o ana dek basılan satırlar sayılır; çözülemeyen satır yok sayılır, aynı yolun
 * ilk satırı kazanır, gelmeyen yol OKUNAMADI. Native `paths.rs` `parse_windows_output` aynası.
 */
export function parseWindowsProbeOutput(stdout: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof o !== "object" || o === null || Array.isArray(o) || nativeRejects(o)) continue;
    const rec = o as Record<string, unknown>;
    if (typeof rec.y !== "string" || Object.prototype.hasOwnProperty.call(out, rec.y)) continue;
    out[rec.y] = typeof rec.v === "string" ? rec.v : null;
  }
  return out;
}
