// ÖDENMİŞ TARİH (lisans v2) — P (fabrikanın internetsiz tam çalışacağı son gün) ve kaynağı, fabrikanın P modelini
// işletip işletmediği, son başarılı alışveriş ve "ödeme yaklaşıyor" bandının TAHMİNİ (karar fabrikada). Çevrimdışı
// uzatma dosyası: uca bağlı yeni kira + HAK imzalı dosya — yeni süre VERMEZ, P ödeme durumundan gelir.
import { useState } from "react";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtDate, fmtDateTime } from "../../shared/format";
import { PAID_THROUGH_KIND_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import { installationName, type ExtensionFile, type InstallationDetail } from "../../shared/types";
import { Badge, Button, KeyValues, Modal, ModalActions, Section } from "../../shared/ui";

/** Tarayıcıda JSON dosyası kaydettirir; ortam desteklemiyorsa false (metin kopyalama yolu kalır). */
function saveJson(name: string, value: unknown): boolean {
  if (typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

function ExtensionFileReady({ file, onClose }: { file: ExtensionFile; onClose: () => void }) {
  const [saved, setSaved] = useState<boolean | null>(null);
  return (
    <Modal title="Çevrimdışı uzatma dosyası hazır" onClose={onClose} wide>
      <p>
        Dosyayı müşteriye e-posta ya da USB ile iletin; fabrika panelinde <strong>Lisans → “Lisans dosyası yükle”</strong> ile yüklenir. Dosyadaki ödenmiş tarih:{" "}
        <strong>{file.odenmisTarih ? fmtDate(file.odenmisTarih) : "süresiz"}</strong>.
      </p>
      <p className="muted small">
        Dosya adı: <code>{file.dosyaAdi}</code> — içerik imzalıdır, düzenlenmez. Daha yenisi verildiğinde eski dosya fabrikada reddedilir.
      </p>
      <textarea readOnly rows={4} value={JSON.stringify(file.dosya)} aria-label="Dosya içeriği" />
      {saved === false ? <p className="muted small">Bu tarayıcı dosyayı kaydedemedi: metni kopyalayıp aynı adla .json dosyası olarak kaydedin.</p> : null}
      <ModalActions>
        <Button onClick={onClose}>Kapat</Button>
        <Button variant="primary" onClick={() => setSaved(saveJson(file.dosyaAdi, file.dosya))}>
          Dosyayı indir
        </Button>
      </ModalActions>
    </Modal>
  );
}

export function PaidThroughPanel({ detail, onChanged }: { detail: InstallationDetail; onChanged: () => void }) {
  const api = useApi();
  const canManage = useCan("kurulum:yonet");
  const [asking, setAsking] = useState(false);
  const [file, setFile] = useState<ExtensionFile | null>(null);
  const p = detail.odenmisTarih;
  const inst = detail.kurulum;
  if (p === undefined) return null;
  const canIssue = canManage && (inst.durum === "ETKIN" || inst.durum === "DEVREDILDI");
  const target = `${inst.tesis.musteri.ad} › ${inst.tesis.ad} › ${installationName(inst)}${detail.hak ? ` (${detail.hak.lisansNo})` : ""}`;
  return (
    <Section title="Ödenmiş tarih (internetsiz çalışma)" actions={canIssue ? <Button onClick={() => setAsking(true)}>Çevrimdışı uzatma dosyası…</Button> : null}>
      {p === null ? (
        <p className="muted">Aktif lisans (HAK) yok.</p>
      ) : (
        <KeyValues
          items={[
            ["Ödenmiş tarih (P)", p.tarih ? `${fmtDate(p.tarih)} — ${label(PAID_THROUGH_KIND_LABEL, p.tur)}` : "Süresiz"],
            [
              "Fabrikada P modeli",
              p.pModeli ? (
                <Badge key="p" tone="ok">
                  Evet — internetsiz P'ye dek tam çalışır
                </Badge>
              ) : (
                <Badge key="p" tone="warn">
                  Hayır — eski çapa (kira bitişi + ek süre)
                </Badge>
              ),
            ],
            ["Son başarılı alışveriş", p.sonAlisveris ? `${fmtDateTime(p.sonAlisveris)}${p.internetVar ? "" : " (24 saatten eski)"}` : "Yok"],
            ["“Ödeme yaklaşıyor” bandı (tahmini)", p.bantGorunurTahmini ? <Badge key="b" tone="info">Görünür</Badge> : "Görünmez"],
            ["Bildirilen yetenekler", inst.yetenekler && inst.yetenekler.length > 0 ? inst.yetenekler.join(", ") : "—"],
            ["Durum kaydı sırası", inst.sonDurumSirasi === null || inst.sonDurumSirasi === undefined ? "—" : String(inst.sonDurumSirasi)],
          ]}
        />
      )}
      <p className="muted small">
        P sözleşme sonu ya da sıradaki ödenmemiş taksitin vadesidir; ödeme onayında kendiliğinden ilerler. Bant fabrikada P'den 30 gün önce, yalnız internetsizken ya da P sözleşme
        sonuyken görünür.
      </p>
      {asking ? (
        <ConfirmAction<ExtensionFile>
          title="Çevrimdışı uzatma dosyası"
          description="Zincir ucuna bağlı yeni kira ve lisans (HAK) imzalı dosya olarak basılır. Yeni süre VERMEZ: dosya bugünkü ödenmiş tarihi taşır."
          targets={[target]}
          confirmLabel="Dosyayı üret"
          requireReason={false}
          send={(b) => api.post<ExtensionFile>(`/kurulumlar/${inst.id}/uzatma-dosyasi`, { clientToken: b.clientToken })}
          onDone={(r) => {
            setAsking(false);
            setFile(r);
            onChanged();
          }}
          onClose={() => setAsking(false)}
        />
      ) : null}
      {file ? <ExtensionFileReady file={file} onClose={() => setFile(null)} /> : null}
    </Section>
  );
}
