import { Link } from "react-router-dom";
import { useGet } from "../../shared/hooks";
import { INSTALLATION_STATUS_LABEL, label } from "../../shared/labels";
import type { Dashboard } from "../../shared/types";
import { PageTitle, QueryState, Section } from "../../shared/ui";

function Card({ title, value, to }: { title: string; value: number; to?: string }) {
  const body = (
    <div className="card">
      <div className="muted">{title}</div>
      <div className="num">{value}</div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const q = useGet<Dashboard>(["pano"], "/pano");
  const d = q.data;
  return (
    <>
      <PageTitle title="Pano" sub="Dikkat isteyenler önce." />
      <QueryState isLoading={q.isLoading} error={q.error} />
      {d ? (
        <>
          <Section title="Dikkat">
            <div className="cards">
              <Card title="Açık kopya uyarısı" value={d.acikKopyaUyarisi} to="/kopya-uyarilari" />
              <Card title="Onay bekleyen taşıma" value={d.bekleyenTasima} to="/tasima-talepleri" />
              <Card title="Geciken taksit" value={d.gecikenTaksit} to="/kurulumlar" />
              <Card title="7 gün içinde planlı eylem" value={d.yediGundePlanliEylem} to="/planli-eylemler" />
              <Card title="24 saattir yoklamayan etkin kurulum" value={d.yirmiDortSaattirSessiz} to="/kurulumlar?durum=ETKIN" />
            </div>
          </Section>
          <Section title="Kurulumlar">
            <div className="cards">
              {Object.keys(INSTALLATION_STATUS_LABEL).map((k) => (
                <Card key={k} title={label(INSTALLATION_STATUS_LABEL, k)} value={d.kurulumlar[k] ?? 0} to={`/kurulumlar?durum=${k}`} />
              ))}
            </div>
          </Section>
        </>
      ) : null}
    </>
  );
}
