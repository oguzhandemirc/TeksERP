// DESTEK TALEBİ AYRINTISI — talep, sağlık özeti, ek görüntü, defter (açılış · yanıt · kapanış),
// yanıtla ve kapat. Yazma işlem kimliğiyle (useWrite); kapalı talebe yanıt sunucuda 409.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "../../shared/attempt";
import { fmtBytes, fmtDateTime, fmtDuration } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { useApi, useCan } from "../../shared/session";
import { Button, ErrorText, Field, KeyValues, PageTitle, QueryState, Section, Table } from "../../shared/ui";
import { installationPath, supportStatusBadge, type SupportInstallation } from "./Support";

interface SupportEvent {
  readonly id: string;
  readonly tur: "ACILDI" | "YANIT" | "KAPATILDI";
  readonly metin: string | null;
  readonly yapan: string;
  readonly createdAt: string;
}

interface SupportDetail {
  readonly id: string;
  readonly talepNo: string;
  readonly konu: string;
  readonly aciklama: string;
  readonly acan: string | null;
  readonly panelSurum: string | null;
  readonly ekTuru: string | null;
  readonly saglik: Record<string, unknown>;
  readonly ortam: Record<string, unknown>;
  readonly durum: string;
  readonly createdAt: string;
  readonly kurulum: SupportInstallation;
  readonly olaylar: readonly SupportEvent[];
}

const EVENT_LABEL: Record<SupportEvent["tur"], string> = { ACILDI: "Açıldı", YANIT: "Yanıt", KAPATILDI: "Kapatıldı" };

function Attachment({ id }: { id: string }) {
  const q = useGet<{ tur: string; veri: string }>(["destek-ek", id], `/destek/${id}/ek`);
  if (!q.data) return <QueryState isLoading={q.isLoading} error={q.error} />;
  return <img className="support-shot" alt="Talebin ekran görüntüsü" src={`data:${q.data.tur};base64,${q.data.veri}`} />;
}

function HealthSummary({ d }: { d: SupportDetail }) {
  const s = d.saglik as { surum?: string; calismaSn?: number; dbBoyutBayt?: number | null; yedek?: { hukum?: string; yasSaat?: number | null }; diskDolulukYuzde?: number | null };
  const o = d.ortam as { platform?: string; isletimSistemi?: string; nodeSurum?: string };
  return (
    <KeyValues
      items={[
        ["Backend sürümü", s.surum ?? "—"],
        ["Panel sürümü", d.panelSurum ?? "—"],
        ["Çalışma süresi", fmtDuration(s.calismaSn)],
        ["DB boyutu", fmtBytes(s.dbBoyutBayt)],
        ["Son yedek", s.yedek ? `${s.yedek.hukum ?? "—"} · ${s.yedek.yasSaat ?? "—"} sa` : "—"],
        ["Disk doluluğu", s.diskDolulukYuzde == null ? "—" : `%${s.diskDolulukYuzde}`],
        ["İşletim sistemi", `${o.isletimSistemi ?? "—"} (${o.platform ?? "—"}, Node ${o.nodeSurum ?? "—"})`],
      ]}
    />
  );
}

export function SupportDetailPage() {
  const { id = "" } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const canWrite = useCan("destek:yanitla");
  const q = useGet<SupportDetail>(["destek", id], `/destek/${id}`);
  const [text, setText] = useState("");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["destek"] });
  };
  const reply = useWrite((body) => api.post(`/destek/${id}/yanitla`, body));
  const close = useWrite((body) => api.post(`/destek/${id}/kapat`, body));
  const d = q.data;
  if (!d) return <QueryState isLoading={q.isLoading} error={q.error} />;
  const open = d.durum !== "KAPANDI";
  return (
    <>
      <PageTitle title={`${d.talepNo} · ${d.konu}`} sub={<Link to={`/kurulumlar/${d.kurulum.id}`}>{installationPath(d.kurulum)}</Link>} actions={supportStatusBadge(d.durum)} />
      <Section title="Talep">
        <KeyValues items={[["Açan", d.acan ?? "—"], ["Açılış", fmtDateTime(d.createdAt)]]} />
        <p className="pre-wrap">{d.aciklama}</p>
        {d.ekTuru ? <Attachment id={d.id} /> : null}
      </Section>
      <Section title="Sağlık özeti (talep anı)">
        <HealthSummary d={d} />
      </Section>
      <Section title="Defter">
        <Table
          rows={d.olaylar}
          rowKey={(r) => r.id}
          columns={[
            { header: "Zaman", render: (r) => fmtDateTime(r.createdAt) },
            { header: "Olay", render: (r) => EVENT_LABEL[r.tur] ?? r.tur },
            { header: "Metin", render: (r) => <span className="pre-wrap">{r.metin ?? "—"}</span> },
            { header: "Yapan", render: (r) => r.yapan },
          ]}
        />
      </Section>
      {canWrite && open ? (
        <Section title="Yanıtla">
          <Field label="Yanıt" hint="Fabrikanın panelinde talebin altında görünür (en geç bir sonraki yoklamada).">
            <textarea value={text} maxLength={5000} rows={5} onChange={(e) => setText(e.target.value)} />
          </Field>
          <ErrorText error={reply.error ?? close.error} />
          <div className="toolbar">
            <Button
              variant="primary"
              disabled={reply.pending || text.trim() === ""}
              onClick={async () => {
                const r = await reply.run({ metin: text.trim() });
                if (r.ok) {
                  setText("");
                  refresh();
                }
              }}
            >
              Yanıtı gönder
            </Button>
            <Button
              disabled={close.pending}
              onClick={async () => {
                const r = await close.run({ not: text.trim() === "" ? null : text.trim() });
                if (r.ok) {
                  setText("");
                  refresh();
                }
              }}
            >
              {text.trim() === "" ? "Talebi kapat" : "Notla kapat"}
            </Button>
          </div>
        </Section>
      ) : null}
    </>
  );
}
