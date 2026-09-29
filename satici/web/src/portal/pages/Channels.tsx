// KANALLAR — dağıtım kanalı ana verisi (kod · ad · tür · güncel sürümler). Kurulum kanala bağlıdır
// ve bayi tavanı kanal listesi taşır; `kod` kimliktir, açıldıktan sonra DEĞİŞMEZ (indirme yolunun
// öneki). Güncel sürümler kiraya gider; fabrika bir sonraki yoklamada görür. Yazma yalnız yönetici.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "../../shared/attempt";
import { fmtDate } from "../../shared/format";
import { useChannels } from "../../shared/hooks";
import { useApi, useCan } from "../../shared/session";
import type { Channel, ChannelKind, ChannelVersions } from "../../shared/types";
import { Badge, Button, ErrorText, Field, Modal, ModalActions, PageTitle, QueryState, Section, Table } from "../../shared/ui";

/** Sunucunun `ChannelCodeSchema`sı (lisans-protokol/belgeler.ts) — ayna bekçisi: mirrors.test.ts. */
export const CHANNEL_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Sunucunun `VersionTextSchema`sı (X.Y.Z, isteğe bağlı ön sürüm eki). */
export const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,6}([-+][0-9A-Za-z.-]{1,40})?$/;

export const CHANNEL_KIND_LABEL: Record<ChannelKind, string> = { uretim: "Üretim", hazirlik: "Hazırlık" };
const PRODUCTS = [
  ["backend", "Backend"],
  ["panel", "Panel"],
  ["tablet", "Tablet"],
] as const;

function versionsSummary(v: ChannelVersions): string {
  const parts = PRODUCTS.filter(([k]) => v[k]).map(([k, l]) => `${l} ${v[k]}`);
  return parts.length ? parts.join(" · ") : "—";
}

type Dialog = { kind: "create" } | { kind: "edit"; channel: Channel } | null;

export function ChannelsPage() {
  const canManage = useCan("kanal:yonet");
  const queryClient = useQueryClient();
  const list = useChannels();
  const [dialog, setDialog] = useState<Dialog>(null);
  const done = () => {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ["kanallar"] });
  };
  return (
    <>
      <PageTitle
        title="Kanallar"
        sub="Kurulum yalnız kayıtlı kanalda açılır; bayi yalnız tavanındaki kanallarda kurulum açar."
        actions={canManage ? <Button variant="primary" onClick={() => setDialog({ kind: "create" })}>Yeni kanal</Button> : null}
      />
      <Section title="Liste">
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.channels}
          rowKey={(r) => r.id}
          empty="Kanal yok — kurulum açmak için önce kanal açın"
          columns={[
            { header: "Kod", render: (r) => <code>{r.kod}</code> },
            { header: "Ad", render: (r) => r.ad },
            { header: "Tür", render: (r) => <Badge tone={r.tur === "uretim" ? "info" : "neutral"}>{CHANNEL_KIND_LABEL[r.tur] ?? r.tur}</Badge> },
            { header: "Güncel sürümler", render: (r) => versionsSummary(r.guncelSurumler) },
            { header: "Kurulum", render: (r) => r.kurulumSayisi, className: "num-col" },
            { header: "Kayıt", render: (r) => fmtDate(r.createdAt) },
            { header: "", render: (r) => (canManage ? <Button variant="ghost" onClick={() => setDialog({ kind: "edit", channel: r })}>Düzenle</Button> : null) },
          ]}
        />
      </Section>
      {dialog ? <ChannelModal channel={dialog.kind === "edit" ? dialog.channel : undefined} onClose={() => setDialog(null)} onDone={done} /> : null}
    </>
  );
}

function ChannelModal({ channel, onClose, onDone }: { channel?: Channel; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [code, setCode] = useState(channel?.kod ?? "");
  const [name, setName] = useState(channel?.ad ?? "");
  const [kind, setKind] = useState<ChannelKind>(channel?.tur ?? "uretim");
  const [versions, setVersions] = useState<Record<(typeof PRODUCTS)[number][0], string>>({
    backend: channel?.guncelSurumler.backend ?? "",
    panel: channel?.guncelSurumler.panel ?? "",
    tablet: channel?.guncelSurumler.tablet ?? "",
  });
  const write = useWrite<Channel>((b) => (channel ? api.patch(`/kanallar/${channel.id}`, b) : api.post("/kanallar", b)));
  const codeOk = channel !== undefined || CHANNEL_CODE_PATTERN.test(code.trim());
  const versionsOk = PRODUCTS.every(([k]) => versions[k].trim() === "" || VERSION_PATTERN.test(versions[k].trim()));
  const ok = codeOk && name.trim() !== "" && versionsOk;
  const submit = async () => {
    // Boş bırakılan ürün anahtarı gönderilmez: kira o ürün için sürüm bildirmez.
    const guncelSurumler = Object.fromEntries(PRODUCTS.filter(([k]) => versions[k].trim()).map(([k]) => [k, versions[k].trim()]));
    const body: Record<string, unknown> = { ad: name.trim(), tur: kind, guncelSurumler };
    if (!channel) body.kod = code.trim();
    if ((await write.run(body)).ok) onDone();
  };
  return (
    <Modal title={channel ? `Kanal: ${channel.kod}` : "Yeni kanal"} onClose={onClose} busy={write.pending}>
      {channel ? (
        <p className="muted">Kanal kodu değişmez (indirme yolunun öneki ve kurulumların bağı).</p>
      ) : (
        <Field label="Kod" hint="Küçük harf, rakam, tire; en çok 40 karakter (ör. adnansahin, testfabrika). Sonradan değişmez.">
          <input value={code} maxLength={40} spellCheck={false} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
        </Field>
      )}
      {!codeOk && code.trim() ? <p className="error">Kod yalnız küçük harf, rakam ve tire içerebilir; harf ya da rakamla başlar.</p> : null}
      <Field label="Ad">
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Tür">
        <select value={kind} onChange={(e) => setKind(e.target.value as ChannelKind)}>
          {(Object.keys(CHANNEL_KIND_LABEL) as ChannelKind[]).map((k) => (
            <option key={k} value={k}>
              {CHANNEL_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <div className="field">
        <span className="field-label">Güncel sürümler (kiraya gider; boş = bildirilmez)</span>
        <div className="toolbar">
          {PRODUCTS.map(([k, l]) => (
            <Field key={k} label={l}>
              <input value={versions[k]} placeholder="X.Y.Z" maxLength={60} spellCheck={false} onChange={(e) => setVersions({ ...versions, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </div>
      {!versionsOk ? <p className="error">Sürüm X.Y.Z biçiminde olmalı (ör. 2.11.2).</p> : null}
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={!ok || write.pending}>
          Kaydet
        </Button>
      </ModalActions>
    </Modal>
  );
}
