// BİLDİRİMLER — satıcı olaylarının (destek · kopya şüphesi · taşıma · DR · sessiz kurulum · yaklaşan vade · planlı
// eylem) e-posta + Telegram iletim kaydı. Gönderimi çıkışı olan yan konteyner yapar; satıcı dışarı bağlanmaz ve kanal
// sırlarını görmez — kanal durumu satırların SONUCUNDAN türer (sunucu). Deneme bildirimi yalnız `bildirim:yonet`.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "../../shared/attempt";
import { fmtDateTime } from "../../shared/format";
import { useGet, usePaged } from "../../shared/hooks";
import { CHANNEL_HEALTH_LABEL, CLASS_LABEL, NOTIFICATION_CHANNEL_LABEL, NOTIFICATION_EVENT_LABEL, NOTIFICATION_STATUS_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import type { ChannelOverview, NotificationBody, NotificationOverview, NotificationRow } from "../../shared/types";
import { Badge, Button, ErrorText, KeyValues, LoadMore, PageTitle, QueryState, Section, Table } from "../../shared/ui";

const HEALTH_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  CALISIYOR: "ok",
  HATA: "danger",
  YAPILANDIRILMAMIS: "warn",
  GONDERICI_YANITSIZ: "danger",
  BILINMIYOR: "neutral",
};

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  BEKLIYOR: "info",
  GONDERILIYOR: "info",
  GONDERILDI: "ok",
  HATA: "danger",
  KAPALI: "warn",
};

export function whereOf(b: NotificationBody): string {
  const parts = [b.musteri, b.tesis, b.kurulum].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(" › ") : "—";
}

function ChannelCard({ c }: { c: ChannelOverview }) {
  return (
    <div className="card">
      <h3>
        {label(NOTIFICATION_CHANNEL_LABEL, c.kanal)} <Badge tone={HEALTH_TONE[c.durum] ?? "neutral"}>{label(CHANNEL_HEALTH_LABEL, c.durum)}</Badge>
      </h3>
      <KeyValues
        items={[
          ["Son başarılı gönderim", fmtDateTime(c.sonGonderim)],
          ["Son sonuç", c.sonSonuc ? `${label(NOTIFICATION_STATUS_LABEL, c.sonSonuc.durum)}${c.sonSonuc.kod ? ` · ${c.sonSonuc.kod}` : ""} · ${fmtDateTime(c.sonSonuc.zaman)}` : "—"],
          ["Bekleyen", String(c.bekleyen)],
          ["Vadesi geçmiş bekleyen", String(c.geciken)],
        ]}
      />
    </div>
  );
}

function Overview({ data }: { data: NotificationOverview }) {
  const e = data.esikler;
  return (
    <>
      <div className="cards">
        {data.kanallar.map((c) => (
          <ChannelCard key={c.kanal} c={c} />
        ))}
      </div>
      <KeyValues
        items={[
          ["Sessizlik eşiği", `${e.sessizSaat} saat başarılı yoklama yok`],
          ["Vade ufku", `${e.vadeGun} gün (kira · geçerlilik · taksit)`],
          ["Tarama aralığı", `${e.taramaDk} dk`],
          ["Sessizlik sınıfları", e.sessizSiniflar.map((x) => label(CLASS_LABEL, x)).join(", ")],
        ]}
      />
    </>
  );
}

function TestButton() {
  const api = useApi();
  const queryClient = useQueryClient();
  const write = useWrite<{ yazilan: number }>((b) => api.post("/bildirimler/deneme", b));
  const [done, setDone] = useState<number | null>(null);
  const send = async () => {
    setDone(null);
    const r = await write.run({});
    if (!r.ok) return;
    setDone(r.data.yazilan);
    void queryClient.invalidateQueries({ queryKey: ["bildirimler"] });
  };
  return (
    <span className="section-actions">
      {done !== null ? <span className="muted">Giden kutusuna {done} satır yazıldı — sonucu listede izleyin</span> : null}
      <ErrorText error={write.error} />
      <Button variant="primary" onClick={() => void send()} disabled={write.pending}>
        Deneme bildirimi gönder
      </Button>
    </span>
  );
}

function Filter({ value, onChange, options, name }: { value: string; onChange: (v: string) => void; options: Record<string, string>; name: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={name}>
      <option value="">{`${name}: tümü`}</option>
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

export function NotificationsPage() {
  const canManage = useCan("bildirim:yonet");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [event, setEvent] = useState("");
  const overview = useGet<NotificationOverview>(["bildirimler", "durum"], "/bildirimler/durum");
  const list = usePaged<NotificationRow>(["bildirimler"], "/bildirimler", { durum: status || undefined, kanal: channel || undefined, olay: event || undefined });
  return (
    <>
      <PageTitle
        title="Bildirimler"
        sub="Destek talebi, kopya şüphesi, taşıma, DR devri, ses vermeyen kurulum ve yaklaşan vadeler e-posta + Telegram grubuna gider. Kanal ayarları (Telegram belirteci, Resend anahtarı, alıcı) satıcıda değil bildirim yan konteynerindedir; burada yalnız sonuçlar görünür."
        actions={canManage ? <TestButton /> : undefined}
      />
      <Section title="Kanallar">
        <QueryState isLoading={overview.isLoading} error={overview.error} />
        {overview.data ? <Overview data={overview.data} /> : null}
      </Section>
      <Section title="Son bildirimler">
        <div className="toolbar">
          <Filter value={status} onChange={setStatus} options={NOTIFICATION_STATUS_LABEL} name="Durum" />
          <Filter value={channel} onChange={setChannel} options={NOTIFICATION_CHANNEL_LABEL} name="Kanal" />
          <Filter value={event} onChange={setEvent} options={NOTIFICATION_EVENT_LABEL} name="Olay" />
        </div>
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          empty="Bildirim yok"
          columns={[
            { header: "Zaman", render: (r) => fmtDateTime(r.createdAt) },
            { header: "Olay", render: (r) => label(NOTIFICATION_EVENT_LABEL, r.olay) },
            { header: "Kanal", render: (r) => label(NOTIFICATION_CHANNEL_LABEL, r.kanal) },
            { header: "Fabrika", render: (r) => whereOf(r.govde) },
            { header: "Ayrıntı", render: (r) => r.govde.konu ?? r.govde.referans ?? "—" },
            { header: "Durum", render: (r) => <Badge tone={STATUS_TONE[r.durum] ?? "neutral"}>{`${label(NOTIFICATION_STATUS_LABEL, r.durum)}${r.deneme > 1 ? ` · ${r.deneme}. deneme` : ""}`}</Badge> },
            { header: "Son hata", render: (r) => (r.sonHata ? <code>{r.sonHata}</code> : "—") },
            { header: "Gönderim", render: (r) => fmtDateTime(r.gonderimZamani) },
            { header: "", render: (r) => <Link to={r.govde.portalYolu}>Aç</Link> },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
    </>
  );
}
