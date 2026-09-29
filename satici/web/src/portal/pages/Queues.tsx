// Küresel kuyruklar: planlı eylemler · taşıma talepleri · kopya uyarıları · DR (devredilmiş kurulumlar).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtDateTime } from "../../shared/format";
import { usePaged } from "../../shared/hooks";
import { COPY_ALERT_LABEL, PLANNED_STATUS_LABEL, TRANSFER_STATUS_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import { installationName, type CopyAlert, type Installation, type PlannedAction, type TransferRequest } from "../../shared/types";
import { Badge, Button, LoadMore, PageTitle, QueryState, Section, Table } from "../../shared/ui";
import { CopyAlertCloseDialog, TransferDecisionDialog } from "../installation/IncidentPanels";
import { plannedSummary } from "../installation/PlanPanels";

function StatusFilter({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Record<string, string> }) {
  return (
    <div className="toolbar">
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Durum">
        <option value="">Tümü</option>
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PlannedActionsPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const canWrite = useCan("yaptirim:yaz");
  const [status, setStatus] = useState("BEKLIYOR");
  const [cancel, setCancel] = useState<PlannedAction | null>(null);
  const list = usePaged<PlannedAction>(["planli-eylemler"], "/planli-eylemler", { durum: status || undefined });
  return (
    <>
      <PageTitle title="Planlı eylemler" sub="Vadesi gelince kendiliğinden uygulanır." />
      <Section title="Liste">
        <StatusFilter value={status} onChange={setStatus} options={PLANNED_STATUS_LABEL} />
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          columns={[
            { header: "Vade", render: (r) => fmtDateTime(r.vade) },
            { header: "Kurulum", render: (r) => <Link to={`/kurulumlar/${r.kurulumId}`}>{r.kurulumId.slice(0, 8)}</Link> },
            { header: "Eylem", render: (r) => plannedSummary(r) },
            { header: "Durum", render: (r) => label(PLANNED_STATUS_LABEL, r.durum) },
            { header: "Sebep", render: (r) => r.sebep },
            { header: "", render: (r) => (canWrite && r.durum === "BEKLIYOR" ? <Button variant="ghost" onClick={() => setCancel(r)}>İptal et</Button> : null) },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
      {cancel ? (
        <ConfirmAction
          title="Planlı eylemi iptal et"
          description="Vadesinde uygulanmaz; iptal satırda kalır."
          targets={[`Kurulum ${cancel.kurulumId.slice(0, 8)} — ${plannedSummary(cancel)} — vade ${fmtDateTime(cancel.vade)}`]}
          confirmLabel="İptal et"
          danger
          send={(b) => api.post(`/planli-eylemler/${cancel.id}/iptal`, b)}
          onDone={() => {
            setCancel(null);
            void queryClient.invalidateQueries({ queryKey: ["planli-eylemler"] });
          }}
          onClose={() => setCancel(null)}
        />
      ) : null}
    </>
  );
}

export function TransfersPage() {
  const queryClient = useQueryClient();
  const canManage = useCan("kurulum:yonet");
  const [status, setStatus] = useState("BEKLIYOR");
  const [decide, setDecide] = useState<{ t: TransferRequest; d: "onayla" | "reddet" } | null>(null);
  const list = usePaged<TransferRequest>(["tasima-talepleri"], "/tasima-talepleri", { durum: status || undefined });
  return (
    <>
      <PageTitle title="Taşıma talepleri" sub="Her taşıma satıcı onayıyla: onayda eski makinenin kirası iptal olur." />
      <Section title="Liste">
        <StatusFilter value={status} onChange={setStatus} options={TRANSFER_STATUS_LABEL} />
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          columns={[
            { header: "Tarih", render: (r) => fmtDateTime(r.createdAt) },
            {
              header: "Kurulum",
              render: (r) => (r.kurulum ? <Link to={`/kurulumlar/${r.kurulumId}`}>{`${r.kurulum.tesis.musteri.ad} › ${r.kurulum.tesis.ad} › ${r.kurulum.ad ?? r.kurulum.kurulumId.slice(0, 8)}`}</Link> : "—"),
            },
            { header: "Yeni anahtar", render: (r) => <code>{r.yeniAnahtarKimligi}</code> },
            { header: "Gerekçe", render: (r) => r.gerekce ?? "—" },
            { header: "Durum", render: (r) => label(TRANSFER_STATUS_LABEL, r.durum) },
            {
              header: "",
              render: (r) =>
                canManage && r.durum === "BEKLIYOR" ? (
                  <span className="section-actions">
                    <Button variant="ghost" onClick={() => setDecide({ t: r, d: "onayla" })}>
                      Onayla
                    </Button>
                    <Button variant="ghost" onClick={() => setDecide({ t: r, d: "reddet" })}>
                      Reddet
                    </Button>
                  </span>
                ) : null,
            },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
      {decide ? (
        <TransferDecisionDialog
          transfer={decide.t}
          decision={decide.d}
          onClose={() => setDecide(null)}
          onDone={() => {
            setDecide(null);
            void queryClient.invalidateQueries({ queryKey: ["tasima-talepleri"] });
            void queryClient.invalidateQueries({ queryKey: ["pano"] });
          }}
        />
      ) : null}
    </>
  );
}

export function CopyAlertsPage() {
  const queryClient = useQueryClient();
  const canManage = useCan("kurulum:yonet");
  const [status, setStatus] = useState("ACIK");
  const [closing, setClosing] = useState<CopyAlert | null>(null);
  const list = usePaged<CopyAlert>(["kopya-uyarilari"], "/kopya-uyarilari", { durum: status || undefined });
  return (
    <>
      <PageTitle title="Kopya uyarıları" sub="İlk pencerede yalnız uyarı; ikinci pencerede sürerse eşleşmeyen tarafa kira verilmez." />
      <Section title="Liste">
        <StatusFilter value={status} onChange={setStatus} options={{ ACIK: "Açık", KAPANDI: "Kapandı" }} />
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          columns={[
            { header: "Son görülme", render: (r) => fmtDateTime(r.sonGorulme) },
            {
              header: "Kurulum",
              render: (r) => (r.kurulum ? <Link to={`/kurulumlar/${r.kurulumId}`}>{`${r.kurulum.tesis.musteri.ad} › ${r.kurulum.tesis.ad} › ${r.kurulum.ad ?? r.kurulum.kurulumId.slice(0, 8)}`}</Link> : "—"),
            },
            { header: "Tür", render: (r) => label(COPY_ALERT_LABEL, r.tur) },
            { header: "Sayı", render: (r) => r.gorulmeSayisi, className: "num-col" },
            { header: "Kira reddi", render: (r) => fmtDateTime(r.redZamani) },
            { header: "Durum", render: (r) => (r.durum === "ACIK" ? <Badge tone="danger">Açık</Badge> : <Badge>Kapandı</Badge>) },
            { header: "", render: (r) => (canManage && r.durum === "ACIK" ? <Button variant="ghost" onClick={() => setClosing(r)}>Kapat</Button> : null) },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
      {closing ? (
        <CopyAlertCloseDialog
          alert={closing}
          onClose={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            void queryClient.invalidateQueries({ queryKey: ["kopya-uyarilari"] });
            void queryClient.invalidateQueries({ queryKey: ["pano"] });
          }}
        />
      ) : null}
    </>
  );
}

/** DR: devralımı fabrika kendisi başlatır (self-servis); portal devredilmiş ana sunucuları gösterir, geri alma künyeden. */
export function DrPage() {
  const list = usePaged<Installation>(["kurulumlar"], "/kurulumlar", { durum: "DEVREDILDI" });
  const dr = usePaged<Installation>(["kurulumlar"], "/kurulumlar", { arama: undefined, durum: "ETKIN" });
  const drClass = dr.rows.filter((r) => r.sinif === "DR");
  return (
    <>
      <PageTitle title="DR (felaket kurtarma)" sub="DR sunucusu üretimi devraldığında ana sunucu DEVREDİLDİ olur ve kısıtlı kipe geçer (iki üretim olmaz)." />
      <Section title="Devredilmiş ana sunucular">
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          empty="Devredilmiş kurulum yok"
          columns={[
            { header: "Kurulum", render: (r) => <Link to={`/kurulumlar/${r.id}`}>{installationName(r)}</Link> },
            { header: "Müşteri › Tesis", render: (r) => `${r.tesis.musteri.ad} › ${r.tesis.ad}` },
            { header: "Son yoklama", render: (r) => fmtDateTime(r.sonYoklamaZamani) },
          ]}
        />
        <p className="muted small">Geri almak için kurulum künyesindeki “DR devrini geri al” düğmesini kullanın.</p>
      </Section>
      <Section title="Etkin DR sınıfı kurulumlar">
        <Table
          rows={drClass}
          rowKey={(r) => r.id}
          empty="Etkin DR kurulumu yok"
          columns={[
            { header: "Kurulum", render: (r) => <Link to={`/kurulumlar/${r.id}`}>{installationName(r)}</Link> },
            { header: "Müşteri › Tesis", render: (r) => `${r.tesis.musteri.ad} › ${r.tesis.ad}` },
            { header: "Son yoklama", render: (r) => fmtDateTime(r.sonYoklamaZamani) },
          ]}
        />
        <LoadMore hasMore={dr.hasMore} loading={dr.loadingMore} onClick={dr.loadMore} />
      </Section>
    </>
  );
}
