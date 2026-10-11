import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/store/auth";

/** Kurulu sunucuda tek seferlik mühürleme komutu; Docker/Windows ayrıntısı kurulum belgesinde. */
export const SEAL_COMMAND = "node dist/tools/superadmin-olustur.cjs --muhurle";
export const SEAL_DOC = "SUPERADMIN-KURULUM belgesi (docs/ops/SUPERADMIN-KURULUM.md)";

/**
 * Sistem hesabı mührü (G1): `pending` mühürlenmemiş kurulum, `invalid` mührü geçersiz hesap (yetki
 * verilmedi). Ölçüt sunucuda (`systemAccountSealStatus`); kapatılamaz, durum düzelince kalkar.
 */
export function SystemAccountSealBanner() {
  const status = useAuthStore((s) => s.systemAccountSealStatus);
  if (status !== "pending" && status !== "invalid") return null;
  return (
    <div
      role="alert"
      data-testid="sistem-hesabi-muhur-bandi"
      data-durum={status}
      className="flex shrink-0 items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {status === "pending"
          ? "Sistem hesabı mühürlenmemiş — sunucuda tek seferlik komut: "
          : "Mührü geçersiz bir sistem hesabı var; yetki verilmedi. Tanımadığınız hesabı Kullanıcılar ekranından pasife alın; gerçek hesapsa sunucuda: "}
        <code className="rounded bg-destructive/10 px-1 font-mono">{SEAL_COMMAND}</code>
        {` — ayrıntı: ${SEAL_DOC}.`}
      </span>
    </div>
  );
}
