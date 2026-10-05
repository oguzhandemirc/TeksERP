// OLAYLAR — kopya uyarıları (kapat · diğer parmak izini kabul et), taşıma talepleri (onay → tek kullanımlık
// taşıma kodu / ret; her taşıma satıcı onayıyla, kimliksiz talepte hedefi operatör seçer), sağlık/parmak izi/yoklama/kira görünümü ve kurulum kaydı (eylem defteri).
import { useState } from "react";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { OnceSecretModal } from "../../shared/OnceSecret";
import { fmtBytes, fmtDate, fmtDateTime, fmtDuration, shortId } from "../../shared/format";
import { CLOSING_REASON_LABEL, COPY_ALERT_LABEL, LEASE_DECISION_LABEL, LOCAL_INTERVENTION_CAUSE_LABEL, TRANSFER_STATUS_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import { installationName, type CopyAlert, type InstallationDetail, type InstallationRef, type TransferApproved, type TransferRequest } from "../../shared/types";
import { Badge, Button, Field, KeyValues, Section, Table } from "../../shared/ui";

/** YEREL_MUDAHALE uyarısının nedenleri (ekran adıyla, görülme sayısıyla); diğer türlerde boş. */
export function alertCauses(alert: CopyAlert): string {
  const causes = alert.ayrinti?.nedenler ?? [];
  return causes.map((c) => `${label(LOCAL_INTERVENTION_CAUSE_LABEL, c)}${alert.ayrinti?.sayac?.[c] ? ` ×${alert.ayrinti.sayac[c]}` : ""}`).join(" · ");
}

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

/** Kimliksiz talepte hedef kurulumun satıcı kaydı (ipucu listesinden ya da elle). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const unbound = !transfer.kurulumId;
  const suggestions = transfer.onerilenKurulumlar ?? [];
  const [chosen, setChosen] = useState(suggestions[0]?.id ?? "");
  const [code, setCode] = useState<NonNullable<TransferApproved["tasimaKodu"]> | null>(null);
  const targetOk = !unbound || decision === "reddet" || UUID_PATTERN.test(chosen.trim());
  if (code) {
    return (
      <OnceSecretModal
        title="Taşıma kodu"
        secret={code.kod}
        unavailable={code.kodGosterilemez === true}
        note={`Kodu müşterinin yöneticisine iletin: yeni makine Lisans ekranında bu kodla etkinleşir, eski makinenin kirası o anda biter (son geçerlilik ${fmtDate(code.gecerlilikBitis)}).`}
        onClose={onDone}
      />
    );
  }
  return (
    <ConfirmAction<TransferApproved | unknown>
      title={decision === "onayla" ? "Taşımayı onayla" : "Taşımayı reddet"}
      description={
        decision === "onayla"
          ? "Onay tek kullanımlık TAŞIMA KODU üretir (yalnız bir kez gösterilir). Yeni makine kodla etkinleşince anahtar değişir ve ESKİ makinenin kirası biter; kod kullanılana dek eski makine çalışır."
          : "Talep reddedilir; eski makine çalışmaya devam eder, yeni makine kira alamaz."
      }
      targets={[`${refName(transfer.kurulum, target ?? (unbound ? "Kuruluma bağlanmamış (kimliksiz) talep" : "Kurulum"))} — yeni anahtar ${transfer.yeniAnahtarKimligi}${transfer.gerekce ? ` — gerekçe: ${transfer.gerekce}` : ""}`]}
      confirmLabel={decision === "onayla" ? "Onayla ve kod üret" : "Reddet"}
      danger={decision === "reddet"}
      extra={
        unbound && decision === "onayla" ? (
          <Field label="Hedef kurulum (satıcı kaydı)" hint="Makine lisans kimliğini bilmiyor: talebi hangi kuruluma bağlayacağınızı seçin. Öneri, fabrika DB kimliği aynı olan kurulumlardır (ipucu, kanıt değil).">
            {suggestions.length > 0 ? (
              <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
                {suggestions.map((k) => (
                  <option key={k.id} value={k.id}>
                    {`${k.tesis.musteri.ad} › ${k.tesis.ad} › ${k.ad ?? k.kurulumId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            ) : (
              <input value={chosen} placeholder="kurulum kaydının id'si (UUID)" spellCheck={false} autoComplete="off" onChange={(e) => setChosen(e.target.value)} />
            )}
          </Field>
        ) : null
      }
      extraValid={targetOk}
      send={(b) =>
        decision === "onayla"
          ? api.post<TransferApproved>(`/tasima-talepleri/${transfer.id}/onayla`, unbound ? { ...b, kurulumId: chosen.trim() } : b)
          : api.post(`/tasima-talepleri/${transfer.id}/reddet`, b)
      }
      onDone={(r) => {
        const approved = r as TransferApproved | null;
        if (decision === "onayla" && approved?.tasimaKodu) setCode(approved.tasimaKodu);
        else onDone();
      }}
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
            { header: "Neden", render: (r) => alertCauses(r) || "—" },
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
      <Section title="Açık modüller (fabrikanın bildirdiği)">
        {inst.acikModuller ? (
          <KeyValues
            items={[
              ["Açık modüller", inst.acikModuller.length > 0 ? inst.acikModuller.map((m) => <code key={m}>{m}</code>).flatMap((c, i) => (i === 0 ? [c] : [" · ", c])) : "Hiçbiri açık değil"],
              ["Bildirim zamanı", fmtDateTime(inst.acikModullerZamani ?? null)],
            ]}
          />
        ) : (
          <p className="muted" data-testid="acik-moduller-bilinmiyor">Bilinmiyor — fabrika henüz bildirmedi (eski sürüm olabilir).</p>
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
            { header: "Karar", render: (r) => label(LEASE_DECISION_LABEL, r.karar) + (r.kapanisNedeni ? ` — ${label(CLOSING_REASON_LABEL, r.kapanisNedeni)}` : "") },
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
