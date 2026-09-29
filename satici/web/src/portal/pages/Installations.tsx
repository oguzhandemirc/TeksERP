import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { fmtDateTime } from "../../shared/format";
import { InstallationFormModal } from "../../shared/forms";
import { useChannels, useGet, usePaged } from "../../shared/hooks";
import { CLASS_LABEL, INSTALLATION_STATUS_LABEL, label } from "../../shared/labels";
import { useCan } from "../../shared/session";
import { installationName, type Catalog, type Installation } from "../../shared/types";
import { Badge, Button, LoadMore, PageTitle, QueryState, Section, Table } from "../../shared/ui";

export function statusTone(s: string): "ok" | "warn" | "danger" | "neutral" | "info" {
  return s === "ETKIN" ? "ok" : s === "ETKINLESMEDI" ? "info" : s === "DEVREDILDI" ? "warn" : s === "IPTAL" ? "danger" : "neutral";
}

export function InstallationsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = useCan("musteri:yaz");
  const siteId = params.get("tesisId") ?? undefined;
  const status = params.get("durum") ?? "";
  const [search, setSearch] = useState("");
  const list = usePaged<Installation>(["kurulumlar"], "/kurulumlar", { tesisId: siteId, durum: status || undefined, arama: search.trim() || undefined });
  const catalog = useGet<Catalog>(["katalog"], "/katalog");
  const channels = useChannels();
  const creating = params.get("yeni") === "1" && siteId !== undefined;
  const siteName = list.rows[0]?.tesis ? `${list.rows[0].tesis.musteri.ad} › ${list.rows[0].tesis.ad}` : null;
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };
  return (
    <>
      <PageTitle
        title="Kurulumlar"
        sub={siteId ? <>Tesis: {siteName ?? "—"} · <Link to="/kurulumlar">tüm kurulumlar</Link></> : "Fabrika sunucuları (installationId ile)"}
        actions={canWrite && siteId ? <Button variant="primary" onClick={() => setParam("yeni", "1")}>Yeni kurulum</Button> : null}
      />
      <Section title="Liste">
        <div className="toolbar">
          <input placeholder="Kurulum, tesis, müşteri ya da lisans no" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Ara" />
          <select value={status} onChange={(e) => setParam("durum", e.target.value || null)} aria-label="Durum">
            <option value="">Tüm durumlar</option>
            {Object.entries(INSTALLATION_STATUS_LABEL).map(([k, v]) => (
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
          columns={[
            { header: "Kurulum", render: (r) => <Link to={`/kurulumlar/${r.id}`}>{installationName(r)}</Link> },
            { header: "Müşteri › Tesis", render: (r) => `${r.tesis.musteri.ad} › ${r.tesis.ad}` },
            { header: "Lisans no", render: (r) => r.haklar[0]?.lisansNo ?? "—" },
            { header: "Sınıf", render: (r) => label(CLASS_LABEL, r.sinif) },
            { header: "Durum", render: (r) => <Badge tone={statusTone(r.durum)}>{label(INSTALLATION_STATUS_LABEL, r.durum)}</Badge> },
            { header: "Kip", render: (r) => (r.zorlama ? <Badge tone="warn">Zorla</Badge> : <Badge>Gözlem</Badge>) },
            { header: "Son yoklama", render: (r) => fmtDateTime(r.sonYoklamaZamani) },
            {
              header: "Uyarı",
              render: (r) => (
                <>
                  {r._count.kopyaUyarilari > 0 ? <Badge tone="danger">{r._count.kopyaUyarilari} kopya</Badge> : null}{" "}
                  {r._count.tasimalar > 0 ? <Badge tone="warn">{r._count.tasimalar} taşıma</Badge> : null}
                </>
              ),
            },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
      {creating && catalog.data ? (
        <InstallationFormModal
          siteId={siteId}
          classes={catalog.data.siniflar}
          allowPollInterval
          channelOptions={channels.channels.map((c) => c.kod)}
          noChannelText="Kayıtlı kanal yok: önce Kanallar ekranında kanal açın (yönetici)."
          onClose={() => setParam("yeni", null)}
          onSaved={(i) => {
            void queryClient.invalidateQueries({ queryKey: ["kurulumlar"] });
            navigate(`/kurulumlar/${i.id}`);
          }}
        />
      ) : null}
    </>
  );
}
