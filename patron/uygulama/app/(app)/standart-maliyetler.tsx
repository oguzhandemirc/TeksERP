// Standart maliyetler: ürün başına maliyet sürümleri (fabrikanın hesapladığı, tüm sürümler). Ekran yalnız teklif +
// maliyet izniyle görünür; metre maliyeti ve 5 grup `.finans`tan aynen — istemci toplamaz, oran hesaplamaz.
import { useRouter } from "expo-router";
import { standardCostRowText } from "../../src/ui/teklif/rows";
import { Screen } from "../../src/ui/Frame";
import { ListGroup, ListRow } from "../../src/ui/ListRow";
import { openRecord } from "../../src/ui/nav";
import { SectionHeader } from "../../src/ui/SectionHeader";
import { ListStates, StaleNote } from "../../src/ui/siparis/parts";
import { useRemoteList } from "../../src/ui/siparis/useRemoteList";

export default function StandardCosts() {
  const router = useRouter();
  const list = useRemoteList("standart-maliyet");
  return (
    <Screen title="Standart Maliyetler" module="standart-maliyetler" onRefresh={list.reload} refreshing={list.refreshing} subtitle={<StaleNote stale={list.stale} savedAt={list.savedAt} />}>
      <SectionHeader title="Maliyet sürümleri" domain="finans" count={!list.loading && !list.hasMore ? list.items.length : undefined} />
      {list.items.length > 0 ? (
        <ListGroup testID="maliyet-listesi">
          {list.items.map((r) => {
            const x = standardCostRowText(r);
            return (
              <ListRow
                key={r.id}
                title={x.title}
                value={x.value}
                lines={x.groups ? [x.line, x.groups] : [x.line]}
                domain="finans"
                onPress={() => openRecord(router, "standart-maliyet", r.id)}
                testID={`kayit-${r.id}`}
              />
            );
          })}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty="Henüz standart maliyet hesaplanmadı" domain="finans" testID="standart-maliyetler" />
    </Screen>
  );
}
