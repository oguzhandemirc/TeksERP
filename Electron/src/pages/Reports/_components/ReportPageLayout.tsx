import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { REPORT_BY_KEY, type ReportKey } from "@/lib/report-catalog";
import { ReportDateFilter } from "./ReportDateFilter";
import { ReportSideRail } from "./ReportSideRail";

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
  /**
   * Katalog anahtarı — tarih filtresi bu anahtarın `tarih` sözleşmesinden çizilir
   * (`yok` ⇒ hiç çizilmez). `filters` verilirse düzen çizmez; şerit `ReportDateFilter`i
   * kendisi gömer (ham tarih girdisi çizmez — bekçi ölçer).
   */
  reportKey?: ReportKey;
  /** Dönem karşılaştırma seçicisi — yalnız karşılaştırmayı DESTEKLEYEN raporlarda. */
  showCompare?: boolean;
  /** Tarih filtresi yerine özel filtre şeridi (örn. arama kutusu, ya da tarih + ek eksenler). */
  filters?: ReactNode;
  children: ReactNode;
}

/**
 * Rapor sayfası iskelet: başlık + (ops.) tarih/özel filtre + kaydırılabilir içerik
 * + sağ kenar kategori-içi hızlı geçiş rail'i. Rail leaf raporlarda otomatik
 * görünür (URL `/reports/<category>/<report>` paternindeyse).
 */
export function ReportPageLayout({ title, description, actions, reportKey, showCompare = false, filters, children }: Props) {
  // ⚠️ SORU CÜMLESİ TEK YERDEN ve KATALOGTAN: her rapor "neyi cevapladığını"
  // başlığının altında söyler. Metni sayfa yazsaydı katalogla ekran ayrışır ve
  // hangisinin doğru olduğu ölçülemezdi (kapı: sayfa kendi cümlesini yazarsa
  // kırmızı). Anahtar `reportKey` propundan gelir — adresten TAHMİN edilmez.
  // `description` raporun İÇERİĞİNİ tarif eder, `soru` NE SORUYA cevap verdiğini;
  // ikisi farklı iş yapar, ikisi de kalır.
  const soru = reportKey ? (REPORT_BY_KEY.get(reportKey)?.soru ?? null) : null;
  return (
    <PageShell className="overflow-hidden">
      <PageHeader title={title} description={description} actions={actions} />
      {soru ? (
        <p className="border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Bu rapor şunu cevaplar:</span> {soru}
        </p>
      ) : null}
      {filters ? filters : reportKey ? <ReportDateFilter reportKey={reportKey} showCompare={showCompare} /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PageBody className="p-4">
          <div className="mx-auto flex max-w-7xl flex-col gap-4">{children}</div>
        </PageBody>
        <ReportSideRail />
      </div>
    </PageShell>
  );
}
