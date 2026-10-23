// İmleçli kayıt listesi, `useRemote` üstünde: ilk sayfa `veri:<projeksiyon>` anahtarıyla saklanır ve projeksiyon
// etiketiyle tazelenir (değişim akışı / aşağı çek); "Daha fazla" sonraki 50'yi aynı imleçle ekler. Satır çizimi
// çağıranda (kompakt `ListRow`); `kayit-<id>` testID'si korunur.
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { errorMessage } from "../../api/client";
import type { Page, ProjectionRecord } from "../../api/wire";
import { useSession } from "../../state/session";
import { useRemote, type Remote } from "../../state/useRemote";
import { Button } from "../kit";
import { ListGroup } from "../ListRow";
import { Empty, ErrorState, LoadingSkeleton } from "../StateViews";
import type { IconName } from "../icons";
import type { Domain } from "../tokens";

export const PAGE_SIZE = 50;

export function useRecordPage(projection: string, enabled = true): Remote<Page<ProjectionRecord>> {
  const { api } = useSession();
  return useRemote<Page<ProjectionRecord>>(enabled ? `veri:${projection}:ilk` : null, () => api.list(projection, { limit: PAGE_SIZE }), { tags: [projection] });
}

export function RemoteList({ projection, remote, renderRow, empty, domain, emptyIcon, testID }: {
  readonly projection: string;
  readonly remote: Remote<Page<ProjectionRecord>>;
  readonly renderRow: (r: ProjectionRecord) => ReactNode;
  readonly empty: string;
  readonly domain: Domain;
  readonly emptyIcon?: IconName;
  readonly testID?: string;
}) {
  const { api } = useSession();
  const [more, setMore] = useState<readonly ProjectionRecord[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const first = remote.data;

  // İlk sayfa tazelenince eklenen sayfalar düşer (sıra/sürüm değişmiş olabilir).
  useEffect(() => {
    setMore([]);
    setMoreError(null);
    setNext(remote.offline ? null : (first?.sonraki ?? null));
  }, [first, remote.offline]);

  const loadMore = async () => {
    if (!next) return;
    setBusy(true);
    setMoreError(null);
    try {
      const page = await api.list(projection, { imlec: next, limit: PAGE_SIZE });
      setMore((old) => [...old, ...page.kayitlar]);
      setNext(page.sonraki);
    } catch (err) {
      setMoreError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!first) {
    if (remote.loading) return <LoadingSkeleton variant="list" rows={4} testID={testID ? `${testID}-yukleniyor` : undefined} />;
    if (remote.error) return <ErrorState text={remote.error} onRetry={remote.reload} testID={testID ? `${testID}-hata` : undefined} />;
    return null;
  }
  const rows = [...first.kayitlar, ...more];
  if (rows.length === 0) return <Empty text={empty} domain={domain} icon={emptyIcon} testID={testID ? `${testID}-bos` : undefined} />;
  return (
    <View testID={testID}>
      <ListGroup>{rows.map((r) => <View key={r.id}>{renderRow(r)}</View>)}</ListGroup>
      {moreError ? <ErrorState text={moreError} onRetry={() => void loadMore()} /> : null}
      {next ? <Button label="Daha fazla" tone="plain" icon="chevron-down" busy={busy} onPress={() => void loadMore()} testID={testID ? `${testID}-daha` : undefined} /> : null}
    </View>
  );
}
