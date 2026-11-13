// "Oluşturulanlar": bir raporun kullanıcıya ait koşumları (en yeni önce) — tarih, parametre özeti, süre, durum.
// Dokununca o koşumun saklı sonucu; silme koşum ekranında (iki adımlı onay).
import { useLocalSearchParams, useRouter } from "expo-router";
import { reportDomain } from "../../../lib/labels/finans";
import { kosumTarihi, ozetMetni, sureMetni } from "../../../lib/rapor-anlik";
import { useSession } from "../../../state/session";
import { useRemote } from "../../../state/useRemote";
import { Screen } from "../../Frame";
import { ListGroup, ListRow } from "../../ListRow";
import { Empty, ErrorState, LoadingSkeleton } from "../../StateViews";
import { ReportStatusBadge } from "../parts";
import { KATALOG_KEY, RAPOR_TAGS } from "./Liste";

/** Sunucunun saklama sınırı bunun altında; tek sayfa yeter. */
export const GECMIS_LIMIT = 50;

export function AnlikRaporGecmisi() {
  const { anahtar: raw } = useLocalSearchParams<{ anahtar?: string }>();
  const anahtar = String(raw ?? "");
  const { raporcu } = useSession();
  const router = useRouter();
  const k = useRemote(KATALOG_KEY, () => raporcu.katalog(), { tags: RAPOR_TAGS });
  const g = useRemote(anahtar ? `rapor-anlik:gecmis:${anahtar}` : null, () => raporcu.gecmis(anahtar, { limit: GECMIS_LIMIT }), { tags: RAPOR_TAGS });
  const baslik = k.data?.raporlar.find((r) => r.anahtar === anahtar)?.baslik;
  const rows = g.data?.kayitlar ?? [];
  const d = reportDomain(anahtar);
  return (
    <Screen title={baslik ? `${baslik} · Oluşturulanlar` : "Oluşturulanlar"} module="raporlar" back onRefresh={g.reload} refreshing={g.refreshing}>
      {g.loading && !g.data ? <LoadingSkeleton rows={4} /> : null}
      {g.error && !g.data ? <ErrorState text={g.error} onRetry={g.reload} /> : null}
      {g.data && rows.length === 0 ? <Empty text="Henüz oluşturulmadı" domain="raporlar" /> : null}
      {rows.length > 0 ? (
        <ListGroup testID="rapor-gecmis-listesi">
          {rows.map((r) => {
            const sure = sureMetni(r.sureMs);
            return (
              <ListRow
                key={r.id}
                testID={`kosum-${r.id}`}
                title={kosumTarihi(r)}
                subtitle={sure ? `${ozetMetni(r)} · ${sure}` : ozetMetni(r)}
                icon={d.icon}
                domain={d.domain}
                accessory={<ReportStatusBadge status={r.durum} compact testID={`kosum-durum-${r.id}`} />}
                onPress={() => router.push({ pathname: "/raporlar/[id]", params: { id: r.id } } as never)}
              />
            );
          })}
        </ListGroup>
      ) : null}
    </Screen>
  );
}
