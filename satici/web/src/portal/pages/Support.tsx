// DESTEK KUTUSU — fabrikaların panelden açtığı talepler (kurulum imzalı `/v1/destek`). Durum süzmesi
// sunucuda; yanıt ve kapanış ayrıntı sayfasında (defter satırı yazar, kuruluma zil çalar).
import { useState } from "react";
import { Link } from "react-router-dom";
import { fmtDateTime } from "../../shared/format";
import { usePaged } from "../../shared/hooks";
import { Badge, LoadMore, PageTitle, QueryState, Section, Table } from "../../shared/ui";

export const SUPPORT_STATUS_LABEL: Record<string, string> = { ACIK: "Açık", YANITLANDI: "Yanıtlandı", KAPANDI: "Kapandı" };

export function supportStatusBadge(durum: string) {
  const tone = durum === "ACIK" ? "danger" : durum === "YANITLANDI" ? "info" : "neutral";
  return <Badge tone={tone}>{SUPPORT_STATUS_LABEL[durum] ?? durum}</Badge>;
}

export interface SupportInstallation {
  readonly id: string;
  readonly kurulumId: string;
  readonly ad: string | null;
  readonly tesis: { readonly ad: string; readonly musteri: { readonly id: string; readonly ad: string } };
}

export interface SupportTicketRow {
  readonly id: string;
  readonly talepNo: string;
  readonly konu: string;
  readonly acan: string | null;
  readonly durum: string;
  readonly ekTuru: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly kurulum: SupportInstallation;
}

export function installationPath(k: SupportInstallation): string {
  return `${k.tesis.musteri.ad} › ${k.tesis.ad} › ${k.ad ?? k.kurulumId.slice(0, 8)}`;
}

export function SupportPage() {
  const [status, setStatus] = useState("ACIK");
  const list = usePaged<SupportTicketRow>(["destek"], "/destek", { durum: status || undefined });
  return (
    <>
      <PageTitle title="Destek kutusu" sub="Fabrikanın panelinden açılan talepler; yanıtınız fabrikaya kapı zili + yoklamayla döner." />
      <Section title="Talepler">
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Durum">
            <option value="">Tümü</option>
            {Object.entries(SUPPORT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          empty="Talep yok"
          columns={[
            { header: "No", render: (r) => <Link to={`/destek/${r.id}`}>{r.talepNo}</Link> },
            { header: "Konu", render: (r) => r.konu },
            { header: "Kurulum", render: (r) => <Link to={`/kurulumlar/${r.kurulum.id}`}>{installationPath(r.kurulum)}</Link> },
            { header: "Açan", render: (r) => r.acan ?? "—" },
            { header: "Ek", render: (r) => (r.ekTuru ? "Ekran görüntüsü" : "—") },
            { header: "Açılış", render: (r) => fmtDateTime(r.createdAt) },
            { header: "Son hareket", render: (r) => fmtDateTime(r.updatedAt) },
            { header: "Durum", render: (r) => supportStatusBadge(r.durum) },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
    </>
  );
}
