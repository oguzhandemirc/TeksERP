// FİLO (Dağıtım v2): kurulum × kurulu backend sürümü × kanalın yayındaki sürümü × paket zinciri yeteneği × politika ×
// güncelleyici × son deneme. Grup süzgeci liste ve özet şeridini AYNI satırlardan süzer. Salt okuma; "geride" yalnız iki sürüm de okunabildiğinde hesaplanır (sunucu `fleetView`),
// okunamayan "bilinmiyor"dur. Özet şeridi aynı satırlardan sayılır.
import { useState } from "react";
import { Link } from "react-router-dom";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { label } from "../../shared/labels";
import { installationName, type FleetRow } from "../../shared/types";
import { Badge, PageTitle, QueryState, Section, Table } from "../../shared/ui";
import { UPDATE_GROUP_LABEL, groupName } from "../../shared/update-groups";
import { UPDATE_DECISION_LABEL, UPDATE_EVENT_LABEL, UPDATER_STATE_LABEL, policyText } from "../update/labels";

function freshness(r: FleetRow) {
  if (r.geride === null) return <Badge>Bilinmiyor</Badge>;
  return r.geride ? <Badge tone="warn">Geride</Badge> : <Badge tone="ok">Güncel</Badge>;
}

/** Güncelleyicinin `paket-zinciri` yeteneği (kesim ölçüsü); hiç etkinleşmemiş kurulum bilinmiyor. */
function chainBadge(r: FleetRow) {
  if (r.paketZinciri === undefined || r.paketZinciri === null) return <Badge>Bilinmiyor</Badge>;
  return r.paketZinciri ? <Badge tone="ok">Evet</Badge> : <Badge tone="warn">Hayır</Badge>;
}

function resultTone(olay: string): "ok" | "warn" | "danger" {
  if (olay === "GUNCELLEME_BASARILI") return "ok";
  return olay === "GUNCELLEME_GERI_DONDU" ? "warn" : "danger";
}

export function FleetPage() {
  const q = useGet<FleetRow[]>(["filo"], "/filo");
  const [group, setGroup] = useState("");
  const all = q.data ?? [];
  // Önce gruplar terfi sırasıyla, sonra filoda görülen emekli kanallar.
  const groupChoices = [...Object.keys(UPDATE_GROUP_LABEL), ...[...new Set(all.map((r) => r.kanal))].filter((k) => !UPDATE_GROUP_LABEL[k]).sort()];
  const rows = group ? all.filter((r) => r.kanal === group) : all;
  const behind = rows.filter((r) => r.geride === true).length;
  const current = rows.filter((r) => r.geride === false).length;
  const chained = rows.filter((r) => r.paketZinciri === true).length;
  return (
    <>
      <PageTitle title="Filo" sub="Kurulumların backend sürümü, güncelleme grubunun yayındaki sürümü ve güncelleme politikası." />
      <QueryState isLoading={q.isLoading} error={q.error} />
      {q.data ? (
        <Section title={`${rows.length} kurulum · ${current} güncel · ${behind} geride · ${rows.length - current - behind} bilinmiyor`}>
          <div className="toolbar">
            <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Güncelleme grubu">
              <option value="">Tüm gruplar</option>
              {groupChoices.map((g) => (
                <option key={g} value={g}>
                  {groupName(g)}
                </option>
              ))}
            </select>
          </div>
          <p className="muted small" data-testid="paket-zinciri-ozeti">
            {`Paket zinciri: ${chained}/${rows.length} kurulum — eski paket anahtarıyla imzalamayı bırakmak için hepsi "Evet" olmalı.`}
          </p>
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
              { header: "Grup", render: (r) => groupName(r.kanal) },
              { header: "Kurulu", render: (r) => r.kuruluSurum ?? "—" },
              {
                header: "Grupta",
                render: (r) => (r.kanalSurumu.surum ? `${r.kanalSurumu.surum}${r.kanalSurumu.kaynak === "KANAL_KAYDI" ? " (kanal kaydı)" : ""}` : "—"),
              },
              { header: "Durum", render: freshness },
              { header: "Paket zinciri", render: chainBadge },
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
