// =============================================================================
// Fabrika JWT sırrının kabul kapısı — TEK yüklem
// =============================================================================
// Açılış (`auth.service.ts`), ilk kurulum seed'i ve `scripts/jwt-sir.ts` (paket aracı)
// AYNI fonksiyonu çağırır. Ret listesi DEĞER değil SHA-256 ÖZET tutar.
// Bilinen/zayıf sır MEVCUT kurulumu durdurmaz (fabrika aniden durmaz): açılış uyarır ve
// sağlık bayrağı kalkar; açılışı yalnız bugün de durduran sınıflar (yok/kısa) durdurur.
// YENİ kurulum yolu (seed, Docker ilk `up`) bilinen/zayıf sırrı reddeder.
// =============================================================================

import { createHash } from "node:crypto";

export const JWT_SECRET_MIN_LENGTH = 32;
/** Bundan az farklı karakterli sır "aaaa…" / "1234…" sınıfıdır — tahmin edilebilir. */
export const JWT_SECRET_MIN_DISTINCT_CHARS = 8;

/**
 * Depoda ya da depo geçmişinde görünmüş JWT_SECRET değerlerinin özetleri. Kaynağı
 * `test_jwt_sir_kapisi` ölçer: izlenen dosyalardaki her uzun değer bu kümede olmalı.
 * Yeni satır yalnız EKLENİR (bir değer bir kez açığa çıktıysa sonsuza dek bilinir).
 */
export const KNOWN_JWT_SECRET_DIGESTS: ReadonlySet<string> = new Set([
  // Depo geçmişinde izlenmiş .env ve example-env.txt örneği — aynı değer.
  "defc3dc071b3cceb0b60b295e683eadce9a70f1802333f2b29ac5243e1165723",
  // .env.docker.example örneği.
  "d6cf868da02fc4e126d0c851d466b5fdd914e8ff67dd19d46edbd203beb60c12",
  // CI ve belgelerde yazan test değeri.
  "fe5c1f1554883b6bfb2c0b4a081e66c76b59f76680f95e996699549cfaf979f4",
  // .env.example'ın eski bir sürümündeki örnek.
  "97d9f4844203a04a4a195930286199f1f582c0be908bc31a14345396f89e0c10",
]);

export type JwtSecretRejectCode = "EKSIK" | "KISA" | "ZAYIF" | "BILINEN";
export type JwtSecretVerdict = { ok: true } | { ok: false; kod: JwtSecretRejectCode; mesaj: string };

export function jwtSecretDigest(deger: string): string {
  return createHash("sha256").update(deger, "utf8").digest("hex");
}

const ROTATION_HINT = "Yeni sır üretin (openssl rand -hex 32) — reçete: docs/ops/JWT-SIR-ROTASYONU.md.";

/** Mesajlar değeri ASLA içermez (log, kurulum çıktısı). */
export function checkJwtSecret(
  deger: string | undefined | null,
  bilinenler: ReadonlySet<string> = KNOWN_JWT_SECRET_DIGESTS,
): JwtSecretVerdict {
  if (!deger) {
    return { ok: false, kod: "EKSIK", mesaj: `JWT_SECRET tanımlı değil. .env dosyasını kontrol edin. ${ROTATION_HINT}` };
  }
  if (deger.length < JWT_SECRET_MIN_LENGTH) {
    return {
      ok: false,
      kod: "KISA",
      mesaj: `JWT_SECRET en az ${JWT_SECRET_MIN_LENGTH} karakter olmalı. ${ROTATION_HINT}`,
    };
  }
  if (new Set(deger).size < JWT_SECRET_MIN_DISTINCT_CHARS) {
    return {
      ok: false,
      kod: "ZAYIF",
      mesaj: `JWT_SECRET tahmin edilebilir (en az ${JWT_SECRET_MIN_DISTINCT_CHARS} farklı karakter gerekli). ${ROTATION_HINT}`,
    };
  }
  if (bilinenler.has(jwtSecretDigest(deger)) || bilinenler.has(jwtSecretDigest(deger.trim()))) {
    return {
      ok: false,
      kod: "BILINEN",
      mesaj: `JWT_SECRET depoda/örnek dosyalarda yazan BİLİNEN bir değer — bu sırla token sahtelenebilir. ${ROTATION_HINT}`,
    };
  }
  return { ok: true };
}

/** Açılışı DURDURAN sınıflar — bugün de durduranlar. Kalanı yalnız uyarır. */
const BOOT_BLOCKING_CODES: ReadonlySet<JwtSecretRejectCode> = new Set<JwtSecretRejectCode>(["EKSIK", "KISA"]);

let bootWarning: JwtSecretRejectCode | null = null;

/**
 * Backend açılışının sır kapısı: yok/kısa → hata (açılış durur); bilinen/zayıf → `uyar`
 * çağrılır, sağlık bayrağı kalkar, sır kabul edilir. Dönüş: kullanılacak sır.
 */
export function loadJwtSecretAtBoot(
  deger: string | undefined,
  uyar: (mesaj: string) => void,
): string {
  const karar = checkJwtSecret(deger);
  if (karar.ok) {
    bootWarning = null;
    return deger as string;
  }
  if (BOOT_BLOCKING_CODES.has(karar.kod)) throw new Error(karar.mesaj);
  bootWarning = karar.kod;
  uyar(karar.mesaj);
  return deger as string;
}

/** `/api/admin/health` → `jwtSecret`. Değer ya da özet TAŞIMAZ; yalnız sınıf. */
export function jwtSecretHealth(): { status: "OK" | "BILINEN" | "ZAYIF"; rotationRequired: boolean } {
  const status = bootWarning === "BILINEN" || bootWarning === "ZAYIF" ? bootWarning : "OK";
  return { status, rotationRequired: status !== "OK" };
}
