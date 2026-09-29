// Tek anlık projeksiyonun kartı (pano ve bölüm ekranları ortak kullanır).
import { View } from "react-native";
import { formatAgo } from "../lib/format";
import { useSession } from "../state/session";
import { useRemote } from "../state/useRemote";
import { SnapshotView } from "./data";
import { Card, Loading, Muted, Title } from "./kit";

export function SnapshotCard({ projection, title }: { projection: string; title: string }) {
  const { api } = useSession();
  const r = useRemote(`anlik:${projection}`, () => api.snapshot(projection));
  return (
    <Card testID={`anlik-${projection}`}>
      <Title>{title}</Title>
      {r.loading && !r.data ? <Loading /> : null}
      {r.error && !r.data ? <Muted>{r.error}</Muted> : null}
      {r.data ? (
        <View>
          <SnapshotView value={r.data.veri} />
          <Muted>{`Veri: ${formatAgo(r.savedAt)}${r.offline ? " (çevrimdışı)" : ""}`}</Muted>
        </View>
      ) : null}
    </Card>
  );
}
