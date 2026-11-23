import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { REPORT_BY_KEY, type ReportKey } from "@/lib/report-catalog";
import { ReportDateFilter } from "./ReportDateFilter";
import { LegacyReportBanner } from "./LegacyReportBanner";

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
 * Rapor yaprağının TEK iskeleti — v2 çerçevesiyle (`_v2/view/ReportV2Frame`) aynı düzen: sabit başlık
 * (açıklama ⓘ'de, eylemler sağda) → TEK kaydırıcı: soluk soru satırı → filtre şeridi → tam genişlik gövde.
 * Dar ortalanmış sütun ve sağ kategori şeridi yok; kategori içi geçiş Rapor Merkezi'nden.
 */
export function ReportPageLayout({ title, description, actions, reportKey, showCompare = false, filters, children }: Props) {
  // ⚠️ SORU CÜMLESİ TEK YERDEN ve KATALOGTAN (report-question): sayfa kendi cümlesini yazarsa
  // katalogla ekran ayrışır. `description` raporun İÇERİĞİNİ, `soru` NE SORUYA cevap verdiğini söyler.
  const soru = reportKey ? (REPORT_BY_KEY.get(reportKey)?.soru ?? null) : null;
  const info = [soru, description].filter(Boolean).join(" — ") || undefined;
  return (
    <PageShell className="overflow-hidden">
      <PageHeader
        title={title}
        description={info}
        actionsAlign="center"
        actions={
          <>
            {/* Taşınan aracın yeni yeri: başlıkta küçük bağlantı (akışta bant değil). */}
            <LegacyReportBanner reportKey={reportKey} />
            {actions}
          </>
        }
      />
      <PageBody className="relative" data-testid="report-scroll">
        {soru ? (
          <div className="px-4 pt-2 pb-1.5">
            <p className="truncate text-sm text-muted-foreground" data-testid="report-question" title={soru}>
              {soru}
            </p>
          </div>
        ) : null}
        {filters ? filters : reportKey ? <ReportDateFilter reportKey={reportKey} showCompare={showCompare} /> : null}
        <div className="flex flex-col gap-4 p-4">{children}</div>
      </PageBody>
    </PageShell>
  );
}
