// BAYİ — TAŞIMA TALEPLERİ: kendi kurulumunu hedefleyen talepler (bağlı ya da yalnız lisans kimliğiyle). Bayi bekleyen
// talebi yalnız REDDEDER: tanımadığı makinenin talebi gerçek taşımayı tutuyorsa çıkış budur. Onay ve taşıma kodu satıcıda.
import { useState } from "react";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { TRANSFER_STATUS_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import { installationName, type DealerTransferRequest, type InstallationDetail } from "../../shared/types";
import { Button, QueryState, Section, Table } from "../../shared/ui";

const machineOf = (r: DealerTransferRequest): string => [r.ortam.isletimSistemi ?? r.ortam.platform, r.ortam.uygulamaSurum ? `TeksERP ${r.ortam.uygulamaSurum}` : null].filter(Boolean).join(" · ") || "—";

export function BayiTransferPanel({ detail }: { detail: InstallationDetail }) {
  const api = useApi();
  const inst = detail.kurulum;
  const canReject = useCan("bayi:tasima-reddet");
  const list = useGet<DealerTransferRequest[]>(["tasima-talepleri", inst.id], `/kurulumlar/${inst.id}/tasima-talepleri`);
  const [reject, setReject] = useState<DealerTransferRequest | null>(null);
  return (
    <Section title="Taşıma talepleri">
      <p className="muted small">
        Lisansı yeni makineye taşıma talebi. Her lisans için aynı anda tek talep bekleyebilir; tanımadığınız bir talep gerçek taşımayı tutuyorsa reddedin, fabrika yeni talep açabilir. Onayı satıcı verir.
      </p>
      <QueryState isLoading={list.isLoading} error={list.error} />
      <Table
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        empty="Taşıma talebi yok"
        columns={[
          { header: "Tarih", render: (r) => fmtDateTime(r.createdAt) },
          { header: "Yeni anahtar", render: (r) => <code>{r.yeniAnahtarKimligi}</code> },
          { header: "Makine", render: machineOf },
          { header: "Gerekçe", render: (r) => r.gerekce ?? "—" },
          { header: "Durum", render: (r) => (r.kararSebebi ? `${label(TRANSFER_STATUS_LABEL, r.durum)} — ${r.kararSebebi}` : label(TRANSFER_STATUS_LABEL, r.durum)) },
          {
            header: "",
            render: (r) =>
              canReject && r.durum === "BEKLIYOR" ? (
                <Button variant="ghost" onClick={() => setReject(r)}>
                  Reddet
                </Button>
              ) : null,
          },
        ]}
      />
      {reject ? (
        <ConfirmAction
          title="Taşıma talebini reddet"
          description="Talep reddedilir ve kayıtta kalır; eski makine çalışmaya devam eder. Bu lisans için yeni taşıma talebi açılabilir."
          targets={[`${installationName(inst)} — yeni anahtar ${reject.yeniAnahtarKimligi} — ${fmtDateTime(reject.createdAt)}${reject.gerekce ? ` — gerekçe: ${reject.gerekce}` : ""}`]}
          confirmLabel="Reddet"
          danger
          send={(b) => api.post(`/tasima-talepleri/${reject.id}/reddet`, b)}
          onDone={() => {
            setReject(null);
            void list.refetch();
          }}
          onClose={() => setReject(null)}
        />
      ) : null}
    </Section>
  );
}
