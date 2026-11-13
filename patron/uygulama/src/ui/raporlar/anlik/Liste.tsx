// İstek üzerine rapor listesi: sunucunun süzdüğü katalog (ERP izni + modül + rapor kapısı) — istemci bulut kodu
// süzgeci (`requestable`) UYGULANMAZ. Satır: rapor adı + "Son: GG.AA SS:DD" ya da "Henüz oluşturulmadı".
import { useRouter } from "expo-router";
import { reportDomain } from "../../../lib/labels/finans";
import { sonMetni } from "../../../lib/rapor-anlik";
import { useSession } from "../../../state/session";
import { useRemote } from "../../../state/useRemote";
import { Screen } from "../../Frame";
import { EMPTY_ICON } from "../../icons";
import { ListGroup, ListRow } from "../../ListRow";
import { Empty, ErrorState, LoadingSkeleton } from "../../StateViews";

export const KATALOG_KEY = "rapor-anlik:katalog";
export const RAPOR_TAGS = ["rapor"] as const;

export function AnlikRaporListesi() {
  const { raporcu } = useSession();
  const router = useRouter();
  const k = useRemote(KATALOG_KEY, () => raporcu.katalog(), { tags: RAPOR_TAGS });
  const rows = k.data?.raporlar ?? [];
  return (
    <Screen module="raporlar" onRefresh={k.reload} refreshing={k.refreshing}>
      {k.loading && !k.data ? <LoadingSkeleton rows={4} /> : null}
      {k.error && !k.data ? <ErrorState text={k.error} onRetry={k.reload} /> : null}
      {k.data && rows.length === 0 ? <Empty text="Size açık rapor yok" domain="raporlar" icon={EMPTY_ICON.yetki} /> : null}
      {rows.length > 0 ? (
        <ListGroup testID="rapor-listesi">
          {rows.map((r) => {
            const d = reportDomain(r.anahtar);
            return (
              <ListRow
                key={r.anahtar}
                testID={`rapor-satir-${r.anahtar}`}
                title={r.baslik}
                subtitle={sonMetni(r.sonKosum)}
                icon={d.icon}
                domain={d.domain}
                onPress={() => router.push({ pathname: "/raporlar/rapor", params: { anahtar: r.anahtar } } as never)}
              />
            );
          })}
        </ListGroup>
      ) : null}
    </Screen>
  );
}
