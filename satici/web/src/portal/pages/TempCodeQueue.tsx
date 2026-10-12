// GEÇİCİ KOD TALEPLERİ — bayilerin kendi müşterisinin kurulumu için açtığı bekleyen talepler (bayi kodu imzalayamaz:
// kodda sertifika taşınmaz, yalnız gömülü kök imzalar). Yönetici kök parolasıyla üretir ya da gerekçeyle reddeder.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { useWrite } from "../../shared/attempt";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { useApi, useCan } from "../../shared/session";
import type { TempCodeIssued, TempCodeRequest } from "../../shared/types";
import { Button, Field, KeyValues, Modal, ModalActions, PageTitle, QueryState, Section, Table } from "../../shared/ui";
import { TempCodeIssuedModal, signingError } from "../installation/TempCodePanel";

const requestTarget = (r: TempCodeRequest) => `${r.bayi ?? "Bayi"} › ${r.kurulum?.ad ?? r.kurulum?.kurulumId ?? r.kurulumId} — ${r.istekKodu} (${r.gun} gün)`;

function ApproveModal({ request, onClose, onDone }: { request: TempCodeRequest; onClose: () => void; onDone: (r: TempCodeIssued) => void }) {
  const api = useApi();
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const write = useWrite<TempCodeIssued>((body) => api.post(`/gecici-kod-talepleri/${request.id}/uret`, body));
  const submit = async () => {
    const r = await write.run({ sebep: reason.trim(), imzaParolasi: password });
    setPassword("");
    if (r.ok) onDone(r.data);
  };
  return (
    <Modal title="Talepten geçici kod üret" onClose={onClose} busy={write.pending} wide>
      <KeyValues
        items={[
          ["Bayi", request.bayi ?? "—"],
          ["Kurulum", request.kurulum ? `${request.kurulum.ad ?? "—"} (${request.kurulum.kurulumId})` : request.kurulumId],
          ["İstek kodu", <code key="i">{request.istekKodu}</code>],
          ["Gün", request.gun],
          ["Bayinin notu", request.sebep],
        ]}
      />
      <Field label="Sebep (deftere yazılır)">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label="Kök parolası" hint="Yalnız bu imza için kullanılır; kaydedilmez.">
        <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {signingError(write.error)}
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || !reason.trim() || !password}>
          {write.pending ? "İmzalanıyor…" : "Kodu üret"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

export function TempCodeQueuePage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const can = useCan("kurulum:gecici-kod");
  const list = useGet<TempCodeRequest[]>(["gecici-kod-talepleri"], "/gecici-kod-talepleri");
  const [approve, setApprove] = useState<TempCodeRequest | null>(null);
  const [reject, setReject] = useState<TempCodeRequest | null>(null);
  const [result, setResult] = useState<TempCodeIssued | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["gecici-kod-talepleri"] });
  return (
    <>
      <PageTitle title="Geçici kod talepleri" sub="Bayilerin bekleyen geçici açılış kodu talepleri; kod yalnız kök parolasıyla üretilir ve bayinin talebinde görünür." />
      <Section title="Bekleyen talepler">
        <QueryState isLoading={list.isLoading} error={list.error} />
        {list.data ? (
          <Table
            rows={list.data}
            rowKey={(r) => r.id}
            empty="Bekleyen talep yok."
            columns={[
              { header: "Tarih", render: (r) => fmtDateTime(r.createdAt) },
              { header: "Bayi", render: (r) => r.bayi ?? "—" },
              { header: "Kurulum", render: (r) => <Link to={`/kurulumlar/${r.kurulumId}`}>{r.kurulum?.ad ?? r.kurulum?.kurulumId ?? r.kurulumId.slice(0, 8)}</Link> },
              { header: "İstek kodu", render: (r) => <code>{r.istekKodu}</code> },
              { header: "Gün", render: (r) => r.gun },
              { header: "Not", render: (r) => r.sebep },
              {
                header: "",
                render: (r) =>
                  can ? (
                    <span className="section-actions">
                      <Button variant="ghost" onClick={() => setApprove(r)}>
                        Üret
                      </Button>
                      <Button variant="ghost" onClick={() => setReject(r)}>
                        Reddet
                      </Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        ) : null}
      </Section>
      {approve ? (
        <ApproveModal
          request={approve}
          onClose={() => setApprove(null)}
          onDone={(r) => {
            setApprove(null);
            setResult(r);
            refresh();
          }}
        />
      ) : null}
      {reject ? (
        <ConfirmAction
          title="Geçici kod talebini reddet"
          description="Talep reddedilir; bayi gerekçeyi kendi listesinde görür ve gerekirse yeni talep açar."
          targets={[requestTarget(reject)]}
          confirmLabel="Reddet"
          danger
          send={(b) => api.post(`/gecici-kod-talepleri/${reject.id}/reddet`, b)}
          onDone={() => {
            setReject(null);
            refresh();
          }}
          onClose={() => setReject(null)}
        />
      ) : null}
      {result ? <TempCodeIssuedModal result={result} onClose={() => setResult(null)} /> : null}
    </>
  );
}
