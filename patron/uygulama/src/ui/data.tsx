// Jenerik veri görünümleri: kayıt alanları, anlık özet, imleçli liste. Şekil fabrikadan gelir.
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { errorMessage } from "../api/client";
import type { ProjectionRecord } from "../api/wire";
import { formatAgo, syncIsLate } from "../lib/format";
import { nestedEntries, recordTitle, scalarEntries } from "../lib/present";
import { useSession } from "../state/session";
import { Banner, Body, Button, Card, Loading, Muted, Row, Stat, Title } from "./kit";
import { space } from "./theme";

export function Fields({ value }: { value: unknown }) {
  const rows = scalarEntries(value);
  if (rows.length === 0) return <Muted>Gösterilecek alan yok</Muted>;
  return (
    <View>
      {rows.map((r) => (
        <View key={r.key} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: space.xs, gap: space.m }}>
          <Muted>{r.label}</Muted>
          <Text style={{ fontSize: 16, flexShrink: 1, textAlign: "right" }}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** Anlık özet: üst düzey sayılar kutucuk, iç nesneler bölüm, diziler ilk 20 satır. */
export function SnapshotView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (Array.isArray(value)) {
    return (
      <View>
        {value.slice(0, 20).map((item, i) => (
          <Card key={i}>
            <Body>{recordTitle(item)}</Body>
            <Fields value={item} />
          </Card>
        ))}
        {value.length > 20 ? <Muted>{`+${value.length - 20} satır daha`}</Muted> : null}
      </View>
    );
  }
  const stats = scalarEntries(value);
  return (
    <View>
      {stats.length > 0 ? <Row>{stats.map((s) => <Stat key={s.key} label={s.label} value={s.value} />)}</Row> : null}
      {depth < 3
        ? nestedEntries(value).map((n) => (
            <View key={n.key} style={{ marginTop: space.m }}>
              <Text style={{ fontSize: 17, fontWeight: "600", marginBottom: space.s }}>{n.label}</Text>
              <SnapshotView value={n.value} depth={depth + 1} />
            </View>
          ))
        : null}
    </View>
  );
}

/** Ekran üstü şerit: çevrimdışı (son veri) ve eşitleme gecikmesi. */
export function StatusBands() {
  const { offline, offlineSince, facility } = useSession();
  const last = facility?.esitleme?.sonEsitleme ?? null;
  return (
    <View>
      {offline ? <Banner tone="off" testID="bant-cevrimdisi" text={`Çevrimdışı — son veri ${offlineSince ? formatAgo(offlineSince) : "bilinmiyor"}. Değişiklik yapılamaz.`} /> : null}
      {facility && syncIsLate(last) ? (
        <Banner tone="warn" testID="bant-gecikme" text={last ? `Fabrikadan eşitleme gecikti — son eşitleme ${formatAgo(last)}` : "Fabrikadan henüz veri gelmedi"} />
      ) : null}
    </View>
  );
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <View>
      <Banner tone="error" text={text} />
      {onRetry ? <Button label="Tekrar dene" tone="plain" onPress={onRetry} /> : null}
    </View>
  );
}

/** İmleçli projeksiyon listesi (sunucu süzer; "Daha fazla" sonraki sayfayı ekler). */
export function ProjectionList(p: { projection: string; filter?: { durum?: string; cariKartId?: string }; onOpen?: (r: ProjectionRecord) => void; empty?: string }) {
  const { api, cache, markOnline } = useSession();
  const [items, setItems] = useState<ProjectionRecord[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const durum = p.filter?.durum;
  const cariKartId = p.filter?.cariKartId;
  const key = `liste:${p.projection}:${durum ?? ""}:${cariKartId ?? ""}`;

  const load = useCallback(
    async (cursor: string | null) => {
      if (!cache) return;
      setLoading(true);
      setError(null);
      try {
        const fetch = () => api.list(p.projection, { imlec: cursor ?? undefined, limit: 50, durum, cariKartId });
        const r = cursor ? { data: await fetch(), offline: false, savedAt: "" } : await cache.load(key, fetch);
        if (!cursor) markOnline(!r.offline, r.savedAt);
        setItems((old) => (cursor ? [...old, ...r.data.kayitlar] : [...r.data.kayitlar]));
        setNext(r.offline ? null : r.data.sonraki);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [api, cache, key, markOnline, durum, cariKartId, p.projection],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <View>
      {error ? <ErrorBox text={error} onRetry={() => void load(null)} /> : null}
      {items.map((r) => (
        <Card key={r.id} onPress={p.onOpen ? () => p.onOpen?.(r) : undefined} testID={`kayit-${r.id}`}>
          <Title>{recordTitle(r.kayit)}</Title>
          <Fields value={r.kayit} />
        </Card>
      ))}
      {!loading && !error && items.length === 0 ? <Muted>{p.empty ?? "Kayıt yok"}</Muted> : null}
      {loading ? <Loading /> : next ? <Button label="Daha fazla" tone="plain" onPress={() => void load(next)} /> : null}
    </View>
  );
}
