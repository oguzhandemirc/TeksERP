// Mesaj ayrıntısı + iptal (yalnız yazar, yalnız BEKLIYOR; iki adımlı onay). Fabrika işlemeye başladıysa sunucu 409
// döner ve ekran taze durumu gösterir. Durum kesinleşene kadar ekran kısa yoklama yapar (değişim akışı saymaz).
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { errorMessage } from "../../../src/api/client";
import { formatAgo, formatDateTime } from "../../../src/lib/format";
import { canCancel, resultText } from "../../../src/lib/inbox";
import { inboxKind } from "../../../src/lib/labels/diger";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { Fields } from "../../../src/ui/data";
import { inboxBody, inboxOverdue, inboxPending } from "../../../src/ui/diger/inbox-format";
import { GroupCaption, GroupNote } from "../../../src/ui/diger/parts";
import { useSettlePoll } from "../../../src/ui/diger/useSettlePoll";
import { Screen } from "../../../src/ui/Frame";
import { IconChip } from "../../../src/ui/IconChip";
import { Banner, Card, ConfirmButton } from "../../../src/ui/kit";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { StatusBadge } from "../../../src/ui/StatusBadge";
import { ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";

export default function InboxDetail() {
  const { mesajId } = useLocalSearchParams<{ mesajId: string }>();
  const { api, facility, permissions, offline } = useSession();
  const r = useRemote(mesajId ? `mesaj:${mesajId}` : null, () => api.inboxGet(String(mesajId)), { tags: ["gelen-kutusu"] });
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = r.data;
  const me = { ad: facility?.hesap.ad ?? "", admin: permissions.includes("bulut:hesap:yonet") };
  useSettlePoll(!!m && inboxPending(m.durum), r.reload);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.inboxCancel(String(mesajId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      r.reload();
    }
  }

  const kind = m ? inboxKind(m.tur) : null;
  const body = m ? inboxBody(m) : null;
  const result = m ? resultText(m.sonuc) : null;
  return (
    <Screen title={kind?.ad ?? "Talep"} module="gelen-kutusu" back onRefresh={r.reload} refreshing={r.refreshing}>
      {r.loading && !m ? <LoadingSkeleton rows={3} /> : null}
      {r.error && !m ? <ErrorState text={r.error} onRetry={r.reload} /> : null}
      {m && kind ? (
        <>
          <Card domain={kind.domain}>
            <View style={s.head}>
              <IconChip domain={kind.domain} icon={kind.icon} size={48} />
              <View style={s.flex}>
                <Text style={s.title}>{kind.ad}</Text>
                <Text style={s.sub}>{`${m.hesapAdi} · ${formatAgo(m.olusturulma)}`}</Text>
              </View>
              <StatusBadge value={m.durum} />
            </View>
          </Card>
          {m.durum === "ISLENDI" && result ? <Banner tone="off" icon="checkmark-circle" text={result} testID="mesaj-sonuc" /> : null}
          {m.durum === "REDDEDILDI" ? <Banner tone="error" text={result ? `Fabrika reddetti: ${result}` : "Fabrika bu talebi reddetti."} testID="mesaj-ret" /> : null}
          {m.durum !== "ISLENDI" && m.durum !== "REDDEDILDI" && result ? <Banner tone="off" text={result} /> : null}
          {inboxOverdue(m) ? <Banner tone="warn" icon="time-outline" text="Bu talep 24 saattir bekliyor. Fabrikanın bağlı ve eşitlemenin çalıştığını kontrol edin." /> : null}

          <GroupCaption>Zaman çizelgesi</GroupCaption>
          <ListGroup>
            <ListRow title="Gönderildi" icon="paper-plane-outline" domain="gelenKutusu" value={formatDateTime(m.olusturulma)} />
            {m.islenme ? <ListRow title={m.durum === "REDDEDILDI" ? "Yanıtlandı" : "İşlendi"} icon="checkmark-done-outline" domain="gelenKutusu" value={formatDateTime(m.islenme)} /> : null}
            {m.iptal ? <ListRow title="İptal edildi" icon="close-circle-outline" domain="genel" value={formatDateTime(m.iptal)} /> : null}
          </ListGroup>

          <GroupCaption>İçerik</GroupCaption>
          {body ? (
            <>
              {body.rows.length > 0 ? (
                <ListGroup testID="mesaj-icerik">
                  {body.rows.map((row) => (
                    <View key={row.label} style={s.kv}>
                      <Text style={s.k}>{row.label}</Text>
                      <Text style={s.v} selectable>{row.value}</Text>
                    </View>
                  ))}
                </ListGroup>
              ) : null}
              {body.lines.length > 0 ? (
                <>
                  <GroupCaption>{`Kalemler (${body.lines.length})`}</GroupCaption>
                  <ListGroup testID="mesaj-kalemler">
                    {body.lines.map((l, i) => (
                      <ListRow key={i} title={l.title} subtitle={l.detail || undefined} value={l.amount} icon="pricetag-outline" domain="siparisler" />
                    ))}
                  </ListGroup>
                  <GroupNote>Ürün ve cari adları fabrika talebi işleyince sipariş kaydında görünür.</GroupNote>
                </>
              ) : null}
            </>
          ) : (
            <Card><Fields value={m.govde} /></Card>
          )}

          {error ? <Banner tone="error" text={error} /> : null}
          {canCancel(m, me) ? (
            <View style={s.cancel}>
              <ConfirmButton label="İsteği iptal et" question="Bu istek fabrikaya iletilmeden iptal edilsin mi?" busy={busy} disabled={offline} onConfirm={() => void cancel()} testID="mesaj-iptal" />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m },
  flex: { flex: 1, minWidth: 0 },
  title: { ...typography.title3, color: t.text },
  sub: { ...typography.subhead, color: t.textSecondary, marginTop: 2 },
  kv: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m, minHeight: 48, alignItems: "center" as const },
  k: { ...typography.subhead, color: t.textSecondary },
  v: { ...typography.callout, color: t.text, flexShrink: 1, textAlign: "right" as const },
  cancel: { marginTop: space.l },
}));
