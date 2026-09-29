import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtDate } from "../../shared/format";
import { CustomerFormModal, SiteFormModal } from "../../shared/forms";
import { useGet } from "../../shared/hooks";
import { useApi, useCan } from "../../shared/session";
import type { CustomerDetail, Dealer, Site } from "../../shared/types";
import { Badge, Button, KeyValues, PageTitle, QueryState, Section, Table } from "../../shared/ui";

type Dialog = { kind: "edit" } | { kind: "site"; site?: Site } | { kind: "active"; active: boolean } | { kind: "siteActive"; site: Site; active: boolean } | null;

export function CustomerDetailPage() {
  const { id = "" } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = useCan("musteri:yaz");
  const q = useGet<CustomerDetail>(["musteri", id], `/musteriler/${id}`);
  const dealers = useGet<Dealer[]>(["bayiler"], "/bayiler");
  const [dialog, setDialog] = useState<Dialog>(null);
  const refresh = () => {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ["musteri", id] });
    void queryClient.invalidateQueries({ queryKey: ["musteriler"] });
  };
  const c = q.data;
  return (
    <>
      <QueryState isLoading={q.isLoading} error={q.error} />
      {c ? (
        <>
          <PageTitle
            title={c.ad}
            sub={<Link to="/musteriler">← Müşteriler</Link>}
            actions={
              canWrite ? (
                <>
                  <Button onClick={() => setDialog({ kind: "edit" })}>Düzenle</Button>
                  <Button onClick={() => setDialog({ kind: "active", active: !c.aktif })}>{c.aktif ? "Pasife al" : "Aktif et"}</Button>
                </>
              ) : null
            }
          />
          <Section title="Künye">
            <KeyValues
              items={[
                ["Vergi no", c.vergiNo ?? "—"],
                ["Bayi", c.bayi?.ad ?? "Doğrudan satıcı"],
                ["Durum", c.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge>Pasif</Badge>],
                ["Kayıt", fmtDate(c.createdAt)],
              ]}
            />
          </Section>
          <Section title="Tesisler" actions={canWrite && c.aktif ? <Button onClick={() => setDialog({ kind: "site" })}>Yeni tesis</Button> : null}>
            <Table
              rows={c.tesisler}
              rowKey={(r) => r.id}
              columns={[
                { header: "Tesis", render: (r) => <Link to={`/kurulumlar?tesisId=${r.id}`}>{r.ad}</Link> },
                { header: "Kurulum", render: (r) => r._count?.kurulumlar ?? 0, className: "num-col" },
                { header: "Durum", render: (r) => (r.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge>Pasif</Badge>) },
                {
                  header: "",
                  render: (r) =>
                    canWrite ? (
                      <span className="section-actions">
                        <Button variant="ghost" onClick={() => navigate(`/kurulumlar?tesisId=${r.id}&yeni=1`)} disabled={!r.aktif}>
                          Kurulum ekle
                        </Button>
                        <Button variant="ghost" onClick={() => setDialog({ kind: "site", site: r })}>
                          Düzenle
                        </Button>
                        <Button variant="ghost" onClick={() => setDialog({ kind: "siteActive", site: r, active: !r.aktif })}>
                          {r.aktif ? "Pasife al" : "Aktif et"}
                        </Button>
                      </span>
                    ) : null,
                },
              ]}
            />
          </Section>
          {dialog?.kind === "edit" ? (
            <CustomerFormModal customer={c} dealers={(dealers.data ?? []).filter((d) => d.aktif || d.id === c.bayiId)} onClose={() => setDialog(null)} onSaved={refresh} />
          ) : null}
          {dialog?.kind === "site" ? <SiteFormModal customerId={c.id} site={dialog.site} onClose={() => setDialog(null)} onSaved={refresh} /> : null}
          {dialog?.kind === "active" ? (
            <ConfirmAction
              title={dialog.active ? "Müşteriyi aktif et" : "Müşteriyi pasife al"}
              description={dialog.active ? "Müşteri yeniden aktif olur." : "Pasif müşteriye yeni tesis/kurulum açılamaz. Canlı kurulumu olan müşteri pasife alınamaz (sunucu reddeder)."}
              targets={[c.ad]}
              confirmLabel={dialog.active ? "Aktif et" : "Pasife al"}
              danger={!dialog.active}
              send={(b) => api.post(`/musteriler/${c.id}/${dialog.active ? "aktif" : "pasif"}`, b)}
              onDone={refresh}
              onClose={() => setDialog(null)}
            />
          ) : null}
          {dialog?.kind === "siteActive" ? (
            <ConfirmAction
              title={dialog.active ? "Tesisi aktif et" : "Tesisi pasife al"}
              description={dialog.active ? "Tesis yeniden aktif olur." : "Pasif tesise yeni kurulum açılamaz."}
              targets={[`${c.ad} › ${dialog.site.ad}`]}
              confirmLabel={dialog.active ? "Aktif et" : "Pasife al"}
              danger={!dialog.active}
              send={(b) => api.post(`/tesisler/${dialog.site.id}/${dialog.active ? "aktif" : "pasif"}`, b)}
              onDone={refresh}
              onClose={() => setDialog(null)}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
