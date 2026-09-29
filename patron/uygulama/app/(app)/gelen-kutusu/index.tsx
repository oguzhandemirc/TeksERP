// Gelen kutusu: fabrikaya gönderilen sipariş/cari istekleri ve durumları (sunucu süzer).
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../../src/api/client";
import { INBOX_STATUSES, type InboxEntry, type InboxStatus } from "../../../src/api/wire";
import { formatDateTime, statusLabel } from "../../../src/lib/format";
import { INBOX_KIND_LABEL } from "../../../src/lib/inbox";
import { useSession } from "../../../src/state/session";
import { ErrorBox } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Badge, Body, Button, Card, Loading, Muted, Tabs } from "../../../src/ui/kit";

type Filter = "HEPSI" | InboxStatus;
const FILTERS: readonly { key: Filter; label: string }[] = [{ key: "HEPSI", label: "Tümü" }, ...INBOX_STATUSES.map((s) => ({ key: s, label: statusLabel(s) }))];

export default function Inbox() {
  const { api, cache, markOnline } = useSession();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("HEPSI");
  const [items, setItems] = useState<InboxEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (cursor: string | null) => {
    if (!cache) return;
    setLoading(true);
    setError(null);
    const durum = filter === "HEPSI" ? undefined : filter;
    try {
      const fetch = () => api.inboxList({ durum, imlec: cursor ?? undefined, limit: 50 });
      const r = cursor ? { data: await fetch(), offline: false, savedAt: "" } : await cache.load(`gelen-kutusu:${filter}`, fetch);
      if (!cursor) markOnline(!r.offline, r.savedAt);
      setItems((o) => (cursor ? [...o, ...r.data.kayitlar] : [...r.data.kayitlar]));
      setNext(r.offline ? null : r.data.sonraki);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, cache, filter, markOnline]);

  useEffect(() => void load(null), [load]);

  return (
    <Screen title="Gelen kutusu" module="gelen-kutusu">
      <Tabs items={FILTERS} value={filter} onChange={setFilter} />
      {error ? <ErrorBox text={error} onRetry={() => void load(null)} /> : null}
      {items.map((m) => (
        <Card key={m.mesajId} testID={`mesaj-${m.mesajId}`} onPress={() => router.push({ pathname: "/gelen-kutusu/[mesajId]", params: { mesajId: m.mesajId } } as never)}>
          <Body>{`${INBOX_KIND_LABEL[m.tur] ?? m.tur} · ${formatDateTime(m.olusturulma)}`}</Body>
          <Muted>{m.hesapAdi}</Muted>
          <Badge status={m.durum} />
        </Card>
      ))}
      {!loading && !error && items.length === 0 ? <Muted>Mesaj yok</Muted> : null}
      {loading ? <Loading /> : next ? <Button label="Daha fazla" tone="plain" onPress={() => void load(next)} /> : null}
    </Screen>
  );
}
