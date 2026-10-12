// G2 MUAFİYET BELGESİ — etkinleştirme kilidinden önce kurulmuş, hiç etkinleşmemiş fabrika sunucusunu kilitten muaf tutar
// (fabrika bugünkü gibi lisanssız sürer). Kimlik fabrikanın lisans ekranındaki karekod metninden gelir; belge o sunucunun
// anahtarına ve makinesine bağlıdır. Yalnız yönetici; imza ara imzacı (varsa) ya da kök parolasıyla.
import { useState } from "react";
import { ApiError } from "../../shared/api";
import { useWrite } from "../../shared/attempt";
import { useGet } from "../../shared/hooks";
import { useApi, useCan } from "../../shared/session";
import type { InstallationDetail } from "../../shared/types";
import { Button, ErrorText, Field, Modal, ModalActions, Section } from "../../shared/ui";
import { saveJson } from "./PaidThroughPanel";

interface ExemptionPlan {
  imzaci: "ARA" | "KOK" | "KUYRUK";
  kid: string | null;
}

export interface ExemptionResult {
  muafiyetId: string;
  anahtarKimligi: string;
  imzaci: "ARA" | "KOK";
  kid: string;
  dosya: { v: 1; muafiyet: string };
  dosyaAdi: string;
}

function ExemptionModal({ installationId, plan, onClose, onDone }: { installationId: string; plan: ExemptionPlan; onClose: () => void; onDone: (r: ExemptionResult) => void }) {
  const api = useApi();
  const [zarf, setZarf] = useState("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const write = useWrite<ExemptionResult>((body) => api.post(`/kurulumlar/${installationId}/muafiyet`, body));
  const submit = async () => {
    const r = await write.run({ zarf: zarf.trim(), sebep: reason.trim(), imzaci: plan.imzaci, imzaParolasi: password });
    setPassword("");
    if (r.ok) onDone(r.data);
  };
  const code = write.error instanceof ApiError ? write.error.code : null;
  return (
    <Modal title="Etkinleştirme muafiyeti ver" onClose={onClose} busy={write.pending} wide>
      <p>
        Fabrikada <strong>lisans ekranındaki karekodun metnini</strong> kopyalayıp buraya yapıştırın. Muafiyet yalnız o sunucunun anahtarına ve makinesine bağlıdır; başka
        sunucuda geçmez. Muafiyetli sunucu lisans etkinleştirmeden bugünkü gibi çalışır.
      </p>
      <Field label="Karekod metni">
        <textarea rows={4} value={zarf} onChange={(e) => setZarf(e.target.value)} aria-label="Karekod metni" />
      </Field>
      <Field label="Sebep (deftere ve belgeye yazılır)">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={plan.imzaci === "ARA" ? `Ara imzacı parolası (${plan.kid ?? ""})` : `Kök parolası (${plan.kid ?? ""})`} hint="Yalnız bu imza için kullanılır; kaydedilmez.">
        <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {code === "IMZA_PAROLASI_HATALI" ? <p className="error">Parola hatalı. Art arda hatalı denemede imza bir süre kilitlenir.</p> : <ErrorText error={write.error} />}
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || !zarf.trim() || !reason.trim() || !password}>
          {write.pending ? "İmzalanıyor…" : "Muafiyeti imzala"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

function ExemptionReady({ result, onClose }: { result: ExemptionResult; onClose: () => void }) {
  const [saved, setSaved] = useState<boolean | null>(null);
  return (
    <Modal title="Muafiyet dosyası hazır" onClose={onClose} wide>
      <p>
        Dosyayı müşteriye iletin; fabrika panelinde lisans ekranındaki <strong>“Lisans dosyası yükle”</strong> ile yüklenir. Kurulum anahtarı: <code>{result.anahtarKimligi}</code>.
      </p>
      <textarea readOnly rows={4} value={JSON.stringify(result.dosya)} aria-label="Dosya içeriği" />
      {saved === false ? <p className="muted small">Bu tarayıcı dosyayı kaydedemedi: metni kopyalayıp aynı adla .json dosyası olarak kaydedin.</p> : null}
      <ModalActions>
        <Button onClick={onClose}>Kapat</Button>
        <Button variant="primary" onClick={() => setSaved(saveJson(result.dosyaAdi, result.dosya))}>
          Dosyayı indir
        </Button>
      </ModalActions>
    </Modal>
  );
}

export function ExemptionPanel({ detail, onChanged }: { detail: InstallationDetail; onChanged: () => void }) {
  const can = useCan("kurulum:muafiyet");
  const inst = detail.kurulum;
  const visible = can && inst.durum === "ETKINLESMEDI";
  const plan = useGet<ExemptionPlan>(["muafiyet-plani", inst.id], `/kurulumlar/${inst.id}/muafiyet-plani`, undefined, visible);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<ExemptionResult | null>(null);
  if (!visible) return null;
  const p = plan.data;
  const ready = p !== undefined && p.imzaci !== "KUYRUK";
  return (
    <Section title="Etkinleştirme muafiyeti (eski kurulum)" actions={ready ? <Button onClick={() => setAsking(true)}>Muafiyet ver…</Button> : null}>
      <p className="muted small">
        Lisans etkinleştirmesi gelmeden önce kurulmuş ve hiç etkinleştirilmemiş bir fabrika sunucusu yeni sürümde yalnız lisans ekranını açar. Etkinleştirme yerine o sunucunun
        bugünkü gibi çalışması isteniyorsa imzalı muafiyet dosyası verilir.
      </p>
      {p && !ready ? <p className="error">Muafiyeti imzalayacak ara imzacı ya da kök anahtarı bu sunucuda yok.</p> : null}
      {asking && p && ready ? (
        <ExemptionModal
          installationId={inst.id}
          plan={p}
          onClose={() => setAsking(false)}
          onDone={(r) => {
            setAsking(false);
            setResult(r);
            onChanged();
          }}
        />
      ) : null}
      {result ? <ExemptionReady result={result} onClose={() => setResult(null)} /> : null}
    </Section>
  );
}
