// BAKIMI BİTECEK MÜŞTERİLER (K9): yenileme satışı için aktif lisansların bakım bitişi, bitişe göre artan. Aşama ve kalan
// gün sunucunun hükmüdür (`GET /bakim-bitecek`); hatırlatma bildirimi 30 gün kala ayrıca gider.
import { Link } from "react-router-dom";
import { fmtDate } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { installationName, type MaintenanceDueRow } from "../../shared/types";
import { Badge, PageTitle, QueryState, Section, Table } from "../../shared/ui";

function stage(r: MaintenanceDueRow) {
  if (r.asama === "BITTI") return <Badge tone="danger">Bitti</Badge>;
  return r.asama === "YAKLASIYOR" ? <Badge tone="warn">Yaklaşıyor</Badge> : <Badge>Sonraki</Badge>;
}

function remaining(r: MaintenanceDueRow): string {
  if (r.kalanGun > 0) return `${r.kalanGun} gün`;
  return r.kalanGun === 0 ? "bugün" : `${-r.kalanGun} gün önce bitti`;
}

export function MaintenanceDuePage() {
  const q = useGet<MaintenanceDueRow[]>(["bakim-bitecek"], "/bakim-bitecek");
  const rows = q.data ?? [];
  const ended = rows.filter((r) => r.asama === "BITTI").length;
  const soon = rows.filter((r) => r.asama === "YAKLASIYOR").length;
  return (
    <>
      <PageTitle title="Bakım bitişleri" sub="Bakım süresi bitmiş ya da 90 gün içinde bitecek lisanslar — yenileme satışı için. Bitişe 30 gün kala bildirim de gider." />
      <QueryState isLoading={q.isLoading} error={q.error} />
      {q.data ? (
        <Section title={`${rows.length} lisans · ${ended} bitti · ${soon} 30 gün içinde bitiyor`}>
          <Table
            rows={rows}
            rowKey={(r) => r.hakId}
            empty="Bakımı bitmiş ya da yakında bitecek lisans yok"
            columns={[
              {
                header: "Kurulum",
                render: (r) => (
                  <Link to={`/kurulumlar/${r.id}`}>
                    {r.musteri} › {r.tesis} › {installationName(r)}
                  </Link>
                ),
              },
              { header: "Lisans no", render: (r) => r.lisansNo },
              { header: "Bakım bitişi", render: (r) => fmtDate(r.bakimBitis) },
              { header: "Kalan", render: remaining },
              { header: "Aşama", render: stage },
              { header: "Kurulu sürüm", render: (r) => r.kuruluSurum ?? "—" },
              {
                header: "Kurulu sürüm bakım dışı",
                render: (r) => (r.surumBakimDisi === null ? "—" : r.surumBakimDisi ? <Badge tone="warn">Evet (ek süre)</Badge> : "Hayır"),
              },
            ]}
          />
        </Section>
      ) : null}
    </>
  );
}
