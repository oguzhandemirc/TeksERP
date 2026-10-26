// Gelen kutusu: fabrikaya gönderilen sipariş/cari talepleri ve durumları. Süzme SUNUCUDA (`durum`); istemci süzmez.
// Bekleyen talep varken ekran kısa yoklama yapar (mesaj durumu değişim akışında sayılmaz); "gelen-kutusu" etiketi
// geçersizleşince de tazelenir.
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { errorMessage } from "../../../src/api/client";
import type { InboxItem, InboxStatus } from "../../../src/api/wire";
import { can } from "../../../src/lib/access";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { inboxPending } from "../../../src/ui/diger/inbox-format";
import { InboxRow } from "../../../src/ui/diger/InboxRow";
import { GroupNote } from "../../../src/ui/diger/parts";
import { useSettlePoll } from "../../../src/ui/diger/useSettlePoll";
import { Screen } from "../../../src/ui/Frame";
import { Banner, Button } from "../../../src/ui/kit";
import { ListGroup } from "../../../src/ui/ListRow";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { Empty, ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { space } from "../../../src/ui/tokens";

type Filter = "HEPSI" | InboxStatus;
const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: "BEKLIYOR", label: "Bekleyen" },
  { key: "ISLENDI", label: "İşlenen" },
  { key: "REDDEDILDI", label: "Reddedilen" },
  { key: "HEPSI", label: "Tümü" },
];
const EMPTY: Readonly<Record<Filter, string>> = {
  BEKLIYOR: "Bekleyen talep yok. Fabrikaya gönderdiğiniz sipariş ve cari talepleri işlenene kadar burada durur.",
  ISLENIYOR: "İşlenmekte olan talep yok.",
  ISLENDI: "Henüz işlenen talep yok.",
  REDDEDILDI: "Reddedilen talep yok.",
  IPTAL: "İptal edilen talep yok.",
  HEPSI: "Henüz talep gönderilmedi.",
};
const NOTE: Partial<Record<Filter, string>> = {
  BEKLIYOR: "Fabrika işleyince durum kendiliğinden güncellenir. 24 saati geçen talep turuncu saatle işaretlenir.",
  HEPSI: "İşleniyor ve iptal edilen talepler de burada.",
};

export default function Inbox() {
  const { api, permissions, offline } = useSession();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("BEKLIYOR");
  const durum = filter === "HEPSI" ? undefined : filter;
  const r = useRemote(`gelen-kutusu:${filter}`, () => api.inboxList({ durum, limit: 50 }), { tags: ["gelen-kutusu"] });
  // İlk sayfa `useRemote`ta (önbellek + etiket); "Daha fazla" sayfaları ilk sayfa tazelenince sıfırlanır.
  const [more, setMore] = useState<{ items: InboxItem[]; next: string | null } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  useEffect(() => {
    setMore(null);
    setMoreError(null);
  }, [r.data]);

  const items = [...(r.data?.kayitlar ?? []), ...(more?.items ?? [])];
  const next = more ? more.next : r.offline ? null : (r.data?.sonraki ?? null);
  useSettlePoll(items.some((m) => inboxPending(m.durum)), r.reload);

  async function loadMore(cursor: string) {
    setMoreBusy(true);
    setMoreError(null);
    try {
      const p = await api.inboxList({ durum, imlec: cursor, limit: 50 });
      setMore((o) => ({ items: [...(o?.items ?? []), ...p.kayitlar], next: p.sonraki }));
    } catch (err) {
      setMoreError(errorMessage(err));
    } finally {
      setMoreBusy(false);
    }
  }

  const admin = can(permissions, "bulut:hesap:yonet");
  return (
    <Screen module="gelen-kutusu" onRefresh={r.reload} refreshing={r.refreshing}>
      <View style={{ marginBottom: space.m }}>
        <SegmentedControl items={FILTERS} value={filter} onChange={setFilter} testIDPrefix="sekme-" accessibilityLabel="Talep durumu" />
      </View>
      {NOTE[filter] ? <GroupNote>{NOTE[filter]}</GroupNote> : null}
      {r.loading && !r.data ? <LoadingSkeleton rows={4} /> : null}
      {r.error && !r.data ? <ErrorState text={r.error} onRetry={r.reload} /> : null}
      {r.data && items.length === 0 ? <Empty domain="gelenKutusu" text={EMPTY[filter]} testID="gelen-bos" /> : null}
      {items.length > 0 ? (
        <ListGroup testID="gelen-liste" iconSize={40}>
          {items.map((m) => (
            <InboxRow key={m.mesajId} m={m} showAuthor={admin} onPress={() => router.push({ pathname: "/gelen-kutusu/[mesajId]", params: { mesajId: m.mesajId } } as never)} />
          ))}
        </ListGroup>
      ) : null}
      {moreError ? <Banner tone="error" text={moreError} /> : null}
      {next ? <Button label="Daha fazla" tone="plain" icon="chevron-down" busy={moreBusy} disabled={offline} onPress={() => void loadMore(next)} testID="gelen-daha" /> : null}
    </Screen>
  );
}
