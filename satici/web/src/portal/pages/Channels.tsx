// GÜNCELLEME GRUPLARI (eski adıyla kanal) — satıcının `kanal` satırı: test · oncu · genel, terfi sırasıyla.
// Gruplar migration'la doğar, portaldan AÇILMAZ; kod ve tür değişmez. Düzenlenen: ad · sıra · güncel sürümler
// (kiraya gider; fabrika bir sonraki yoklamada görür). Grup olmayan eski satır EMEKLİdir: yeni kurulum almaz,
// indirme belirteci basmaz, kirası sürer. Yazma yalnız yönetici (kanal:yonet).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "../../shared/attempt";
import { fmtDate } from "../../shared/format";
import { useChannels } from "../../shared/hooks";
import { useApi, useCan } from "../../shared/session";
import type { Channel, ChannelVersions } from "../../shared/types";
import { groupName } from "../../shared/update-groups";
import { Badge, Button, ErrorText, Field, Modal, ModalActions, PageTitle, QueryState, Section, Table } from "../../shared/ui";

/** Sunucunun `VersionTextSchema`sı (X.Y.Z, isteğe bağlı ön sürüm eki). */
export const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,6}([-+][0-9A-Za-z.-]{1,40})?$/;
/** Sunucunun `cleanOrder` sınırı (1–99 tam sayı; boş = sırasız). */
export const ORDER_MIN = 1;
export const ORDER_MAX = 99;

const PRODUCTS = [
  ["backend", "Backend"],
  ["panel", "Panel"],
  ["tablet", "Tablet"],
] as const;

function versionsSummary(v: ChannelVersions): string {
  const parts = PRODUCTS.filter(([k]) => v[k]).map(([k, l]) => `${l} ${v[k]}`);
  return parts.length ? parts.join(" · ") : "—";
}

export function ChannelsPage() {
  const canManage = useCan("kanal:yonet");
  const queryClient = useQueryClient();
  const list = useChannels();
  const [editing, setEditing] = useState<Channel | null>(null);
  const done = () => {
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: ["kanallar"] });
  };
  return (
    <>
      <PageTitle
        title="Güncelleme grupları"
        sub="Kurulum bir güncelleme grubuna bağlıdır (test → öncü → genel); grup açılmaz, yalnız adı, sırası ve güncel sürümleri düzenlenir. Emekli kanal yeni kurulum almaz ve indirme bağlantısı vermez."
      />
      <Section title="Liste">
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.channels}
          rowKey={(r) => r.id}
          empty="Güncelleme grubu yok (satıcı sunucusu migration'ı uygulanmamış)"
          columns={[
            { header: "Sıra", render: (r) => r.sira ?? "—", className: "num-col" },
            { header: "Grup", render: (r) => <code>{r.kod}</code> },
            { header: "Ad", render: (r) => r.ad },
            { header: "Durum", render: (r) => (r.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge tone="warn">Emekli</Badge>) },
            { header: "Güncel sürümler", render: (r) => versionsSummary(r.guncelSurumler) },
            { header: "Kurulum", render: (r) => r.kurulumSayisi, className: "num-col" },
            { header: "Kayıt", render: (r) => fmtDate(r.createdAt) },
            { header: "", render: (r) => (canManage ? <Button variant="ghost" onClick={() => setEditing(r)}>Düzenle</Button> : null) },
          ]}
        />
      </Section>
      {editing ? <ChannelModal channel={editing} onClose={() => setEditing(null)} onDone={done} /> : null}
    </>
  );
}

function ChannelModal({ channel, onClose, onDone }: { channel: Channel; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [name, setName] = useState(channel.ad);
  const [order, setOrder] = useState(channel.sira === null ? "" : String(channel.sira));
  const [versions, setVersions] = useState<Record<(typeof PRODUCTS)[number][0], string>>({
    backend: channel.guncelSurumler.backend ?? "",
    panel: channel.guncelSurumler.panel ?? "",
    tablet: channel.guncelSurumler.tablet ?? "",
  });
  const write = useWrite<Channel>((b) => api.patch(`/kanallar/${channel.id}`, b));
  const orderNum = order.trim() === "" ? null : Number(order.trim());
  const orderOk = orderNum === null || (Number.isInteger(orderNum) && orderNum >= ORDER_MIN && orderNum <= ORDER_MAX);
  const versionsOk = PRODUCTS.every(([k]) => versions[k].trim() === "" || VERSION_PATTERN.test(versions[k].trim()));
  const ok = name.trim() !== "" && orderOk && versionsOk;
  const submit = async () => {
    // Boş bırakılan ürün anahtarı gönderilmez: kira o ürün için sürüm bildirmez.
    const guncelSurumler = Object.fromEntries(PRODUCTS.filter(([k]) => versions[k].trim()).map(([k]) => [k, versions[k].trim()]));
    if ((await write.run({ ad: name.trim(), sira: orderNum, guncelSurumler })).ok) onDone();
  };
  return (
    <Modal title={`Güncelleme grubu: ${groupName(channel.kod)}`} onClose={onClose} busy={write.pending}>
      <p className="muted">
        Grup kodu ve türü değişmez (indirme yolunun öneki ve kurulumların bağı).{channel.aktif ? "" : " Bu kanal emeklidir: yeni kurulum almaz, indirme bağlantısı vermez."}
      </p>
      <Field label="Ad">
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Sıra" hint={`Terfi zincirindeki yeri (${ORDER_MIN}–${ORDER_MAX}); boş = sırasız.`}>
        <input type="number" min={ORDER_MIN} max={ORDER_MAX} value={order} onChange={(e) => setOrder(e.target.value)} />
      </Field>
      {!orderOk ? <p className="error">Sıra {ORDER_MIN}–{ORDER_MAX} arası tam sayı olmalı.</p> : null}
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
