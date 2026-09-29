// BAYİ KÜNYESİ — güncel tavan + tavan defteri (her değişim yeni sürüm), bayi anahtarı bağlama,
// bayi kullanıcıları, pasife alma. Tavan daraltması bayinin SONRAKİ imzalarını bağlar; imzalanmış
// lisans geri alınmaz (gerekirse kurulum yaptırımı).
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "../../shared/attempt";
import { CeilingFields, ceilingBody, ceilingDraftOf, ceilingDraftValid, ceilingSummary, type CeilingDraft } from "../../shared/CeilingFields";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtDate, fmtDateTime } from "../../shared/format";
import { useChannels, useGet } from "../../shared/hooks";
import { CLASS_LABEL, MODULE_LABEL, ROLE_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import type { Catalog, DealerDetail } from "../../shared/types";
import { Badge, Button, ErrorText, Field, KeyValues, Modal, ModalActions, PageTitle, QueryState, Section, Table } from "../../shared/ui";

const DEALER_KID = /^bayi-[a-z0-9-]{1,60}$/;

type Dialog = "ceiling" | "key" | "active" | null;

export function DealerDetailPage() {
  const { id = "" } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const canManage = useCan("bayi:yonet");
  const canUsers = useCan("kullanici:yonet");
  const q = useGet<DealerDetail>(["bayi", id], `/bayiler/${id}`);
  const [dialog, setDialog] = useState<Dialog>(null);
  const refresh = () => {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ["bayi", id] });
    void queryClient.invalidateQueries({ queryKey: ["bayiler"] });
  };
  const d = q.data;
  if (!d) return <QueryState isLoading={q.isLoading} error={q.error} />;
  const t = d.tavan;
  return (
    <>
      <PageTitle
        title={d.ad}
        sub={<Link to="/bayiler">← Bayiler</Link>}
        actions={
          canManage ? (
            <>
              <Button onClick={() => setDialog("ceiling")}>Tavanı değiştir</Button>
              <Button onClick={() => setDialog("key")}>{d.anahtarKid ? "Anahtarı değiştir" : "Anahtar bağla"}</Button>
              <Button variant={d.aktif ? "danger" : "default"} onClick={() => setDialog("active")}>
                {d.aktif ? "Pasife al" : "Aktif et"}
              </Button>
            </>
          ) : null
        }
      />
      <Section title="Künye">
        <KeyValues
          items={[
            ["Vergi no", d.vergiNo ?? "—"],
            ["Durum", d.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge>Pasif</Badge>],
            ["İmza anahtarı", d.anahtarKid ? <code>{d.anahtarKid}</code> : <Badge tone="warn">Bağlı değil (bayi imzalayamaz)</Badge>],
            ["Müşteri sayısı", String(d.musteriSayisi)],
            ["Kurulum kullanımı", `${d.kullanim} / ${t?.kurulumAdedi ?? 0}`],
            ["Kayıt", fmtDate(d.createdAt)],
          ]}
        />
      </Section>
      <Section title={`Güncel tavan${t ? ` (sürüm ${t.surum})` : ""}`}>
        {t ? (
          <KeyValues
            items={[
              ["Modüller", t.moduller.map((m) => label(MODULE_LABEL, m)).join(", ") || "—"],
              ["Sınıflar", t.siniflar.map((c) => label(CLASS_LABEL, c)).join(", ")],
              ["Kurulum adedi", String(t.kurulumAdedi)],
              ...(t.kanallar ? ([["Kanallar", t.kanallar.join(", ") || "Yok (kurulum açamaz)"]] as const) : []),
              ...(t.kaliciIzni !== undefined ? ([["Kalıcı lisans", t.kaliciIzni ? "İmzalayabilir" : "İmzalayamaz"]] as const) : []),
              ...(t.bakimAyTavani !== undefined ? ([["Bakım ay tavanı", `${t.bakimAyTavani} ay`]] as const) : []),
            ]}
          />
        ) : (
          <p className="muted">Tavan yok.</p>
        )}
      </Section>
      <Section title="Tavan defteri">
        <p className="muted small">Her değişim yeni bir sürüm satırıdır; eski sürümler silinmez.</p>
        <Table
          rows={d.tavanGecmisi}
          rowKey={(r) => r.id}
          columns={[
            { header: "Sürüm", render: (r) => r.surum },
            { header: "Tavan", render: (r) => ceilingSummary(r) },
            { header: "Sebep", render: (r) => r.sebep },
            { header: "Yapan", render: (r) => r.yapan },
            { header: "Tarih", render: (r) => fmtDateTime(r.createdAt) },
          ]}
        />
      </Section>
      <Section title="Bayi kullanıcıları" actions={canUsers ? <Link to={`/kullanicilar?bayiId=${d.id}`}>Kullanıcıları yönet</Link> : null}>
        <Table
          rows={d.kullanicilar}
          rowKey={(r) => r.id}
          empty="Bu bayinin kullanıcısı yok"
          columns={[
            { header: "Kullanıcı", render: (r) => r.kullaniciAdi },
            { header: "Ad soyad", render: (r) => r.adSoyad },
            { header: "Rol", render: (r) => label(ROLE_LABEL, r.rol) },
            { header: "Durum", render: (r) => (r.aktif ? (r.kilitli ? <Badge tone="warn">Kilitli</Badge> : <Badge tone="ok">Aktif</Badge>) : <Badge>Pasif</Badge>) },
            { header: "Son giriş", render: (r) => fmtDateTime(r.sonGiris) },
          ]}
        />
      </Section>
      {dialog === "ceiling" ? <CeilingModal dealer={d} onClose={() => setDialog(null)} onDone={refresh} /> : null}
      {dialog === "key" ? <DealerKeyModal dealer={d} onClose={() => setDialog(null)} onDone={refresh} /> : null}
      {dialog === "active" ? (
        <ConfirmAction
          title={d.aktif ? "Bayiyi pasife al" : "Bayiyi aktif et"}
          description={
            d.aktif
              ? "Pasif bayi yeni kurulum açamaz ve lisans imzalayamaz; bayinin müşterileri ve imzalanmış lisansları yerinde kalır."
              : "Bayi yeniden kurulum açabilir ve tavan içinde imzalayabilir."
          }
          targets={[`${d.ad} — ${d.musteriSayisi} müşteri, ${d.kullanim} kurulum`]}
          confirmLabel={d.aktif ? "Pasife al" : "Aktif et"}
          danger={d.aktif}
          send={(b) => api.post(`/bayiler/${d.id}/${d.aktif ? "pasif" : "aktif"}`, b)}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

function CeilingModal({ dealer, onClose, onDone }: { dealer: DealerDetail; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const catalog = useGet<Catalog>(["katalog"], "/katalog");
  const channels = useChannels();
  const [draft, setDraft] = useState<CeilingDraft>(ceilingDraftOf(dealer.tavan));
  const [reason, setReason] = useState("");
  const write = useWrite((b) => api.post(`/bayiler/${dealer.id}/tavan`, b));
  const ok = reason.trim() !== "" && ceilingDraftValid(draft) && !channels.isLoading && catalog.data !== undefined;
  const count = Number(draft.count);
  return (
    <Modal title="Bayi tavanını değiştir" onClose={onClose} busy={write.pending} wide>
      <p>
        <strong>{dealer.ad}</strong> — şu anki tavan: {ceilingSummary(dealer.tavan)}. Yeni tavan yeni bir sürüm olarak yazılır ve bayinin sonraki imzalarını bağlar.
      </p>
      {catalog.data ? (
        <CeilingFields draft={draft} onChange={setDraft} modules={catalog.data.moduller} classes={catalog.data.siniflar} channels={channels.channels} />
      ) : (
        <QueryState isLoading={catalog.isLoading} error={catalog.error} />
      )}
      {Number.isFinite(count) && count < dealer.kullanim ? (
        <p className="warn-box">
          Yeni adet ({count}) bugünkü kullanımın ({dealer.kullanim}) altında: mevcut kurulumlar kalır, bayi yeni kurulum açamaz.
        </p>
      ) : null}
      <Field label="Sebep (zorunlu, tavan defterine yazılır)">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" disabled={!ok || write.pending} onClick={async () => (await write.run({ tavan: ceilingBody(draft), sebep: reason.trim() })).ok && onDone()}>
          Yeni tavanı kaydet
        </Button>
      </ModalActions>
    </Modal>
  );
}

function DealerKeyModal({ dealer, onClose, onDone }: { dealer: DealerDetail; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [kid, setKid] = useState(dealer.anahtarKid ?? "");
  const write = useWrite((b) => api.post(`/bayiler/${dealer.id}/anahtar`, b));
  const ok = DEALER_KID.test(kid.trim());
  return (
    <Modal title="Bayi imza anahtarı" onClose={onClose} busy={write.pending}>
      <p>
        <strong>{dealer.ad}</strong> — anahtar satıcı sunucusunda çevrimdışı üretilir (<code>npx tsx scripts/anahtar.ts bayi-uret</code>, kök parolasıyla sertifikalanır);
        burada yalnız kimliği bağlanır. Özel anahtar ve parolası bu ekrana hiç gelmez.
      </p>
      <Field label="Anahtar kimliği (kid)" hint="Biçim: bayi-… (küçük harf, rakam, tire).">
        <input value={kid} spellCheck={false} autoComplete="off" onChange={(e) => setKid(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" disabled={!ok || write.pending} onClick={async () => (await write.run({ kid: kid.trim() })).ok && onDone()}>
          Bağla
        </Button>
      </ModalActions>
    </Modal>
  );
}
