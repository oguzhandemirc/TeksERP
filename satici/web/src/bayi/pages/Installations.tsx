// BAYİ KURULUMLARI — kurulum fabrikanın installationId'siyle, tavandaki sınıf (ve kanal) içinde açılır;
// lisans bayi parolasıyla, tavan içinde imzalanır; etkinleştirme kodu yalnız bir kez gösterilir.
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { EntitlementPanel } from "../../shared/EntitlementPanel";
import { fmtDateTime } from "../../shared/format";
import { InstallationFormModal } from "../../shared/forms";
import { useGet, usePaged } from "../../shared/hooks";
import { CLASS_LABEL, INSTALLATION_STATUS_LABEL, PRODUCTION_MODULE_KEY, label } from "../../shared/labels";
import { installationName, type Installation, type InstallationDetail } from "../../shared/types";
import { Badge, Button, KeyValues, LoadMore, PageTitle, QueryState, Section, Table } from "../../shared/ui";
import { useDealerSelf } from "./Home";

export function BayiInstallationsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const self = useDealerSelf();
  const siteId = params.get("tesisId") ?? undefined;
  const [search, setSearch] = useState("");
  const list = usePaged<Installation>(["kurulumlar"], "/kurulumlar", { tesisId: siteId, arama: search.trim() || undefined });
  const creating = params.get("yeni") === "1" && siteId !== undefined;
  const tavan = self.data?.tavan ?? null;
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };
  return (
    <>
      <PageTitle
        title="Kurulumlarım"
        sub={siteId ? <Link to="/kurulumlar">tüm kurulumlar</Link> : "Fabrika sunucuları (installationId ile)"}
        actions={siteId ? <Button variant="primary" onClick={() => setParam("yeni", "1")}>Yeni kurulum</Button> : null}
      />
      <Section title="Liste">
        <div className="toolbar">
          <input placeholder="Kurulum, tesis, müşteri ya da lisans no" aria-label="Ara" value={search} onChange={(e) => setSearch(e.target.value)} />
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
            { header: "Durum", render: (r) => <Badge>{label(INSTALLATION_STATUS_LABEL, r.durum)}</Badge> },
            { header: "Son yoklama", render: (r) => fmtDateTime(r.sonYoklamaZamani) },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
      {creating && tavan ? (
        <InstallationFormModal
          siteId={siteId}
          classes={tavan.siniflar}
          allowPollInterval={false}
          channelOptions={tavan.kanallar}
          noChannelText="Tavanınızda kanal yok: kurulum açmak için satıcıdan kanal ataması isteyin."
          onClose={() => setParam("yeni", null)}
          onSaved={(i) => {
            void queryClient.invalidateQueries({ queryKey: ["kurulumlar"] });
            void queryClient.invalidateQueries({ queryKey: ["ben"] });
            navigate(`/kurulumlar/${i.id}`);
          }}
        />
      ) : null}
      {creating && self.data && !tavan ? <p className="error">Tavanınız tanımlı değil: kurulum açamazsınız.</p> : null}
    </>
  );
}

export function BayiInstallationDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const self = useDealerSelf();
  const q = useGet<InstallationDetail>(["kurulum", id], `/kurulumlar/${id}`);
  const d = q.data;
  if (!d) return <QueryState isLoading={q.isLoading} error={q.error} />;
  const inst = d.kurulum;
  const tavan = self.data?.tavan ?? null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["kurulum", id] });
    void queryClient.invalidateQueries({ queryKey: ["kurulumlar"] });
  };
  return (
    <>
      <PageTitle
        title={installationName(inst)}
        sub={
          <>
            <Link to={`/musteriler/${inst.tesis.musteri.id}`}>{inst.tesis.musteri.ad}</Link> › <Link to={`/kurulumlar?tesisId=${inst.tesis.id}`}>{inst.tesis.ad}</Link>
          </>
        }
      />
      <Section title="Özet">
        <KeyValues
          items={[
            ["Kurulum kimliği (installationId)", <code key="k">{inst.kurulumId}</code>],
            ["Durum", label(INSTALLATION_STATUS_LABEL, inst.durum)],
            ["Sınıf", label(CLASS_LABEL, inst.sinif)],
            ["Kanal", inst.kanalKodu],
            ["Etkinleşme", fmtDateTime(inst.etkinlesmeZamani)],
            ["Son yoklama", fmtDateTime(inst.sonYoklamaZamani)],
          ]}
        />
      </Section>
      {self.data && !self.data.anahtarBagli ? <p className="warn-box">İmza anahtarınız bağlı değil: lisans imzalanamaz.</p> : null}
      <EntitlementPanel
        detail={d}
        policy={{
          canWrite: true,
          canCode: true,
          modules: tavan?.moduller,
          defaultModules: tavan?.moduller.includes(PRODUCTION_MODULE_KEY) ? [PRODUCTION_MODULE_KEY] : [],
          passwordField: "bayiParolasi",
          passwordLabel: "Bayi anahtar parolası",
          allowPerpetual: tavan?.kaliciIzni ?? true,
          maxMaintenanceMonths: tavan?.bakimAyTavani,
        }}
        onChanged={refresh}
      />
    </>
  );
}
