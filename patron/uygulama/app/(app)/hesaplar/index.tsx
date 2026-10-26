// Hesaplar (yalnız tesis yöneticisi): tesisin bulut hesapları (rol + durum rozetli) · davet · verinin dışa aktarımı (Ek-6/A §4.2).
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { AccountRow, Capsule } from "../../../src/ui/diger/AccountRow";
import { GroupNote } from "../../../src/ui/diger/parts";
import { Screen } from "../../../src/ui/Frame";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { Empty, ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { space } from "../../../src/ui/tokens";
import { EMPTY_ICON } from "../../../src/ui/icons";

export default function Accounts() {
  const { api, offline } = useSession();
  const router = useRouter();
  const r = useRemote("hesaplar", () => api.accountList());
  return (
    <Screen module="hesaplar" onRefresh={r.reload} refreshing={r.refreshing}>
      <View style={{ flexDirection: "row", marginTop: space.s, marginBottom: space.xs }}>
        <Capsule label="Hesap davet et" icon="person-add" disabled={offline} onPress={() => router.push("/hesaplar/yeni")} testID="hesap-davet" />
      </View>
      <SectionHeader title="Ekip" count={r.data ? r.data.length : undefined} />
      {r.loading && !r.data ? <LoadingSkeleton rows={3} /> : null}
      {r.error && !r.data ? <ErrorState text={r.error} onRetry={r.reload} /> : null}
      {r.data && r.data.length === 0 ? <Empty icon={EMPTY_ICON.hesap} text="Henüz hesap yok; ekibinizi davet edin" /> : null}
      {r.data && r.data.length > 0 ? (
        <ListGroup testID="hesap-listesi" iconSize={44}>
          {r.data.map((a) => (
            <AccountRow key={a.id} a={a} onPress={() => router.push({ pathname: "/hesaplar/[id]", params: { id: a.id } } as never)} />
          ))}
        </ListGroup>
      ) : null}
      <GroupNote>Yönetici rozeti hesap yönetimi izni olanlardadır; izinleri hesaba dokunarak değiştirin.</GroupNote>
      <SectionHeader title="Veri" />
      <ListGroup>
        <ListRow title="Verileri dışa aktar" subtitle="JSON ya da CSV döküm; dosya web sürümünden indirilir" icon="download-outline" domain="raporlar"
          onPress={() => router.push("/hesaplar/disa-aktar")} testID="hesap-disa-aktar" />
      </ListGroup>
    </Screen>
  );
}
