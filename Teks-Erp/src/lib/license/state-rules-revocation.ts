// İptal belgesi KURALI (G4, saf): kira ya da durum kaydı pini bir iptal sırası istiyorsa elde en az o sırada doğrulanmış
// belge olmalı — yoksa iptal yanıttan ayıklanmış ya da kopyalar silinmiş olabilir: zincir ölçülemez (`IPTAL_BELGESI_KAYIP`).
// Kira ve HAK bu yüzden düşürülmez; bulgu ölçülemedi merdivenine girer.
import type { VerifiedLease } from "./protocol";
import { UNMEASURED_BANNER, type Finding, type LicenseStateInput } from "./state-rules";

/** Pin: verilen sıraların en büyüğü (yoksa null) — bir kez görülen sıra geri inmez. */
export function revocationPin(...values: ReadonlyArray<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1);
  return valid.length > 0 ? Math.max(...valid) : null;
}

/** Gereken sıra: durum kaydı pini ∨ kullanılabilir kiranın `iptalSira`sı. */
export function requiredRevocationSira(g: Pick<LicenseStateInput, "iptalPini">, lease: VerifiedLease | null): number {
  return revocationPin(g.iptalPini, lease?.document.iptalSira) ?? 0;
}

export function evaluateRevocation(g: LicenseStateInput, lease: VerifiedLease | null, out: Finding[]): void {
  if (g.iptal === undefined) return;
  const required = requiredRevocationSira(g, lease);
  const held = g.iptal.sira ?? 0;
  if (held >= required) return;
  const fromLease = (lease?.document.iptalSira ?? 0) > held;
  const detail = g.iptal.okunamadi ? "OKUNAMADI" : fromLease ? "KIRA" : "PIN";
  out.push({ code: "IPTAL_BELGESI_KAYIP", detail, tier: "UYARI", banner: UNMEASURED_BANNER });
}
