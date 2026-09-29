import type { LicenseMode, LicenseStatusSummary, StateTier } from "@/types/license";

/**
 * Lisans ekranı bu oturuma çizilir mi — TEK yüklem (hub karosu · palet · sayfa).
 *
 * Gözlem kipinde lisans fabrikaya sıfır farktır: durum yalnız satıcıya görünür
 * (plan §4). Kapı satıcı kapısının KENDİSİDİR (`isSuperadminGateOpen`, supaplı) —
 * ayrı, supapsız bir kimlik yüklemi yazılmaz (`docs/kurallar/yetki-izin.md`).
 * Kip bilinmiyorsa (yükleniyor/hata) gözlem sayılır: fabrikaya fail-closed.
 */
export function isLicenseScreenVisible(s: { kip: LicenseMode | null; superadminGateOpen: boolean }): boolean {
  return s.kip === "zorla" || s.superadminGateOpen;
}

export type LicenseLockKind = "restricted" | "suspended" | null;

/**
 * Kilit ekranı türü UYGULANAN kademeden türer; gözlemde backend kademeyi daima
 * NORMAL döndürdüğü için kilit hiç çizilmez (sıfır fark).
 */
export function licenseLockKind(status: Pick<LicenseStatusSummary, "kademe"> | null): LicenseLockKind {
  const tier: StateTier | undefined = status?.kademe;
  if (tier === "DURDURULMUS") return "suspended";
  if (tier === "KISITLI") return "restricted";
  return null;
}
