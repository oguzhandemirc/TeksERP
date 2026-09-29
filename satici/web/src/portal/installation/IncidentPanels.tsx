// OLAYLAR — kopya uyarıları (kapat · diğer parmak izini kabul et), taşıma talepleri (onay/ret; her
// taşıma satıcı onayıyla), sağlık/parmak izi/yoklama/kira görünümü ve kurulum kaydı (eylem defteri).
import { useState } from "react";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtBytes, fmtDateTime, fmtDuration, shortId } from "../../shared/format";
import { COPY_ALERT_LABEL, LEASE_DECISION_LABEL, TRANSFER_STATUS_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import { installationName, type CopyAlert, type InstallationDetail, type InstallationRef, type TransferRequest } from "../../shared/types";
import { Badge, Button, KeyValues, Section, Table } from "../../shared/ui";

function refName(r: InstallationRef | undefined, fallback: string): string {
  return r ? `${r.tesis.musteri.ad} › ${r.tesis.ad} › ${r.ad ?? r.kurulumId.slice(0, 8)}` : fallback;
}

export function CopyAlertCloseDialog({ alert, target, onClose, onDone }: { alert: CopyAlert; target?: string; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [accept, setAccept] = useState(false);
  return (
    <ConfirmAction
      title="Kopya uyarısını kapat"
      description="Uyarı kapanır. “Diğer parmak izini kabul et” işaretlenirse eşleşmeyen makine meşru sayılır (ör. donanım değişimi); işaretlenmezse kabul edilen küme aynen kalır."
      targets={[`${refName(alert.kurulum, target ?? "Kurulum")} — ${label(COPY_ALERT_LABEL, alert.tur)} — ${alert.gorulmeSayisi} kez, son ${fmtDateTime(alert.sonGorulme)}`]}
      confirmLabel="Uyarıyı kapat"
      extra={
        <label className="check field">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          Diğer parmak izini kabul et (bu makine meşru)
        </label>
      }
      send={(b) => api.post(`/kopya-uyarilari/${alert.id}/kapat`, { ...b, digerParmakIziniKabulEt: accept })}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

export function TransferDecisionDialog({
  transfer,
  decision,
  target,
  onClose,
  onDone,
}: {
  transfer: TransferRequest;
  decision: "onayla" | "reddet";
  target?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useApi();
  return (
    <ConfirmAction
      title={decision === "onayla" ? "Taşımayı onayla" : "Taşımayı reddet"}
      description={
        decision === "onayla"
          ? "Yeni makinenin anahtarı kuruluma bağlanır; ESKİ makinenin kirası iptal olur (aynı anda iki üretim olmaz)."
          : "Talep reddedilir; eski makine çalışmaya devam eder, yeni makine kira alamaz."
      }
      targets={[`${refName(transfer.kurulum, target ?? "Kurulum")} — yeni anahtar ${transfer.yeniAnahtarKimligi}${transfer.gerekce ? ` — gerekçe: ${transfer.gerekce}` : ""}`]}
      confirmLabel={decision === "onayla" ? "Onayla" : "Reddet"}
      danger={decision === "reddet"}
      send={(b) => api.post(`/tasima-talepleri/${transfer.id}/${decision === "onayla" ? "onayla" : "reddet"}`, b)}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

export function IncidentsPanel({ detail, onChanged }: { detail: InstallationDetail; onChanged: () => void }) {
  const canManage = useCan("kurulum:yonet");
  const [alert, setAlert] = useState<CopyAlert | null>(null);
  const [transfer, setTransfer] = useState<{ t: TransferRequest; d: "onayla" | "reddet" } | null>(null);
  const name = installationName(detail.kurulum);
  const done = () => {
    setAlert(null);
    setTransfer(null);
    onChanged();
  };
  return (
    <>
      <Section title="Kopya uyarıları">
        <Table
          rows={detail.kopyaUyarilari ?? []}
          rowKey={(r) => r.id}
          empty="Kopya uyarısı yok"
          columns={[
            { header: "Tür", render: (r) => label(COPY_ALERT_LABEL, r.tur) },
            { header: "İlk / son", render: (r) => `${fmtDateTime(r.ilkGorulme)} / ${fmtDateTime(r.sonGorulme)}` },
            { header: "Sayı", render: (r) => r.gorulmeSayisi, className: "num-col" },
            { header: "Kira reddi", render: (r) => fmtDateTime(r.redZamani) },
            { header: "Durum", render: (r) => (r.durum === "ACIK" ? <Badge tone="danger">Açık</Badge> : <Badge>Kapandı ({r.kapatan ?? "—"})</Badge>) },
            { header: "", render: (r) => (canManage && r.durum === "ACIK" ? <Button variant="ghost" onClick={() => setAlert(r)}>Kapat</Button> : null) },
          ]}
        />
      </Section>
      <Section title="Taşıma talepleri">
        <Table
          rows={detail.tasimaTalepleri ?? []}
          rowKey={(r) => r.id}
          empty="Taşıma talebi yok"
          columns={[
            { header: "Tarih", render: (r) => fmtDateTime(r.createdAt) },
            { header: "Yeni anahtar", render: (r) => <code>{r.yeniAnahtarKimligi}</code> },
            { header: "Gerekçe", render: (r) => r.gerekce ?? "—" },
            { header: "Durum", render: (r) => label(TRANSFER_STATUS_LABEL, r.durum) + (r.kararSebebi ? ` — ${r.kararSebebi}` : "") },
            {
              header: "",
              render: (r) =>
                canManage && r.durum === "BEKLIYOR" ? (
                  <span className="section-actions">
                    <Button variant="ghost" onClick={() => setTransfer({ t: r, d: "onayla" })}>
                      Onayla
                    </Button>
                    <Button variant="ghost" onClick={() => setTransfer({ t: r, d: "reddet" })}>
                      Reddet
                    </Button>
                  </span>
                ) : null,
            },
          ]}
        />
      </Section>
      {alert ? <CopyAlertCloseDialog alert={alert} target={name} onClose={() => setAlert(null)} onDone={done} /> : null}
      {transfer ? <TransferDecisionDialog transfer={transfer.t} decision={transfer.d} target={name} onClose={() => setTransfer(null)} onDone={done} /> : null}
    </>
  );
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function HealthPanel({ detail }: { detail: InstallationDetail }) {
  const inst = detail.kurulum;
  const h = (inst.sonSaglik ?? {}) as Record<string, unknown>;
  const env = (inst.sonOrtam ?? {}) as Record<string, unknown>;
  const backup = (h.yedek ?? {}) as Record<string, unknown>;
  const clients = Array.isArray(h.istemciler) ? (h.istemciler as { tur?: string; surum?: string; adet?: number }[]) : [];
  const fp = inst.kabulEdilenParmakIzi ?? null;
  return (
    <>
      <Section title="Sağlık özeti (son yoklama)">
        {inst.sonSaglik ? (
          <KeyValues
            items={[
              ["Son yoklama", fmtDateTime(inst.sonYoklamaZamani)],
              ["Backend sürümü", String(h.surum ?? "—")],
              ["Çalışma süresi", fmtDuration(num(h.calismaSn))],
              ["Veritabanı", fmtBytes(num(h.dbBoyutBayt))],
              ["Yedek", `${String(backup.hukum ?? "—")}${num(backup.yasSaat) !== undefined ? ` · ${num(backup.yasSaat)} sa önce` : ""}`],
              ["Disk doluluğu", num(h.diskDolulukYuzde) !== undefined ? `%${num(h.diskDolulukYuzde)}` : "—"],
              ["Audit yazma hatası", String(num(h.auditYazmaHatasi) ?? "—")],
              ["İstemciler", clients.length ? clients.map((c) => `${c.tur ?? "?"} ${c.surum ?? ""} ×${c.adet ?? 0}`).join(", ") : "—"],
              ["Platform", `${String(env.isletimSistemi ?? inst.platform ?? "—")} · Node ${String(env.nodeSurum ?? "—")}`],
            ]}
          />
        ) : (
          <p className="muted">Henüz yoklama gelmedi.</p>
        )}
      </Section>
      <Section title="Kabul edilen parmak izi">
        {fp ? (
          <KeyValues items={(["f1", "f2", "f3", "f4", "f5"] as const).map((k) => [k.toUpperCase(), fp[k] ? <code key={k}>{shortId(fp[k], 12)}…</code> : <span className="muted">ölçülemedi</span>] as const)} />
        ) : (
          <p className="muted">Kurulum henüz etkinleşmedi.</p>
        )}
        <p className="muted small">F1 OS kimliği · F2 SMBIOS · F3 sistem diski · F4 anakart seri · F5 PostgreSQL. Değerler kurulum tuzuyla özetlidir; ham kimlik yoktur.</p>
      </Section>
      <Section title="Yoklama geçmişi (son 20)">
        <Table
          rows={detail.yoklamalar ?? []}
          rowKey={(r) => r.id}
          empty="Yoklama yok"
          columns={[
            { header: "Zaman", render: (r) => fmtDateTime(r.createdAt) },
            { header: "Sonuç", render: (r) => r.sonuc },
            { header: "Kademe (hesaplanan / uygulanan)", render: (r) => `${String(r.durum.hesaplananKademe ?? "—")} / ${String(r.durum.uygulananKademe ?? "—")}` },
            { header: "Kip", render: (r) => String(r.durum.kip ?? "—") },
            { header: "Reddedilecek istek", render: (r) => String(r.gozlem.reddedilecekIstek ?? "—"), className: "num-col" },
          ]}
        />
      </Section>
      <Section title="Kiralar (son 20)">
        <Table
          rows={detail.kiralar ?? []}
          rowKey={(r) => r.id}
          empty="Kira yok"
          columns={[
            { header: "Veriliş", render: (r) => fmtDateTime(r.verilis) },
            { header: "Bitiş", render: (r) => fmtDateTime(r.bitis) },
            { header: "Karar", render: (r) => label(LEASE_DECISION_LABEL, r.karar) },
            { header: "HAK sürümü", render: (r) => r.hakSurum },
            { header: "Anahtar", render: (r) => <code>{r.anahtarKimligi}</code> },
          ]}
        />
      </Section>
    </>
  );
}

export function RecordsPanel({ detail }: { detail: InstallationDetail }) {
  return (
    <Section title="Kurulum kaydı (eylem defteri)">
      <p className="muted small">Etkinleşme, taşıma, DR devri, iptal… Satır silinmez. Portal kullanıcılarının tüm eylemleri için Denetim defterine bakın.</p>
      <Table
        rows={detail.kurulumKaydi ?? []}
        rowKey={(r) => r.id}
        empty="Kayıt yok"
        columns={[
          { header: "Zaman", render: (r) => fmtDateTime(r.createdAt) },
          { header: "Olay", render: (r) => r.olay },
          { header: "Anahtar", render: (r) => (r.anahtarKimligi ? <code>{r.anahtarKimligi}</code> : "—") },
          { header: "Eski anahtar", render: (r) => (r.eskiAnahtarKimligi ? <code>{r.eskiAnahtarKimligi}</code> : "—") },
          { header: "Yapan", render: (r) => r.yapan },
        ]}
      />
    </Section>
  );
}
