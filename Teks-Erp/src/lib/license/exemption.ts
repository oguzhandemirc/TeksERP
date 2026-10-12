// G2 MUAFİYET BELGESİ — etkinleştirme kilidinden önce doğmuş, hiç etkinleşmemiş kurulumun bugünkü davranışla sürmesinin
// TEK yolu. DB işareti değildir (kopyacı da yazabilirdi): satıcı imzalıdır (kök ya da gömülü `HAK` sertifikalı ara
// imzacı), bu kurulumun anahtarına ve makinesinin parmak izine bağlıdır. İmza çekirdekte doğrulanır.
import { anchorArgument } from "./core-bridge";
import type { MeasuredFingerprint } from "./fingerprint";
import type { JwsKey, LicenseCore } from "./license-core";
import { getLicenseCore } from "./native";
import { ExemptionSchema, IsoTimeSchema, TYP, decodeDocument, installationKeyId, isoToMs, parseJws, type ExemptionDoc, type RootKey } from "./protocol";
import type { LicenseStoreSnapshot } from "./store";

export type ExemptionRejection = "BICIM" | "SERTIFIKA" | "IMZA" | "SEMA" | "ANAHTAR" | "PARMAK_IZI";
export type ExemptionCheck = { readonly ok: true; readonly doc: ExemptionDoc } | { readonly ok: false; readonly code: ExemptionRejection };

const fail = (code: ExemptionRejection): ExemptionCheck => ({ ok: false, code });

/** İmzacının anahtarı: gömülü sertifika varsa çekirdekte doğrulanmış `HAK` sertifikası, yoksa kökler. */
function signerKeys(payload: Record<string, unknown>, roots: readonly RootKey[], core: LicenseCore): readonly JwsKey[] | null {
  const cert = payload.imzaciSertifikasi;
  if (cert === undefined) return roots.map((r) => ({ kid: r.kid, x: r.x }));
  const at = IsoTimeSchema.safeParse(payload.verilis);
  if (!at.success) return null;
  const v = core.verifyCertificate(cert, { usage: "HAK", atMs: isoToMs(at.data), roots: anchorArgument(roots) });
  return v.ok ? [{ kid: v.value.document.kid, x: v.value.document.x }] : null;
}

/**
 * Belgeyi doğrular ve bu kuruluma bağlar. Parmak izi henüz ölçülmediyse (açılışın ilk saniyeleri) anahtar bağı yeter —
 * ölçüm gelince eşleşmeyen makine muafiyeti kaybeder; ölçülemeyen etken çekirdeğin kuralıyla değerlendirilir.
 */
export function verifyExemption(
  jws: unknown,
  g: { readonly keyX: string; readonly roots: readonly RootKey[]; readonly fingerprint: MeasuredFingerprint | null; readonly core?: LicenseCore },
): ExemptionCheck {
  const core = g.core ?? getLicenseCore();
  const parsed = parseJws(jws);
  if (!parsed.ok) return fail("BICIM");
  const keys = signerKeys(parsed.value.payload, g.roots, core);
  if (!keys) return fail("SERTIFIKA");
  const v = core.verifyJws(jws, TYP.MUAFIYET, keys);
  if (!v.ok) return fail("IMZA");
  const doc = decodeDocument(ExemptionSchema, v.value.payload);
  if (!doc.ok) return fail("SEMA");
  if (doc.value.kurulumAnahtarKimligi !== installationKeyId(g.keyX)) return fail("ANAHTAR");
  if (g.fingerprint && core.compareFingerprints(doc.value.parmakIzi, g.fingerprint.digest, { rule: "standart" }).result === "ESLESMEDI") {
    return fail("PARMAK_IZI");
  }
  return { ok: true, doc: doc.value };
}

/** Kilit sınıflaması için: depodaki belge bu kurulumda geçerli mi (yok/bozuk/başka makine → false). */
export function exemptionHolds(g: {
  readonly store: LicenseStoreSnapshot | null;
  readonly fingerprint: MeasuredFingerprint | null;
  readonly roots: readonly RootKey[];
}): boolean {
  const jws = g.store?.exemptionJws ?? null;
  const keyX = g.store?.key?.x ?? null;
  if (!jws || !keyX) return false;
  return verifyExemption(jws, { keyX, roots: g.roots, fingerprint: g.fingerprint }).ok;
}
