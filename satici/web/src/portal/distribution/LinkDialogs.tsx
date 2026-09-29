// Dağıtım pencereleri — indirme bağlantısı (ilk kurulum derlemesi ya da paylaşılan dosya) ve yükleme
// isteği verme; iptal ConfirmAction'la (sebep zorunlu, ters kayıt). Bağlantı adresi BİR KEZ gösterilir
// (belirteç yalnız canlı yanıtta; tekrar yanıtı "gösterilemez" der) — önbelleğe/URL'ye yazılmaz.
import { useState } from "react";
import { useWrite } from "../../shared/attempt";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtBytes, fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { OnceSecretModal } from "../../shared/OnceSecret";
import { useApi } from "../../shared/session";
import { Button, ErrorText, Field, Modal, ModalActions } from "../../shared/ui";
import type { BuildFile, DownloadLink, TokenIssued, UploadRequest } from "./types";

const VALID_HOURS = [
  ["24", "1 gün"],
  ["72", "3 gün"],
  ["168", "7 gün"],
  ["720", "30 gün"],
] as const;

/** Tam adres (genel kök yapılandırılmışsa) ya da yol. */
export function TokenSecretModal({ issued, title, what, onClose }: { issued: TokenIssued; title: string; what: string; onClose: () => void }) {
  const secret = issued.adres ?? issued.yol ?? null;
  const note = issued.adres ? `${what} Bağlantıyı yalnız ilgili kişiye iletin.` : `${what} Genel adres yapılandırılmamış: yolu satıcı sunucusunun dış adresinin sonuna ekleyin.`;
  return <OnceSecretModal title={title} secret={secret} unavailable={issued.belirtecGosterilemez === true} note={note} onClose={onClose} />;
}

export function CreateLinkModal({
  kind,
  customerId,
  installationDbId,
  fileId,
  fileName,
  onClose,
  onIssued,
}: {
  kind: "ILK_KURULUM" | "DOSYA";
  customerId: string;
  installationDbId?: string;
  fileId?: string;
  fileName?: string;
  onClose: () => void;
  onIssued: (issued: TokenIssued) => void;
}) {
  const api = useApi();
  const builds = useGet<BuildFile[]>(["dagitim-derlemeler"], "/dagitim/derlemeler", undefined, kind === "ILK_KURULUM");
  const [build, setBuild] = useState("");
  const [hours, setHours] = useState("168");
  const [max, setMax] = useState(kind === "ILK_KURULUM" ? "3" : "5");
  const [note, setNote] = useState("");
  const write = useWrite<TokenIssued>((body) => api.post("/dagitim/baglantilar", body));
  const valid = (kind === "DOSYA" || build !== "") && Number(max) >= 1 && Number(max) <= 1000;
  const submit = async () => {
    const r = await write.run({
      tur: kind,
      musteriId: customerId,
      ...(installationDbId ? { kurulumId: installationDbId } : {}),
      ...(kind === "ILK_KURULUM" ? { derlemeAdi: build } : { dosyaId: fileId }),
      gecerlilikSaat: Number(hours),
      azamiIndirme: Number(max),
      ...(note.trim() ? { aciklama: note.trim() } : {}),
    });
    if (r.ok) onIssued(r.data);
  };
  return (
    <Modal title={kind === "ILK_KURULUM" ? "İlk kurulum bağlantısı ver" : "Paylaşım bağlantısı ver"} onClose={onClose} busy={write.pending}>
      {kind === "ILK_KURULUM" ? (
        <Field label="Derleme" hint="Müşteriye özel (filigranlı) derleme satıcının derleme dizinine konur; özeti bağlantı doğarken donar.">
          <select value={build} onChange={(e) => setBuild(e.target.value)}>
            <option value="">Seçin…</option>
            {(builds.data ?? []).map((b) => (
              <option key={b.ad} value={b.ad}>
                {b.ad} · {fmtBytes(b.boyut)} · {fmtDateTime(b.degisti)}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p>
          Dosya: <strong>{fileName}</strong>
        </p>
      )}
      <Field label="Geçerlilik">
        <select value={hours} onChange={(e) => setHours(e.target.value)}>
          {VALID_HOURS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="İndirme hakkı" hint="Her indirme bir hak tüketir (1–1000).">
        <input type="number" min={1} max={1000} value={max} onChange={(e) => setMax(e.target.value)} />
      </Field>
      <Field label="Açıklama (isteğe bağlı)">
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorText error={write.error ?? builds.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || !valid}>
          Bağlantı ver
        </Button>
      </ModalActions>
    </Modal>
  );
}

export function CreateRequestModal({ customerId, onClose, onIssued }: { customerId: string; onClose: () => void; onIssued: (issued: TokenIssued) => void }) {
  const api = useApi();
  const [hours, setHours] = useState("168");
  const [quota, setQuota] = useState("1024");
  const [maxFile, setMaxFile] = useState("512");
  const [note, setNote] = useState("");
  const write = useWrite<TokenIssued>((body) => api.post("/dagitim/yukleme-istekleri", body));
  const valid = Number(maxFile) >= 1 && Number(quota) >= Number(maxFile);
  const submit = async () => {
    const r = await write.run({ musteriId: customerId, gecerlilikSaat: Number(hours), kotaMb: Number(quota), azamiDosyaMb: Number(maxFile), ...(note.trim() ? { aciklama: note.trim() } : {}) });
    if (r.ok) onIssued(r.data);
  };
  return (
    <Modal title="Yükleme isteği ver" onClose={onClose} busy={write.pending}>
      <p>Müşteri bu bağlantıyla bize dosya gönderir (ekran görüntüsü, rapor, arşiv). Çalıştırılabilir dosya kabul edilmez.</p>
      <Field label="Geçerlilik">
        <select value={hours} onChange={(e) => setHours(e.target.value)}>
          {VALID_HOURS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Toplam kota (MB)">
        <input type="number" min={1} value={quota} onChange={(e) => setQuota(e.target.value)} />
      </Field>
      <Field label="Tek dosya tavanı (MB)">
        <input type="number" min={1} value={maxFile} onChange={(e) => setMaxFile(e.target.value)} />
      </Field>
      <Field label="Müşteriye görünen açıklama (isteğe bağlı)">
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || !valid}>
          İstek ver
        </Button>
      </ModalActions>
    </Modal>
  );
}

export function CancelLinkDialog({ link, onClose, onDone }: { link: DownloadLink; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  return (
    <ConfirmAction
      title="Bağlantıyı iptal et"
      description="Bağlantı kapanır; verilmiş ve indirilmiş kayıtlar defterde kalır (ters kayıt)."
      targets={[`${link.derlemeAdi ?? "Paylaşılan dosya"} · …${link.belirtecSonu} · ${link.indirmeSayisi}/${link.azamiIndirme} indirme`]}
      confirmLabel="İptal et"
      danger
      send={(body) => api.post(`/dagitim/baglantilar/${link.id}/iptal`, body)}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

export function CancelRequestDialog({ request, onClose, onDone }: { request: UploadRequest; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  return (
    <ConfirmAction
      title="Yükleme isteğini iptal et"
      description="Bağlantı kapanır; yarıda kalan yüklemeler terk edilir. Alınmış dosyalar ve defter kalır."
      targets={[`…${request.belirtecSonu} · ${fmtBytes(request.kullanilanBayt)} / ${fmtBytes(request.kotaBayt)}`]}
      confirmLabel="İptal et"
      danger
      send={(body) => api.post(`/dagitim/yukleme-istekleri/${request.id}/iptal`, body)}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
