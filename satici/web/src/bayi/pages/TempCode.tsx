// BAYİ GEÇİCİ KOD TALEBİ — bayi açılış kodunu kendisi imzalayamaz (kodda sertifika taşınmaz, yalnız gömülü kök imzalar);
// kendi müşterisinin kurulumu için istek kodu + gün + notla TALEP açar, satıcı üretince kod bu listede görünür.
import { useState } from "react";
import { useWrite } from "../../shared/attempt";
import { fmtDate, fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { useApi } from "../../shared/session";
import { DaysInput, RequestCodeInput, TEMP_CODE_DAYS, TEMP_REQUEST_STATUS_LABEL, TempCodeView, checkRequestCode, daysValid } from "../../shared/temp-code";
import type { InstallationDetail, TempCodeRequest } from "../../shared/types";
import { Badge, Button, ErrorText, Field, Modal, ModalActions, QueryState, Section } from "../../shared/ui";

function RequestModal({ installationId, onClose, onDone }: { installationId: string; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [requestCode, setRequestCode] = useState("");
  const [days, setDays] = useState(String(TEMP_CODE_DAYS.varsayilan));
  const [note, setNote] = useState("");
  const write = useWrite((body) => api.post(`/kurulumlar/${installationId}/gecici-kod-talep`, body));
  const check = checkRequestCode(requestCode);
  const dayCount = Number(days);
  const submit = async () => {
    if (!check.ok) return;
    const r = await write.run({ istekKodu: check.body, gun: dayCount, sebep: note.trim() });
    if (r.ok) onDone();
  };
  return (
    <Modal title="Geçici kod talep et" onClose={onClose} busy={write.pending} wide>
      <p>
        Fabrika panelinin lisans ekranındaki <strong>istek kodunu</strong> yazın. Talep satıcıya gider; kod üretilince bu kurulumun talep listesinde görünür.
      </p>
      <RequestCodeInput value={requestCode} onChange={setRequestCode} />
      <DaysInput value={days} onChange={setDays} />
      <Field label="Not (neden geçici kod gerekiyor)">
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Not" />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || !check.ok || !daysValid(dayCount) || !note.trim()}>
          {write.pending ? "Gönderiliyor…" : "Talebi gönder"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

function RequestRow({ r }: { r: TempCodeRequest }) {
  const tone = r.durum === "URETILDI" ? "ok" : r.durum === "REDDEDILDI" ? "danger" : "warn";
  return (
    <li className="temp-request">
      <p>
        <Badge tone={tone}>{TEMP_REQUEST_STATUS_LABEL[r.durum]}</Badge> {fmtDateTime(r.createdAt)} · <code>{r.istekKodu}</code> · {r.gun} gün · {r.sebep}
      </p>
      {r.durum === "REDDEDILDI" ? <p className="muted small">Ret gerekçesi: {r.kapanisSebebi ?? "—"}</p> : null}
      {r.durum === "URETILDI" && r.kod ? (
        r.kod.tuketildiAt ? (
          <p className="muted small">Kod fabrikada kullanıldı ({fmtDateTime(r.kod.tuketildiAt)}).</p>
        ) : r.kod.kod ? (
          <>
            <p className="muted small">Son geçerlilik {fmtDate(r.kod.bitis)}. Fabrika panelinde lisans ekranındaki “Yazarak etkinleştir” bölümüne girilir.</p>
            <TempCodeView code={r.kod.kod} />
          </>
        ) : (
          <p className="muted small">Kod metni bu listede açılamadı; satıcıdan yeniden üretim isteyin.</p>
        )
      ) : null}
    </li>
  );
}

export function BayiTempCodePanel({ detail }: { detail: InstallationDetail }) {
  const inst = detail.kurulum;
  const list = useGet<TempCodeRequest[]>(["gecici-kod-talepleri", inst.id], `/kurulumlar/${inst.id}/gecici-kod-talepleri`);
  const [asking, setAsking] = useState(false);
  const canRequest = inst.aktif && inst.durum !== "IPTAL";
  return (
    <Section title="Geçici açılış kodu (yazarak etkinleştirme)" actions={canRequest ? <Button onClick={() => setAsking(true)}>Geçici kod talep et…</Button> : null}>
      <p className="muted small">İnterneti ve karekod okutma imkânı olmayan fabrikaya telefonda okunan, süreli ve tek kullanımlık kod. Kodu satıcı üretir.</p>
      <QueryState isLoading={list.isLoading} error={list.error} />
      {list.data && list.data.length === 0 ? <p className="muted">Bu kurulum için talep yok.</p> : null}
      {list.data?.length ? (
        <ul className="plain-list">
          {list.data.map((r) => (
            <RequestRow key={r.id} r={r} />
          ))}
        </ul>
      ) : null}
      {asking ? (
        <RequestModal
          installationId={inst.id}
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false);
            void list.refetch();
          }}
        />
      ) : null}
    </Section>
  );
}
