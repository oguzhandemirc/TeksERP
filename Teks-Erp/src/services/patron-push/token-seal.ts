// Patron push belirtecinin özeti ve saklama sarmalı. Ham belirteç bilen herhangi bir geçerli kurulum o telefona
// metin gönderebildiği için (köprü sözleşmesi §1) DB'de yalnız SARILI durur; anahtar kısa kimlik halkasından
// (LICENSE_DIR, emaneti şifreli yedekte). AAD'de özet var: sarılı değer başka satıra taşınırsa açılmaz.
import { createHash } from "node:crypto";
import { getShortCredentialKeyRing } from "../../lib/short-credential/keyring";
import { openWithRing, sealWithRing, type SealPurpose } from "../../lib/short-credential/ring-seal";
import { AppError } from "../../utils/app-error";

export const PUSH_TOKEN_SEAL_PREFIX = "ptk1:";
const PUSH_PURPOSE: SealPurpose = { prefix: PUSH_TOKEN_SEAL_PREFIX, info: "tekserp/patron-push-belirteci/v1" };

/** Köprü özeti: sha256(utf8(ham belirteç)) küçük harf hex (sözleşme §2). */
export function digestPushToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Ham → sarılı. Halka kullanılamıyorsa 503: belirteç düz metin olarak YAZILMAZ (fail-closed). */
export function sealPushToken(raw: string, digest: string): string {
  const st = getShortCredentialKeyRing();
  if (!st.ok) throw new AppError("Anahtar halkası kullanılamıyor; bildirim cihazı kaydedilemedi.", 503, true, { code: "PUSH_ANAHTAR_YOK" });
  return sealWithRing(st.ring.active, raw, PUSH_PURPOSE, digest);
}

/** Sarılı → ham; açılamıyorsa `null` (P3 dürt işi o belirteci atlar). */
export function openPushToken(stored: string, digest: string): string | null {
  const st = getShortCredentialKeyRing();
  return st.ok ? openWithRing(st.ring, stored, PUSH_PURPOSE, digest) : null;
}
