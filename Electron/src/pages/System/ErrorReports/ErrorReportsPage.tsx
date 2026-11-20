import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { ErrorReportsCard } from "./ErrorReportsCard";

/**
 * HATA RAPORLARI (3.6) — müşteri onayı ve gönderilen/bekleyen grupların şeffaflık listesi.
 * Eski destek talebi ekranı (3d-2) 2026-11-20 söküldü; kart oradan buraya taşındı.
 * Manifesto `system/error-reports`, izin `admin:settings` (karo ve route AYNI kod).
 */
export function ErrorReportsPage() {
  return (
    <PageShell>
      <PageHeader title="Hata Raporları" />
      <PageBody className="p-6">
        <div className="max-w-3xl">
          <ErrorReportsCard />
        </div>
      </PageBody>
    </PageShell>
  );
}
