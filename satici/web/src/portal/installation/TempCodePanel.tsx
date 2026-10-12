// GEÇİCİ AÇILIŞ KODU (yazarak etkinleştirme) — internetsiz, karekodsuz fabrikaya telefonda okunan kod. Fabrika istek kodunu
// (TI-…) söyler, yönetici kök parolasıyla imzalar; kod (TG-… 23 grup) YALNIZ canlı yanıtta ve bileşen durumunda yaşar.
// Liste kodun metnini taşımaz (son 4 karakter); karar ve sağlama sunucuda.
import { useState } from "react";
import { ApiError } from "../../shared/api";
import { useWrite } from "../../shared/attempt";
import { fmtDate, fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { useApi, useCan } from "../../shared/session";
import { DaysInput, RequestCodeInput, TEMP_CODE_DAYS, TempCodeView, checkRequestCode, daysValid } from "../../shared/temp-code";
import type { InstallationDetail, TempCodeIssued, TempCodeRequest, TempCodeRow } from "../../shared/types";
import { Badge, Button, ErrorText, Field, Modal, ModalActions, QueryState, Section, Table } from "../../shared/ui";

export function tempCodeState(r: { tuketildiAt: string | null; bitis: string }, nowMs = Date.now()): { text: string; tone: "ok" | "warn" | "neutral" } {
  if (r.tuketildiAt) return { text: `Tüketildi (${fmtDateTime(r.tuketildiAt)})`, tone: "neutral" };
  if (Date.parse(r.bitis) < nowMs) return { text: "Süresi doldu", tone: "warn" };
  return { text: "Geçerli", tone: "ok" };
}

/** Kök parolası alanı + hata — üretim formu ve talep üretimi aynı iletiyi gösterir. */
export function signingError(error: unknown) {
  const code = error instanceof ApiError ? error.code : null;
  return code === "IMZA_PAROLASI_HATALI" ? <p className="error">Kök parolası hatalı. Art arda hatalı denemede imza bir süre kilitlenir.</p> : <ErrorText error={error} />;
}

/** Üretilen kodu bir kez gösteren pencere; tekrar yanıtında kod yoktur. */
export function TempCodeIssuedModal({ result, onClose }: { result: TempCodeIssued; onClose: () => void }) {
  return (
    <Modal title="Geçici açılış kodu" onClose={onClose} wide>
      {result.kod ? (
        <>
          <p className="warn-box" role="alert">
            Bu kod bir daha gösterilmez. Fabrikadaki kişiye okuyun ya da kopyalayıp iletin; pencere kapanınca yeniden görüntülenemez.
          </p>
          <TempCodeView code={result.kod} />
          <p className="muted small">
            Kod no {result.kodNo} · {result.gun} gün · son geçerlilik {fmtDate(result.bitis)}. Fabrika panelinde lisans ekranındaki “Yazarak etkinleştir” bölümüne girilir.
          </p>
        </>
      ) : (
        <p className="error" role="alert">
          Bu yanıt bir tekrar yanıtıdır: kod yalnız ilk yanıtta gösterilir ve artık gösterilemez. Gerekirse yeni kod üretin.
        </p>
      )}
      <ModalActions>
        <Button variant="primary" onClick={onClose}>
          Kapat
        </Button>
      </ModalActions>
    </Modal>
  );
}

function IssueModal({ installationId, onClose, onDone }: { installationId: string; onClose: () => void; onDone: (r: TempCodeIssued) => void }) {
  const api = useApi();
  const [requestCode, setRequestCode] = useState("");
  const [days, setDays] = useState(String(TEMP_CODE_DAYS.varsayilan));
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const write = useWrite<TempCodeIssued>((body) => api.post(`/kurulumlar/${installationId}/gecici-kod`, body));
  const check = checkRequestCode(requestCode);
  const dayCount = Number(days);
  const submit = async () => {
    if (!check.ok) return;
    const r = await write.run({ istekKodu: check.body, gun: dayCount, sebep: reason.trim(), imzaParolasi: password });
    setPassword("");
    if (r.ok) onDone(r.data);
  };
  return (
    <Modal title="Geçici açılış kodu üret" onClose={onClose} busy={write.pending} wide>
      <p>
        Fabrika panelinin lisans ekranındaki <strong>istek kodunu</strong> yazın. Kod yalnız o sunucunun anahtarına bağlıdır ve bir kez kullanılır; tam etkinleştirme
        (karekod ya da internet) ayrıca yapılmalıdır.
      </p>
      <RequestCodeInput value={requestCode} onChange={setRequestCode} />
      <DaysInput value={days} onChange={setDays} />
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
        <Button variant="primary" onClick={submit} disabled={write.pending || !check.ok || !daysValid(dayCount) || !reason.trim() || !password}>
          {write.pending ? "İmzalanıyor…" : "Kodu üret"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

export function TempCodePanel({ detail }: { detail: InstallationDetail }) {
  const inst = detail.kurulum;
  const can = useCan("kurulum:gecici-kod");
  const list = useGet<{ kodlar: TempCodeRow[]; talepler: TempCodeRequest[] }>(["gecici-kodlar", inst.id], `/kurulumlar/${inst.id}/gecici-kodlar`);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<TempCodeIssued | null>(null);
  const issuable = can && inst.aktif && inst.durum !== "IPTAL";
  const pending = list.data?.talepler.filter((t) => t.durum === "BEKLIYOR") ?? [];
  return (
    <Section title="Geçici açılış kodu (yazarak etkinleştirme)" actions={issuable ? <Button onClick={() => setAsking(true)}>Geçici açılış kodu üret…</Button> : null}>
      <p className="muted small">İnterneti ve karekod okutma imkânı olmayan fabrikaya telefonda okunan, süreli ve tek kullanımlık açılış kodu.</p>
      <QueryState isLoading={list.isLoading} error={list.error} />
      {pending.length ? <p className="warn-box">Bu kurulum için {pending.length} bekleyen bayi talebi var (Geçici kod talepleri kuyruğu).</p> : null}
      {list.data ? (
        <Table
          rows={list.data.kodlar}
          rowKey={(r) => r.id}
          empty="Bu kuruluma geçici kod üretilmedi."
          columns={[
            { header: "Üretim", render: (r) => fmtDateTime(r.createdAt) },
            { header: "No", render: (r) => r.kodNo },
            { header: "Son 4", render: (r) => <code>…{r.kodSonu}</code> },
            { header: "İstek kodu", render: (r) => <code>{r.istekKodu}</code> },
            { header: "Gün", render: (r) => r.gun },
            { header: "Bitiş", render: (r) => fmtDate(r.bitis) },
            {
              header: "Durum",
              render: (r) => {
                const s = tempCodeState(r);
                return <Badge tone={s.tone}>{s.text}</Badge>;
              },
            },
            { header: "Üreten", render: (r) => r.ureten },
          ]}
        />
      ) : null}
      {asking ? (
        <IssueModal
          installationId={inst.id}
          onClose={() => setAsking(false)}
          onDone={(r) => {
            setAsking(false);
            setResult(r);
            void list.refetch();
          }}
        />
      ) : null}
      {result ? <TempCodeIssuedModal result={result} onClose={() => setResult(null)} /> : null}
    </Section>
  );
}
