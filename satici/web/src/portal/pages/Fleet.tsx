// FİLO (Dağıtım v2): kurulum × kurulu backend sürümü × kanalın yayındaki sürümü × politika × güncelleyici ×
// son deneme. Salt okuma; "geride" yalnız iki sürüm de okunabildiğinde hesaplanır (sunucu `fleetView`),
// okunamayan "bilinmiyor"dur. Özet şeridi aynı satırlardan sayılır.
import { Link } from "react-router-dom";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { label } from "../../shared/labels";
import { installationName, type FleetRow } from "../../shared/types";
import { Badge, PageTitle, QueryState, Section, Table } from "../../shared/ui";
import { UPDATE_DECISION_LABEL, UPDATE_EVENT_LABEL, UPDATER_STATE_LABEL, policyText } from "../update/labels";

function freshness(r: FleetRow) {
  if (r.geride === null) return <Badge>Bilinmiyor</Badge>;
  return r.geride ? <Badge tone="warn">Geride</Badge> : <Badge tone="ok">Güncel</Badge>;
}

function resultTone(olay: string): "ok" | "warn" | "danger" {
  if (olay === "GUNCELLEME_BASARILI") return "ok";
  return olay === "GUNCELLEME_GERI_DONDU" ? "warn" : "danger";
}

export function FleetPage() {
  const q = useGet<FleetRow[]>(["filo"], "/filo");
  const rows = q.data ?? [];
  const behind = rows.filter((r) => r.geride === true).length;
  const current = rows.filter((r) => r.geride === false).length;
  return (
    <>
      <PageTitle title="Filo" sub="Kurulumların backend sürümü, kanalın yayındaki sürümü ve güncelleme politikası." />
      <QueryState isLoading={q.isLoading} error={q.error} />
      {q.data ? (
        <Section title={`${rows.length} kurulum · ${current} güncel · ${behind} geride · ${rows.length - current - behind} bilinmiyor`}>
          <Table
            rows={rows}
            rowKey={(r) => r.id}
            empty="Etkin kurulum yok"
            columns={[
              {
                header: "Kurulum",
                render: (r) => (
                  <Link to={`/kurulumlar/${r.id}`}>
                    {r.musteri} › {r.tesis} › {installationName(r)}
                  </Link>
                ),
              },
              { header: "Kanal", render: (r) => r.kanal },
              { header: "Kurulu", render: (r) => r.kuruluSurum ?? "—" },
              {
                header: "Kanalda",
                render: (r) => (r.kanalSurumu.surum ? `${r.kanalSurumu.surum}${r.kanalSurumu.kaynak === "KANAL_KAYDI" ? " (kanal kaydı)" : ""}` : "—"),
              },
              { header: "Durum", render: freshness },
              { header: "Politika", render: (r) => policyText(r.politika) },
              { header: "Güncelleyici", render: (r) => (r.rapor?.guncelleyici ? label(UPDATER_STATE_LABEL, r.rapor.guncelleyici.durum) : "Rapor yok") },
              { header: "Bekleyen", render: (r) => (r.rapor?.bekleyen ? `${r.rapor.bekleyen.surum} · ${label(UPDATE_DECISION_LABEL, r.rapor.bekleyen.karar)}` : "—") },
              {
                header: "Son deneme",
                render: (r) =>
                  r.sonSonuc ? (
                    <>
                      <Badge tone={resultTone(r.sonSonuc.olay)}>{label(UPDATE_EVENT_LABEL, r.sonSonuc.olay)}</Badge> {fmtDateTime(r.sonSonuc.createdAt)}
                    </>
                  ) : (
                    "—"
                  ),
              },
              { header: "Son yoklama", render: (r) => fmtDateTime(r.sonYoklama) },
            ]}
          />
        </Section>
      ) : null}
    </>
  );
}
