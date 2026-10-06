// HATA RAPORLARI — fabrikaların ONAYIYLA gelen, kişisel verisiz hata özetleri (kurulum imzalı `/v1/hata-raporu`).
// Kurulum bazında özet; ayrıntıda gruplar (kaynak süzmesi sunucuda). İçerik yalnız kod/sınıf/sürüm/yer/sayıdır.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { Badge, PageTitle, QueryState, Section, Table } from "../../shared/ui";
import { installationPath, type SupportInstallation } from "./Support";

export const ERROR_SOURCE_LABEL: Record<string, string> = { sunucu: "Sunucu", panel: "Panel", tablet: "Tablet" };

export interface ErrorReportSummaryRow {
  readonly kurulum: SupportInstallation | null;
  readonly grupSayisi: number;
  readonly toplam: number;
  readonly sonGorulme: string | null;
}

export interface ErrorReportGroupRow {
  readonly id: string;
  readonly kaynak: string;
  readonly surum: string;
  readonly kod: string;
  readonly sinif: string;
  readonly bilesen: string;
  readonly yol: string | null;
  readonly yigin: readonly string[];
  readonly sayi: number;
  readonly ilk: string;
  readonly son: string;
}

export function ErrorReportsPage() {
  const q = useGet<{ items: ErrorReportSummaryRow[] }>(["hata-raporlari"], "/hata-raporlari", { limit: 200 });
  const rows = (q.data?.items ?? []).filter((r): r is ErrorReportSummaryRow & { kurulum: SupportInstallation } => r.kurulum !== null);
  return (
    <>
      <PageTitle title="Hata raporları" sub="Fabrikanın onay verdiği kurulumlardan gelen hata özetleri: hata kodu, sınıfı, sürüm, yer ve sayı. Mesaj metni ve kişisel veri gelmez." />
      <QueryState isLoading={q.isLoading} error={q.error} />
      <Section title="Kurulumlar">
        <Table
          rows={rows}
          rowKey={(r) => r.kurulum.id}
          empty="Hata raporu yok"
          columns={[
            { header: "Kurulum", render: (r) => <Link to={`/hata-raporlari/${r.kurulum.id}`}>{installationPath(r.kurulum)}</Link> },
            { header: "Hata grubu", render: (r) => r.grupSayisi },
            { header: "Toplam hata", render: (r) => r.toplam },
            { header: "Son görülme", render: (r) => fmtDateTime(r.sonGorulme) },
          ]}
        />
      </Section>
    </>
  );
}

export function ErrorReportGroupsPage() {
  const { id = "" } = useParams();
  const [source, setSource] = useState("");
  const q = useGet<{ items: ErrorReportGroupRow[] }>(["hata-raporlari", id], `/hata-raporlari/${id}`, { kaynak: source || undefined, limit: 200 });
  const rows = q.data?.items ?? [];
  return (
    <>
      <PageTitle title="Hata grupları" sub={<Link to={`/kurulumlar/${id}`}>Kurulum ayrıntısı</Link>} />
      <Section title="Gruplar (son görülme sırasıyla)">
        <div className="toolbar">
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Kaynak">
            <option value="">Tümü</option>
            {Object.entries(ERROR_SOURCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <QueryState isLoading={q.isLoading} error={q.error} />
        <Table
          rows={rows}
          rowKey={(r) => r.id}
          empty="Bu kurulumdan hata grubu yok"
          columns={[
            { header: "Kaynak", render: (r) => <Badge tone="info">{ERROR_SOURCE_LABEL[r.kaynak] ?? r.kaynak}</Badge> },
            { header: "Sürüm", render: (r) => r.surum },
            { header: "Kod", render: (r) => r.kod },
            { header: "Sınıf", render: (r) => r.sinif },
            { header: "Bileşen", render: (r) => r.bilesen },
            { header: "Yer", render: (r) => r.yol ?? "—" },
            { header: "Yığın", render: (r) => (r.yigin.length > 0 ? <code>{r.yigin.join(" ← ")}</code> : "—") },
            { header: "Sayı", render: (r) => r.sayi },
            { header: "İlk", render: (r) => fmtDateTime(r.ilk) },
            { header: "Son", render: (r) => fmtDateTime(r.son) },
          ]}
        />
      </Section>
    </>
  );
}
