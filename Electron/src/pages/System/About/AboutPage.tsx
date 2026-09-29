import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { CLASS_LABEL } from "../License/labels";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * HAKKINDA — görünür filigran: bu programın kime lisanslı olduğu, lisans numarası
 * ve çalışan sürümler. Veri herkese açık `GET /api/license/durum`dan; ekranın
 * kendisi `license:view` ister (manifesto `system/about`).
 */
export function AboutPage() {
  const status = useLicenseStatus();
  const panel = useAppVersion();
  const owner = status?.lisansSahibi;
  return (
    <PageShell>
      <PageHeader title="Hakkında" />
      <PageBody className="p-6">
        <Card className="max-w-xl">
          <CardContent className="pt-4">
            <Row label="Lisans sahibi" value={owner ? `${owner.musteri} · ${owner.tesis}` : "Lisanslanmamış kurulum"} />
            <Row label="Lisans numarası" value={status?.lisansNo ?? "—"} />
            <Row label="Lisans sınıfı" value={status?.sinif ? CLASS_LABEL[status.sinif] : "—"} />
            <Row label="Sunucu sürümü" value={status?.surum ?? "—"} />
            <Row label="Panel sürümü" value={panel ?? "Tarayıcı paneli"} />
          </CardContent>
        </Card>
      </PageBody>
    </PageShell>
  );
}
