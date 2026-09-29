// Native lisans çekirdeği YÜKLEYİCİSİ. Native `.node` varsa ve künyesi (arayüz sürümü · platform ·
// mimari) uyuyorsa onu kullanır; yoksa TS yoluna düşer (geliştirme ve test). Üretim paketinde (2b)
// native ZORUNLUDUR: derleme sabiti `__TEKSERP_NATIVE_REQUIRED__` (esbuild `define`) açıkken TS'e
// DÜŞÜLMEZ — silinen/uymayan çekirdek, her doğrulamayı `CEKIRDEK_YOK` ile düşüren ve bütünlüğü
// GEÇERSİZ sayan bir çekirdeğe çevrilir (lisans merdiveni: uyarı → ek süre → kısıtlı; süreç düşmez).
// Adaptör (sözleşme şemaları, native ve "yok" çekirdekleri): `native-adapter.ts`.
import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { tsLicenseCore, type LicenseCore } from "./license-core";
import { isNativeBinding, nativeCore, unavailableCore, type NativeBinding } from "./native-adapter";

/** Paketleme (2b) esbuild `define` ile `true` yapar; geliştirmede tanımsızdır → zorunlu değil. */
declare const __TEKSERP_NATIVE_REQUIRED__: boolean | undefined;
export const NATIVE_REQUIRED: boolean = typeof __TEKSERP_NATIVE_REQUIRED__ !== "undefined" && __TEKSERP_NATIVE_REQUIRED__ === true;

/** Native `api::ABI` ile eşit olmalı: istek/yanıt biçimi kırılınca ikisi birlikte artar. */
export const NATIVE_ABI = 1;
/** Açık dosya yolu (geliştirme/test); ZORUNLU kipte OKUNMAZ — yamalı çekirdek enjekte edilemesin. */
export const NATIVE_PATH_ENV = "TEKSERP_LISANS_CEKIRDEK";

export type FallbackReason = "PLATFORM_DESTEKSIZ" | "DOSYA_YOK" | "YUKLENEMEDI" | "KUNYE_UYUSMAZ" | "TEST_DERLEMESI";

export interface NativeIdentity {
  readonly ad: string;
  readonly surum: string;
  readonly abi: number;
  readonly platform: string;
  readonly arch: string;
  readonly hedef: string;
  readonly profil: string;
  readonly testCapasi: boolean;
  readonly protokolKodlari: readonly string[];
  readonly cekirdekKodlari: readonly string[];
  readonly yerTutucular: readonly string[];
  readonly windowsSondasi: readonly string[];
  readonly modulHkdfOneki: string;
}

export type CoreLoadStatus =
  | { readonly kaynak: "native"; readonly dosya: string; readonly kunye: NativeIdentity; readonly zorunlu: boolean }
  | {
      readonly kaynak: "ts" | "yok";
      readonly neden: FallbackReason;
      readonly ayrinti: string;
      readonly denenen: readonly string[];
      readonly zorunlu: boolean;
    };

export interface LoaderOptions {
  readonly required: boolean;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: string;
  readonly arch: string;
}

/** napi-rs adlandırması: `lisans-cekirdek.<platform>-<arch>[-<abi>].node`; desteklenmeyen hedef `null`. */
export function nativeFileName(platform: string, arch: string): string | null {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return `lisans-cekirdek.darwin-${arch}.node`;
  if (platform === "win32" && arch === "x64") return "lisans-cekirdek.win32-x64-msvc.node";
  if (platform === "linux" && (arch === "x64" || arch === "arm64")) return `lisans-cekirdek.linux-${arch}-gnu.node`;
  return null;
}

/**
 * Aday yollar, öncelik sırasıyla. Paket düzeni (2b) `app/native/<dosya>` (süreç `app/` kökünde
 * başlar); geliştirme düzeni `Teks-Erp/native/lisans-cekirdek/dist/<dosya>`. Zorunlu kipte YALNIZ paket.
 */
export function nativeCandidates(o: LoaderOptions): string[] {
  const file = nativeFileName(o.platform, o.arch);
  if (!file) return [];
  const packaged = path.join(o.cwd, "native", file);
  if (o.required) return [packaged];
  const explicit = o.env[NATIVE_PATH_ENV];
  return [...(explicit ? [path.resolve(o.cwd, explicit)] : []), packaged, path.join(o.cwd, "native", "lisans-cekirdek", "dist", file)];
}

const NativeIdentitySchema = z.object({
  ad: z.literal("lisans-cekirdek"),
  surum: z.string(),
  abi: z.number().int(),
  platform: z.string(),
  arch: z.string(),
  hedef: z.string(),
  profil: z.string(),
  testCapasi: z.boolean(),
  protokolKodlari: z.array(z.string()),
  cekirdekKodlari: z.array(z.string()),
  yerTutucular: z.array(z.string()),
  windowsSondasi: z.array(z.string()),
  modulHkdfOneki: z.string(),
});

// Aynı `.node` bir süreçte BİR KEZ açılır (napi modülünü ikinci kez kaydetmek tanımsız davranıştır).
const openedBindings = new Map<string, NativeBinding>();

function openBinding(file: string): NativeBinding {
  const cached = openedBindings.get(file);
  if (cached) return cached;
  const holder: { exports: unknown } = { exports: {} };
  process.dlopen(holder, file);
  if (!isNativeBinding(holder.exports)) throw new Error("beklenen fonksiyonlar dışa aktarılmamış");
  openedBindings.set(file, holder.exports);
  return holder.exports;
}

export interface LoadedCore {
  readonly core: LicenseCore;
  readonly status: CoreLoadStatus;
}

/** Künye kabul kararı (saf): arayüz sürümü + platform + mimari eşit olmalı; zorunlu kipte test çapalı derleme RED. */
export function identityRejection(
  id: Pick<NativeIdentity, "abi" | "platform" | "arch" | "testCapasi">,
  o: Pick<LoaderOptions, "required" | "platform" | "arch">,
): { readonly neden: FallbackReason; readonly ayrinti: string } | null {
  if (id.abi !== NATIVE_ABI || id.platform !== o.platform || id.arch !== o.arch) {
    return { neden: "KUNYE_UYUSMAZ", ayrinti: `native abi ${id.abi} ${id.platform}-${id.arch}, beklenen abi ${NATIVE_ABI} ${o.platform}-${o.arch}` };
  }
  if (o.required && id.testCapasi) return { neden: "TEST_DERLEMESI", ayrinti: "üretimde test çapalı native derlemesi kabul edilmez" };
  return null;
}

/** Saf yükleme (önbelleksiz) — bekçiler farklı kip/yol/platformla çağırır. */
export function loadLicenseCoreFrom(o: LoaderOptions): LoadedCore {
  const tried = nativeCandidates(o);
  const fallback = (neden: FallbackReason, ayrinti: string): LoadedCore => {
    const status: CoreLoadStatus = { kaynak: o.required ? "yok" : "ts", neden, ayrinti, denenen: tried, zorunlu: o.required };
    return { core: o.required ? unavailableCore(`${neden} — ${ayrinti}`) : tsLicenseCore, status };
  };
  if (tried.length === 0) return fallback("PLATFORM_DESTEKSIZ", `${o.platform}-${o.arch} için native derleme yok`);
  const file = tried.find((f) => existsSync(f));
  if (!file) return fallback("DOSYA_YOK", "native .node bulunamadı");
  let binding: NativeBinding;
  let identity: NativeIdentity;
  try {
    binding = openBinding(file);
    identity = NativeIdentitySchema.parse(JSON.parse(binding.kunye()));
  } catch (e) {
    return fallback("YUKLENEMEDI", `${path.basename(file)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const rejection = identityRejection(identity, o);
  if (rejection) return fallback(rejection.neden, rejection.ayrinti);
  return { core: nativeCore(binding), status: { kaynak: "native", dosya: file, kunye: identity, zorunlu: o.required } };
}

let loaded: LoadedCore | null = null;

function defaultOptions(): LoaderOptions {
  return { required: NATIVE_REQUIRED, cwd: process.cwd(), env: process.env, platform: process.platform, arch: process.arch };
}

/** Süreç boyunca tek çekirdek (ilk çağrıda yüklenir). */
export function getLicenseCore(): LicenseCore {
  loaded ??= loadLicenseCoreFrom(defaultOptions());
  return loaded.core;
}

export function getLicenseCoreStatus(): CoreLoadStatus {
  loaded ??= loadLicenseCoreFrom(defaultOptions());
  return loaded.status;
}

/** Test-only: bir sonraki çağrı çekirdeği yeniden yükler (açılmış `.node` önbellekte kalır). */
export function resetLicenseCoreForTests(): void {
  loaded = null;
}
