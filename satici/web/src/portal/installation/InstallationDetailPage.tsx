// KURULUM KÜNYESİ — hak · kira · parmak izi · yoklama/sağlık · yaptırım · plan/taksit · olaylar ·
// eylem defteri. Kurulum düzeyindeki yıkıcı eylemler (pasif · iptal · DR geri al) kaydı adıyla onaylatır.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { EntitlementPanel } from "../../shared/EntitlementPanel";
import { fmtDateTime } from "../../shared/format";
import { InstallationFormModal } from "../../shared/forms";
import { useChannels, useGet } from "../../shared/hooks";
import { CLASS_LABEL, INSTALLATION_STATUS_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import { installationName, type Catalog, type InstallationDetail } from "../../shared/types";
import { Badge, Button, KeyValues, PageTitle, QueryState, Section } from "../../shared/ui";
import { statusTone } from "../pages/Installations";
import { FirstInstallPanel } from "../distribution/FirstInstallPanel";
import { HealthPanel, IncidentsPanel, RecordsPanel } from "./IncidentPanels";
import { InstallHistoryPanel } from "./InstallHistoryPanel";
import { InstallmentPanel, PlannedPanel } from "./PlanPanels";
import { SanctionPanel } from "./SanctionPanel";

const TABS = [
  ["lisans", "Lisans"],
  ["yaptirim", "Yaptırım"],
  ["plan", "Plan ve taksit"],
  ["saglik", "Sağlık ve kira"],
  ["olaylar", "Kopya ve taşıma"],
  ["kayit", "Eylem defteri"],
  ["ilk-kurulum", "İlk kurulum"],
] as const;
type Tab = (typeof TABS)[number][0];

type Dialog = { kind: "edit" } | { kind: "active"; active: boolean } | { kind: "cancel" } | { kind: "reinstate" } | { kind: "drRevert" } | null;

export function InstallationDetailPage() {
  const { id = "" } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const canWrite = useCan("musteri:yaz");
  const canCancel = useCan("kurulum:iptal");
  const canManage = useCan("kurulum:yonet");
  const canEntitle = useCan("hak:yaz");
  const canCode = useCan("kod:uret");
  const q = useGet<InstallationDetail>(["kurulum", id], `/kurulumlar/${id}`);
  const catalog = useGet<Catalog>(["katalog"], "/katalog");
  const channels = useChannels();
  const [tab, setTab] = useState<Tab>("lisans");
  const [dialog, setDialog] = useState<Dialog>(null);
  const refresh = () => {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ["kurulum", id] });
    void queryClient.invalidateQueries({ queryKey: ["kurulumlar"] });
    void queryClient.invalidateQueries({ queryKey: ["pano"] });
  };
  const d = q.data;
  if (!d) return <QueryState isLoading={q.isLoading} error={q.error} />;
  const inst = d.kurulum;
  const name = installationName(inst);
  const target = `${inst.tesis.musteri.ad} › ${inst.tesis.ad} › ${name}${d.hak ? ` (${d.hak.lisansNo})` : ""}`;
  const modules = catalog.data?.moduller ?? [];
  return (
    <>
      <PageTitle
        title={name}
        sub={
          <>
            <Link to={`/musteriler/${inst.tesis.musteri.id}`}>{inst.tesis.musteri.ad}</Link> › <Link to={`/kurulumlar?tesisId=${inst.tesis.id}`}>{inst.tesis.ad}</Link>
          </>
        }
        actions={
          <>
            {canWrite && inst.durum !== "IPTAL" ? <Button onClick={() => setDialog({ kind: "edit" })}>Düzenle</Button> : null}
            {canWrite && inst.durum !== "IPTAL" ? <Button onClick={() => setDialog({ kind: "active", active: !inst.aktif })}>{inst.aktif ? "Pasife al" : "Aktif et"}</Button> : null}
            {canManage && inst.durum === "DEVREDILDI" ? <Button onClick={() => setDialog({ kind: "drRevert" })}>DR devrini geri al</Button> : null}
            {canCancel && inst.durum !== "IPTAL" ? (
              <Button variant="danger" onClick={() => setDialog({ kind: "cancel" })}>
                Kurulumu iptal et
              </Button>
            ) : null}
            {canCancel && inst.durum === "IPTAL" ? <Button onClick={() => setDialog({ kind: "reinstate" })}>İptali geri al</Button> : null}
          </>
        }
      />
      <Section title="Özet">
        <KeyValues
          items={[
            ["Lisans kimliği (kurulumId)", <code key="k">{inst.kurulumId}</code>],
            ["Durum", <Badge key="d" tone={statusTone(inst.durum)}>{label(INSTALLATION_STATUS_LABEL, inst.durum)}</Badge>],
            ["Sınıf", label(CLASS_LABEL, inst.sinif)],
            ["Kanal", inst.kanalKodu],
            ["Kip", inst.zorlama ? "Zorla" : "Gözlem"],
            ["Kayıt", inst.aktif ? "Aktif" : "Pasif"],
            ["Etkinleşme", fmtDateTime(inst.etkinlesmeZamani)],
            ["Son yoklama", fmtDateTime(inst.sonYoklamaZamani)],
            ["Yoklama aralığı", `${inst.yoklamaAraligiDk} dk`],
            ["Bulut eşitleme aralığı", `${inst.esitlemeAraligiDk} dk`],
            ["Buluttaki geçmiş", inst.bulutSaklamaAy === null ? "Tüm geçmiş" : `${inst.bulutSaklamaAy} ay`],
            ["Kurulum anahtarı", inst.anahtarKimligi ? <code key="a">{inst.anahtarKimligi}</code> : "—"],
          ]}
        />
      </Section>
      <div className="tabs" role="tablist">
        {TABS.map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>
            {v}
            {k === "olaylar" && inst._count.kopyaUyarilari + inst._count.tasimalar > 0 ? ` (${inst._count.kopyaUyarilari + inst._count.tasimalar})` : ""}
          </button>
        ))}
      </div>
      {tab === "lisans" ? (
        <EntitlementPanel
          detail={d}
          policy={{
            canWrite: canEntitle,
            canCode,
            modules: catalog.data?.moduller,
            defaultModules: catalog.data?.varsayilanModuller ?? [],
            passwordField: "kokParolasi",
            passwordLabel: "Kök anahtar parolası",
            allowPerpetual: true,
          }}
          onChanged={refresh}
        />
      ) : null}
      {tab === "yaptirim" ? <SanctionPanel detail={d} modules={modules} onChanged={refresh} /> : null}
      {tab === "plan" ? (
        <>
          <PlannedPanel detail={d} modules={modules} onChanged={refresh} />
          <InstallmentPanel detail={d} onChanged={refresh} />
        </>
      ) : null}
      {tab === "saglik" ? <HealthPanel detail={d} /> : null}
      {tab === "olaylar" ? <IncidentsPanel detail={d} onChanged={refresh} /> : null}
      {tab === "kayit" ? (
        <>
          <InstallHistoryPanel detail={d} />
          <RecordsPanel detail={d} />
        </>
      ) : null}
      {tab === "ilk-kurulum" ? <FirstInstallPanel installation={inst} /> : null}

      {dialog?.kind === "edit" && catalog.data ? (
        <InstallationFormModal
          siteId={inst.tesisId}
          classes={catalog.data.siniflar}
          installation={inst}
          allowPollInterval
          channelOptions={channels.channels.map((c) => c.kod)}
          noChannelText="Kayıtlı kanal yok: önce Kanallar ekranında kanal açın (yönetici)."
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      ) : null}
      {dialog?.kind === "active" ? (
        <ConfirmAction
          title={dialog.active ? "Kurulumu aktif et" : "Kurulumu pasife al"}
          description={dialog.active ? "Kurulum kaydı yeniden aktif olur." : "Kurulum kaydı pasife alınır (arşiv); canlı kira ve yaptırımlar ayrıca yönetilir."}
          targets={[target]}
          confirmLabel={dialog.active ? "Aktif et" : "Pasife al"}
          danger={!dialog.active}
          send={(b) => api.post(`/kurulumlar/${inst.id}/${dialog.active ? "aktif" : "pasif"}`, b)}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "cancel" ? (
        <ConfirmAction
          title="Kurulumu iptal et"
          description="İptal edilen kuruluma kira verilmez (fabrika ek süreye düşer). İptal geri alınabilir; kayıt defterde kalır."
          targets={[target]}
          confirmLabel="İptal et"
          danger
          typedConfirmation={d.hak ? { expected: d.hak.lisansNo, label: "Lisans numarası (ikinci onay)" } : undefined}
          send={(b) => api.post(`/kurulumlar/${inst.id}/iptal`, { clientToken: b.clientToken, sebep: b.sebep })}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "reinstate" ? (
        <ConfirmAction
          title="Kurulum iptalini geri al"
          description="Kurulum yeniden kira alabilir hâle gelir."
          targets={[target]}
          confirmLabel="İptali geri al"
          send={(b) => api.post(`/kurulumlar/${inst.id}/iptal-geri-al`, b)}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "drRevert" ? (
        <ConfirmAction
          title="DR devrini geri al"
          description="Üretim bu ana sunucuya geri döner; DR sunucusu yeniden yedek konumuna geçer. İki sunucunun aynı anda üretim yapmadığından emin olun."
          targets={[target]}
          confirmLabel="DR devrini geri al"
          danger
          send={(b) => api.post(`/kurulumlar/${inst.id}/dr-geri-al`, b)}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
