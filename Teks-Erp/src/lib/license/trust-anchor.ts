// Bu DERLEMENİN güven çapası kipi — kök çapası burada, PAKET çapası `integrity.ts`te aynı kipten seçilir.
// Kip derleme sabitidir (paketleme kanal kaydının `backend.guvenCapasi`ından yazar); çalışma anında ortamdan
// ya da dosyadan OKUNMAZ, böylece kurulumu yöneten biri çapayı genişletemez.
import { rootPublicKeysFor, type RootKey, type TrustAnchorMode } from "./protocol";

/** `build-korumali.mjs` esbuild `define` ile "uretim" | "hazirlik" yazar; tanımsız (geliştirme, tsc paketi) → üretim. */
declare const __TEKSERP_GUVEN_CAPASI__: string | undefined;

export const BUILD_ANCHOR_MODE: TrustAnchorMode =
  typeof __TEKSERP_GUVEN_CAPASI__ !== "undefined" && __TEKSERP_GUVEN_CAPASI__ === "hazirlik" ? "hazirlik" : "uretim";

/**
 * Bu derlemenin kök çapası. Çekirdeğe VERİLMEZ (`core-bridge.ts`): native kendi gömülü çapasıyla doğrular ve
 * yükleyici yalnız aynı kiple derlenmiş native'i kabul eder (`native.ts` `identityRejection`).
 */
export const ROOT_PUBLIC_KEYS: readonly RootKey[] = rootPublicKeysFor(BUILD_ANCHOR_MODE);
