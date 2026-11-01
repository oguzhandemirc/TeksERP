// Kapalı modülün menü satırı / hub karosu bu oturuma görünür mü — TEK yüklem (kullanıcı kararı 2026-11-01).
// Modülü yalnız süperadmin açabildiği için açamayacak kullanıcıya kapalı girişi göstermek gürültüdür:
// soluk + "kapalı — <ayar yolu>" yalnız modülü açabilene; diğer herkese giriş hiç çizilmez.
import { useAuthStore } from "@/store/auth";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { isSuperadminGateOpen } from "./superadmin-gate";

export interface OffModuleViewer {
  isSystemAccount: boolean;
  systemAccountExists: boolean;
  isAdmin: boolean;
}

/** Kapalı modül girişlerini (soluk) görebilir mi: süperadmin; supap açıkken (sistem hesabı hiç doğmamış) fabrika yöneticisi. */
export function canSeeOffModules(v: OffModuleViewer): boolean {
  return v.isSystemAccount || (isSuperadminGateOpen(v) && v.isAdmin);
}

export type OffEntryMode = "show" | "dim" | "hide";

/** Giriş çizim kipi: açık → show; kapalı + ipucu taşıyor + görebilen → dim; aksi → hide (rejim istisnası ipucusuzdur, herkese gizli). */
export function offEntryMode(off: boolean, hasOffHint: boolean, canSee: boolean): OffEntryMode {
  if (!off) return "show";
  return hasOffHint && canSee ? "dim" : "hide";
}

/** Oturumun `canSeeOffModules` cevabı — Sidebar ve hub sayfaları bunu okur. */
export function useCanSeeOffModules(): boolean {
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const systemAccountExists = useAuthStore((s) => s.systemAccountExists);
  const { isAdmin } = useRoleAccess();
  return canSeeOffModules({ isSystemAccount, systemAccountExists, isAdmin });
}
