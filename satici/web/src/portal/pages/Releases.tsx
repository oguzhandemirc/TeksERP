// SÜRÜMLER / KANALLAR / TERFİ — kanal başına: kiraya akan kayıtlı güncel sürümler · güncelleme sunucusunda
// YAYINDA olan (salt-okunur yayın kökü: latest.yml · OTA manifesti · APK künyesi) · yayın defteri TSV ·
// yayın betiklerinin imzalı bildirimleri. Yayın kökü okunamazsa "ölçülemedi" — boş liste "yayın yok" değildir.
// Bildirim kayıtlı sürümü DEĞİŞTİRMEZ; ayrışma burada görünür, kayıtlı sürümü Kanallar ekranı değiştirir.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "../../shared/attempt";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import { Badge, Button, ErrorText, Field, Modal, ModalActions, PageTitle, QueryState, Section, Table } from "../../shared/ui";
import { NOTICE_EVENT_LABEL, type ChannelRelease, type Publisher, type ReleaseOverview } from "../distribution/types";

export const ROOT_STATE_TEXT: Record<ReleaseOverview["yayinKoku"], string> = {
  OLCULDU: "Yayın kökü okundu",
  OKUNAMADI: "Yayın kökü OKUNAMADI — yayında olan ölçülemedi",
  BAGLI_DEGIL: "Yayın kökü bağlı değil — yayında olan ölçülemedi",
};

function published(c: ChannelRelease): string {
  if (!c.yayinda) return "ölçülemedi";
  const parts = [
    c.yayinda.panel?.surum ? `Panel ${c.yayinda.panel.surum}` : null,
    ...c.yayinda.tabletOta.map((o) => `OTA ${o.runtime}: ${o.surum ?? "?"}`),
    c.yayinda.tabletApk?.surum ? `APK ${c.yayinda.tabletApk.surum}${c.yayinda.tabletApk.vc ? ` (vc ${c.yayinda.tabletApk.vc})` : ""}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "yayın yok";
}

function registered(c: ChannelRelease): string {
  if (!c.kayitli) return "kanal kayıtlı değil";
  const v = c.kayitli.guncelSurumler;
  const parts = (["backend", "panel", "tablet"] as const).filter((k) => v[k]).map((k) => `${k} ${v[k]}`);
  return parts.length ? parts.join(" · ") : "—";
}

function lastNotice(c: ChannelRelease): string {
  const n = c.bildirimler[0];
  return n ? `${label(NOTICE_EVENT_LABEL, n.olay)} ${n.urun} ${n.surum} · ${fmtDateTime(n.olayZamani)}` : "—";
}

export function ReleasesPage() {
  const overview = useGet<ReleaseOverview>(["surumler"], "/surumler");
  const [open, setOpen] = useState<string | null>(null);
  const data = overview.data;
  const selected = data?.kanallar.find((c) => c.kod === open) ?? null;
  return (
    <>
      <PageTitle title="Sürümler" sub="Kanal başına kayıtlı güncel sürüm, yayında olan ve yayın/terfi bildirimleri." />
      <QueryState isLoading={overview.isLoading} error={overview.error} />
      {data ? (
        <Section title="Kanallar" actions={<Badge tone={data.yayinKoku === "OLCULDU" ? "ok" : "warn"}>{ROOT_STATE_TEXT[data.yayinKoku]}</Badge>}>
          <Table
            rows={data.kanallar}
            rowKey={(c) => c.kod}
            empty="Kanal yok"
            columns={[
              { header: "Kanal", render: (c) => `${c.kod}${c.kayitli ? ` (${c.kayitli.tur})` : ""}` },
              { header: "Kayıtlı (kiraya akan)", render: registered },
              { header: "Yayında", render: published },
              { header: "Son bildirim", render: lastNotice },
              { header: "", render: (c) => <Button variant="ghost" onClick={() => setOpen(open === c.kod ? null : c.kod)}>{open === c.kod ? "Kapat" : "Ayrıntı"}</Button> },
            ]}
          />
        </Section>
      ) : null}
      {selected ? <ChannelDetail channel={selected} /> : null}
      <PublishersSection />
    </>
  );
}

function ChannelDetail({ channel }: { channel: ChannelRelease }) {
  return (
    <>
      <Section title={`${channel.kod} — yayın defteri (son satırlar)`}>
        {channel.defter === null ? <p className="muted">Yayın defteri ölçülemedi (kök bağlı değil ya da dosya yok).</p> : null}
        <Table
          rows={channel.defter ?? []}
          rowKey={(r) => `${r.zaman}-${r.sha16}`}
          empty="Defter satırı yok"
          columns={[
            { header: "Zaman", render: (r) => r.zaman },
            { header: "Sürüm", render: (r) => r.surum },
            { header: "Yapan", render: (r) => r.yapan },
            { header: "Özet", render: (r) => r.sha16 },
            { header: "Not", render: (r) => r.not ?? "" },
          ]}
        />
      </Section>
      <Section title={`${channel.kod} — bildirimler`}>
        <Table
          rows={channel.bildirimler}
          rowKey={(n) => n.id}
          empty="Bildirim yok"
          columns={[
            { header: "Zaman", render: (n) => fmtDateTime(n.olayZamani) },
            { header: "Olay", render: (n) => label(NOTICE_EVENT_LABEL, n.olay) },
            { header: "Ürün", render: (n) => n.urun },
            { header: "Sürüm", render: (n) => n.surum },
            { header: "Yayıncı", render: (n) => n.yayinciKid },
          ]}
        />
      </Section>
    </>
  );
}

function PublishersSection() {
  const api = useApi();
  const canManage = useCan("yayinci:yonet");
  const canRegister = useCan("yayinci:anahtar");
  const queryClient = useQueryClient();
  const list = useGet<Publisher[]>(["yayincilar"], "/yayincilar");
  const [adding, setAdding] = useState(false);
  const [off, setOff] = useState<Publisher | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["yayincilar"] });
  return (
    <Section title="Yayıncı anahtarları" actions={canRegister ? <Button onClick={() => setAdding(true)}>Anahtar kaydet</Button> : null}>
      <p className="muted">Yayın betikleri bildirimi bu anahtarlardan biriyle imzalar (özel yarı yayıncının makinesinde: node scripts/lib/yayin-bildirim.mjs anahtar-uret).</p>
      <QueryState isLoading={list.isLoading} error={list.error} />
      <Table
        rows={list.data ?? []}
        rowKey={(p) => p.id}
        empty="Kayıtlı yayıncı yok"
        columns={[
          { header: "Kimlik", render: (p) => p.kid },
          { header: "Ad", render: (p) => p.ad },
          { header: "Durum", render: (p) => (p.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge tone="neutral">Pasif</Badge>) },
          { header: "Kaydedildi", render: (p) => fmtDateTime(p.createdAt) },
          { header: "", render: (p) => (canManage && p.aktif ? <Button variant="ghost" onClick={() => setOff(p)}>Pasife al</Button> : null) },
        ]}
      />
      {adding ? <PublisherModal onClose={() => setAdding(false)} onSaved={() => (setAdding(false), refresh())} /> : null}
      {off ? (
        <ConfirmAction
          title="Yayıncı anahtarını pasife al"
          description="Bu anahtarla imzalanan yeni bildirimler reddedilir; eski bildirim satırları kalır."
          targets={[`${off.kid} · ${off.ad}`]}
          confirmLabel="Pasife al"
          danger
          send={(body) => api.post(`/yayincilar/${off.id}/pasif`, body)}
          onDone={() => (setOff(null), refresh())}
          onClose={() => setOff(null)}
        />
      ) : null}
    </Section>
  );
}

function PublisherModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const [kid, setKid] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const write = useWrite<Publisher>((body) => api.post("/yayincilar", body));
  const valid = /^[a-z0-9][a-z0-9.-]{2,79}$/.test(kid) && name.trim() !== "" && /^[A-Za-z0-9_-]{43}$/.test(key.trim());
  const submit = async () => {
    const r = await write.run({ kid, ad: name.trim(), acikAnahtar: key.trim() });
    if (r.ok) onSaved();
  };
  return (
    <Modal title="Yayıncı anahtarı kaydet" onClose={onClose} busy={write.pending}>
      <Field label="Kimlik (kid)" hint="küçük harf/rakam/nokta/tire, ör. yayinci-mac-1">
        <input value={kid} onChange={(e) => setKid(e.target.value.trim())} />
      </Field>
      <Field label="Ad">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Açık anahtar (base64url, 43 karakter)">
        <input value={key} onChange={(e) => setKey(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || !valid}>
          Kaydet
        </Button>
      </ModalActions>
    </Modal>
  );
}
