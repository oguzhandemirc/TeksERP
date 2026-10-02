// KÖK İMZASI KUYRUĞU (lisans v2 · G4): yetenek bildirmeyen derlemenin HAK değişikliği kök imzası bekler; dönem töreninde
// Mac'te imzalanır (`kuyruk-disa-aktar` → `kuyruk-imzala` → `donem-ice-aktar`). ACİL talep: yetenek düşüşünde fabrika kira
// alamadı (genişlik kapısı) — üç aylık tören beklenmeden imzalanmalı; liste ACİL olanları ayrıca en üstte gösterir.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtDateTime } from "../../shared/format";
import { usePaged } from "../../shared/hooks";
import { ROOT_REQUEST_STATUS_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import type { RootRequest } from "../../shared/types";
import { Badge, Button, LoadMore, PageTitle, QueryState, Section, Table } from "../../shared/ui";

/** Dönem töreninin runbook'u (repoda; portal dosyayı sunmaz — yol gösterilir). */
export const CEREMONY_RUNBOOK = "docs/ops/URETIM-SATICI-TOREN.md §8";

/** Töreni anlatan kısa yönerge: kuyruk VDS'ten Mac'e, kök imzası Mac'te, sonuç geri VDS'e. */
function CeremonyGuide() {
  return (
    <Section title="Tören nasıl işler">
      <ol className="small">
        <li>
          VDS: bekleyen talepler dışa aktarılır (<code>anahtar.js kuyruk-disa-aktar</code>) — ACİL olanlar önce.
        </li>
        <li>
          Mac: dönem töreni kökle imzalar (<code>uretim-toren.mjs donem --kuyruk=…</code>); kök parolası yalnız orada yazılır, VDS'e gelmez.
        </li>
        <li>
          VDS: paket içe aktarılır (<code>anahtar.js donem-ice-aktar</code>) — talep İmzalandı olur, fabrika sonraki yoklamada yeni sürümü alır. HAK arada başka
          sürüme geçtiyse talep Eskidi olur (imza yazılmaz).
        </li>
      </ol>
      <p className="muted small">
        Ayrıntı ve komutlar: <code>{CEREMONY_RUNBOOK}</code>. ACİL talepte üç aylık töreni beklemeyin: fabrika elindeki kirayla ödenmiş tarihe dek çalışır ama yeni
        kira alamaz.
      </p>
    </Section>
  );
}

function requestLabel(r: RootRequest): string {
  return `${r.lisansNo} — sürüm ${r.tabanSurum} → ${r.surum}${r.acil ? " (ACİL)" : ""}`;
}

export function RootQueuePage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const canWrite = useCan("hak:yaz");
  const [status, setStatus] = useState("BEKLIYOR");
  const [cancel, setCancel] = useState<RootRequest | null>(null);
  const urgent = usePaged<RootRequest>(["kok-kuyrugu"], "/kok-kuyrugu", { durum: "BEKLIYOR", acil: true });
  const list = usePaged<RootRequest>(["kok-kuyrugu"], "/kok-kuyrugu", { durum: status || undefined });
  const columns = [
    { header: "Tarih", render: (r: RootRequest) => fmtDateTime(r.createdAt) },
    {
      header: "Kurulum",
      render: (r: RootRequest) => <Link to={`/kurulumlar/${r.kurulumId}`}>{r.kurulum.ad ?? r.kurulum.kurulumId.slice(0, 8)}</Link>,
    },
    { header: "Lisans", render: (r: RootRequest) => r.lisansNo },
    { header: "Sürüm", render: (r: RootRequest) => `${r.tabanSurum} → ${r.surum}`, className: "num-col" },
    { header: "Öncelik", render: (r: RootRequest) => (r.acil ? <Badge tone="danger">ACİL — fabrika kira alamıyor</Badge> : r.uzunUfuk ? <Badge tone="warn">Uzun ufuk</Badge> : "—") },
    { header: "Sebep", render: (r: RootRequest) => r.sebep },
    { header: "Durum", render: (r: RootRequest) => label(ROOT_REQUEST_STATUS_LABEL, r.durum) },
    {
      header: "",
      render: (r: RootRequest) => (canWrite && r.durum === "BEKLIYOR" ? <Button variant="ghost" onClick={() => setCancel(r)}>İptal et</Button> : null),
    },
  ];
  return (
    <>
      <PageTitle
        title="Kök imzası kuyruğu"
        sub="Yetenek bildirmeyen derlemenin HAK değişikliği dönem töreninde Mac'te kökle imzalanır. ACİL talepte fabrika kira alamıyor: töreni beklemeden imzalayın."
      />
      <CeremonyGuide />
      <Section title="Acil kök imzası gerekiyor">
        <QueryState isLoading={urgent.isLoading} error={urgent.error} />
        <Table rows={urgent.rows} rowKey={(r) => r.id} empty="Acil talep yok" columns={columns} />
        <LoadMore hasMore={urgent.hasMore} loading={urgent.loadingMore} onClick={urgent.loadMore} />
      </Section>
      <Section title="Liste">
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Durum">
            <option value="">Tümü</option>
            {Object.entries(ROOT_REQUEST_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table rows={list.rows} rowKey={(r) => r.id} columns={columns} />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
      {cancel ? (
        <ConfirmAction
          title="Kök imzası talebini iptal et"
          description="Talep imzalanmaz; satır IPTAL olarak kalır. Yetenek düşüşü sürerse sonraki yoklama güncel şartlarla yeni talep açar."
          targets={[requestLabel(cancel)]}
          confirmLabel="İptal et"
          danger
          send={(b) => api.post(`/kok-kuyrugu/${cancel.id}/iptal`, b)}
          onDone={() => {
            setCancel(null);
            void queryClient.invalidateQueries({ queryKey: ["kok-kuyrugu"] });
          }}
          onClose={() => setCancel(null)}
        />
      ) : null}
    </>
  );
}
