import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { ReportDateRange } from "./ReportDateRange";
import { ReportSideRail } from "./ReportSideRail";

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** false ise tarih aralığı filtresi gizlenir (snapshot raporlar için). */
  showDateRange?: boolean;
  defaultDays?: number;
  /** Date range yerine custom filter UI'ı (örn. arama kutusu) render et. */
  filters?: ReactNode;
  children: ReactNode;
}

/**
 * Rapor sayfası iskelet: başlık + (ops.) tarih/custom filtre + scrollable içerik
 * + sağ kenar kategori-içi hızlı geçiş rail'i. Rail leaf raporlarda otomatik
 * görünür (URL `/reports/<category>/<report>` paternindeyse).
 */
export function ReportPageLayout({
  title,
  description,
  actions,
  showDateRange = true,
  defaultDays = 30,
  filters,
  children,
}: Props) {
  return (
    <PageShell className="overflow-hidden">
      <PageHeader title={title} description={description} actions={actions} />
      {filters ? filters : showDateRange ? <ReportDateRange defaultDays={defaultDays} /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PageBody className="p-4">
          <div className="mx-auto flex max-w-7xl flex-col gap-4">{children}</div>
        </PageBody>
        <ReportSideRail />
      </div>
    </PageShell>
  );
}
