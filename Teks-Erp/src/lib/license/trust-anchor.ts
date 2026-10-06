// Bu derlemenin kök çapası — tek kip (üretim); PAKET çapası `integrity.ts`te. Çapa koda gömülüdür: çalışma anında
// ortamdan, dosyadan ya da derleme sabitinden OKUNMAZ, böylece kurulumu yöneten biri çapayı genişletemez.
import { rootPublicKeysFor, type RootKey, type TrustAnchorMode } from "./protocol";

export const BUILD_ANCHOR_MODE: TrustAnchorMode = "uretim";

/**
 * Bu derlemenin kök çapası. Çekirdeğe VERİLMEZ (`core-bridge.ts`): native kendi gömülü çapasıyla doğrular ve
 * yükleyici yalnız aynı kiple derlenmiş native'i kabul eder (`native.ts` `identityRejection`).
 */
export const ROOT_PUBLIC_KEYS: readonly RootKey[] = rootPublicKeysFor(BUILD_ANCHOR_MODE);
