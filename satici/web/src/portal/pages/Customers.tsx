import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { fmtDate } from "../../shared/format";
import { CustomerFormModal } from "../../shared/forms";
import { useGet, usePaged } from "../../shared/hooks";
import { useCan } from "../../shared/session";
import type { Customer, Dealer } from "../../shared/types";
import { Badge, Button, LoadMore, PageTitle, QueryState, Section, Table } from "../../shared/ui";

export function CustomersPage() {
  const canWrite = useCan("musteri:yaz");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<"" | "true" | "false">("true");
  const [creating, setCreating] = useState(false);
  const list = usePaged<Customer>(["musteriler"], "/musteriler", { arama: search.trim() || undefined, aktif: active || undefined });
  const dealers = useGet<Dealer[]>(["bayiler"], "/bayiler");
  return (
    <>
      <PageTitle title="Müşteriler" sub="Müşteri → Tesis → Kurulum" actions={canWrite ? <Button variant="primary" onClick={() => setCreating(true)}>Yeni müşteri</Button> : null} />
      <Section title="Liste">
        <div className="toolbar">
          <input placeholder="Ad ya da vergi no ara" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Ara" />
          <select value={active} onChange={(e) => setActive(e.target.value as typeof active)} aria-label="Durum">
            <option value="true">Aktif</option>
            <option value="false">Pasif</option>
            <option value="">Tümü</option>
          </select>
        </div>
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          columns={[
            { header: "Müşteri", render: (r) => <Link to={`/musteriler/${r.id}`}>{r.ad}</Link> },
            { header: "Vergi no", render: (r) => r.vergiNo ?? "—" },
            { header: "Bayi", render: (r) => r.bayi?.ad ?? "Doğrudan" },
            { header: "Tesis", render: (r) => r._count?.tesisler ?? 0, className: "num-col" },
            { header: "Durum", render: (r) => (r.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge>Pasif</Badge>) },
            { header: "Kayıt", render: (r) => fmtDate(r.createdAt) },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
      {creating ? (
        <CustomerFormModal
          dealers={(dealers.data ?? []).filter((d) => d.aktif)}
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
