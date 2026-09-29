// BAYİ MÜŞTERİLERİ — yalnız bu bayiye bağlı müşteriler (sunucu süzer; başkasınınki "bulunamadı").
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { fmtDate } from "../../shared/format";
import { CustomerFormModal, SiteFormModal } from "../../shared/forms";
import { useGet, usePaged } from "../../shared/hooks";
import type { Customer, CustomerDetail } from "../../shared/types";
import { Badge, Button, KeyValues, LoadMore, PageTitle, QueryState, Section, Table } from "../../shared/ui";

export function BayiCustomersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const list = usePaged<Customer>(["musteriler"], "/musteriler", { arama: search.trim() || undefined });
  return (
    <>
      <PageTitle title="Müşterilerim" actions={<Button variant="primary" onClick={() => setCreating(true)}>Yeni müşteri</Button>} />
      <Section title="Liste">
        <div className="toolbar">
          <input placeholder="Ad ya da vergi no ara" aria-label="Ara" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          columns={[
            { header: "Müşteri", render: (r) => <Link to={`/musteriler/${r.id}`}>{r.ad}</Link> },
            { header: "Vergi no", render: (r) => r.vergiNo ?? "—" },
            { header: "Tesis", render: (r) => r._count?.tesisler ?? 0, className: "num-col" },
            { header: "Durum", render: (r) => (r.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge>Pasif</Badge>) },
            { header: "Kayıt", render: (r) => fmtDate(r.createdAt) },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
      {creating ? (
        <CustomerFormModal
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ["musteriler"] });
            navigate(`/musteriler/${c.id}`);
          }}
        />
      ) : null}
    </>
  );
}

export function BayiCustomerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const q = useGet<CustomerDetail>(["musteri", id], `/musteriler/${id}`);
  const [creatingSite, setCreatingSite] = useState(false);
  const c = q.data;
  if (!c) return <QueryState isLoading={q.isLoading} error={q.error} />;
  return (
    <>
      <PageTitle title={c.ad} sub={<Link to="/musteriler">← Müşterilerim</Link>} />
      <Section title="Künye">
        <KeyValues
          items={[
            ["Vergi no", c.vergiNo ?? "—"],
            ["Durum", c.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge>Pasif</Badge>],
            ["Kayıt", fmtDate(c.createdAt)],
          ]}
        />
      </Section>
      <Section title="Tesisler" actions={c.aktif ? <Button onClick={() => setCreatingSite(true)}>Yeni tesis</Button> : null}>
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
                r.aktif ? (
                  <Button variant="ghost" onClick={() => navigate(`/kurulumlar?tesisId=${r.id}&yeni=1`)}>
                    Kurulum ekle
                  </Button>
                ) : null,
            },
          ]}
        />
      </Section>
      {creatingSite ? (
        <SiteFormModal
          customerId={c.id}
          onClose={() => setCreatingSite(false)}
          onSaved={() => {
            setCreatingSite(false);
            void queryClient.invalidateQueries({ queryKey: ["musteri", id] });
          }}
        />
      ) : null}
    </>
  );
}
