// BAYİLER — hesap + TAVAN (sürümlü defter) + bayi anahtarı. Bayi kök anahtara erişmez: kendi
// parolalı anahtarıyla, tavan içinde imzalar; satıcı tavanı her an daraltır ya da bayiyi pasife alır.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "../../shared/attempt";
import { CeilingFields, ceilingBody, ceilingDraftOf, ceilingDraftValid, ceilingSummary, type CeilingDraft } from "../../shared/CeilingFields";
import { fmtDate } from "../../shared/format";
import { useChannels, useGet } from "../../shared/hooks";
import { useApi, useCan } from "../../shared/session";
import type { Catalog, Dealer } from "../../shared/types";
import { Badge, Button, ErrorText, Field, Modal, ModalActions, PageTitle, QueryState, Section, Table } from "../../shared/ui";

export function DealersPage() {
  const canManage = useCan("bayi:yonet");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useGet<Dealer[]>(["bayiler"], "/bayiler");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageTitle title="Bayiler" sub="Bayi yalnız kendi müşterilerini görür ve tavan içinde lisans üretir." actions={canManage ? <Button variant="primary" onClick={() => setCreating(true)}>Yeni bayi</Button> : null} />
      <Section title="Liste">
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { header: "Bayi", render: (r) => <Link to={`/bayiler/${r.id}`}>{r.ad}</Link> },
            { header: "Tavan", render: (r) => ceilingSummary(r.tavan) },
            { header: "Kullanım", render: (r) => `${r.kullanim} / ${r.tavan?.kurulumAdedi ?? 0}`, className: "num-col" },
            { header: "Anahtar", render: (r) => (r.anahtarKid ? <code>{r.anahtarKid}</code> : <Badge tone="warn">Bağlı değil</Badge>) },
            { header: "Durum", render: (r) => (r.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge>Pasif</Badge>) },
            { header: "Kayıt", render: (r) => fmtDate(r.createdAt) },
          ]}
        />
      </Section>
      {creating ? (
        <DealerCreateModal
          onClose={() => setCreating(false)}
          onSaved={(d) => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ["bayiler"] });
            navigate(`/bayiler/${d.id}`);
          }}
        />
      ) : null}
    </>
  );
}

function DealerCreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: (d: Dealer) => void }) {
  const api = useApi();
  const catalog = useGet<Catalog>(["katalog"], "/katalog");
  const channels = useChannels();
  const [name, setName] = useState("");
  const [taxNo, setTaxNo] = useState("");
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<CeilingDraft>(ceilingDraftOf(null));
  const write = useWrite<Dealer>((b) => api.post("/bayiler", b));
  const ok = name.trim() !== "" && reason.trim() !== "" && ceilingDraftValid(draft) && !channels.isLoading;
  const submit = async () => {
    const r = await write.run({ ad: name.trim(), vergiNo: taxNo.trim() || null, tavan: ceilingBody(draft), sebep: reason.trim() });
    if (r.ok) onSaved(r.data);
  };
  return (
    <Modal title="Yeni bayi" onClose={onClose} busy={write.pending} wide>
      <Field label="Bayi adı">
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Vergi no (isteğe bağlı)">
        <input value={taxNo} maxLength={20} onChange={(e) => setTaxNo(e.target.value)} />
      </Field>
      {catalog.data ? (
        <CeilingFields draft={draft} onChange={setDraft} modules={catalog.data.moduller} classes={catalog.data.siniflar} channels={channels.channels} />
      ) : (
        <QueryState isLoading={catalog.isLoading} error={catalog.error} />
      )}
      <Field label="Sebep (zorunlu, tavan defterine yazılır)">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <p className="muted small">Bayi hesabı açıldıktan sonra bayinin imza anahtarı çevrimdışı üretilip (kök parolasıyla sertifikalanır) bayiye bağlanır.</p>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={!ok || write.pending || !catalog.data}>
          Oluştur
        </Button>
      </ModalActions>
    </Modal>
  );
}
