// Fason firma ayrıntısı — firmada ne var: top · kalan metre · açık sevk · en eski gönderim ("N gündür", renksiz) ·
// iş emirleri (→ İE listesi, firma süzgeci sunucu beyan ettiyse) · müşteri ve ürün·renk kırılımı. Hepsi `fason-acik`
// anlığının firma satırı (fabrika hesaplar); eski fabrika kırılımı göndermezse yalnız kokpit sayıları.
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "react-native";
import { subcontractFirmView } from "../../../src/lib/fason-summary";
import { FIRM_FILTER } from "../../../src/lib/is-emri";
import { Screen } from "../../../src/ui/Frame";
import { EMPTY_ICON } from "../../../src/ui/icons";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { FactoryStamp, SnapshotGate } from "../../../src/ui/pano/SnapshotGate";
import { useSnapshot } from "../../../src/ui/pano/useSnapshot";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { useListCapability } from "../../../src/ui/siparis/capabilities";
import { FactGroup, FactRow } from "../../../src/ui/siparis/parts";
import { Empty } from "../../../src/ui/StateViews";
import { makeStyles } from "../../../src/ui/theme-context";
import { typography } from "../../../src/ui/tokens";

export default function SubcontractFirm() {
  const { firmaId } = useLocalSearchParams<{ firmaId: string }>();
  const router = useRouter();
  const s = useStyles();
  const remote = useSnapshot("fason-acik");
  const firmFilter = useListCapability().memberFilter("is-emri", FIRM_FILTER);
  const v = remote.data ? subcontractFirmView(remote.data.veri, String(firmaId ?? "")) : null;
  return (
    <Screen title={v?.title ?? "Fason firması"} module="uretim" back onRefresh={remote.reload} refreshing={remote.refreshing}>
      <SnapshotGate remote={remote} domain="fason" variant="list" rows={4} empty="Fabrikadan fason bilgisi henüz gelmedi" testID="fason-firma">
        {(_veri, snap) => {
          if (!v) return <Empty text="Bu firmada açık fason işi yok" domain="fason" icon={EMPTY_ICON.bekliyor} testID="fason-firma-yok" />;
          return (
            <>
              <FactoryStamp snap={snap} offline={remote.offline} note="saatlik güncellenir" />
              <FactGroup testID="fason-firma-ozet">
                {v.facts.map((f) => <FactRow key={f.key} label={f.label} value={f.value} testID={`fason-firma-${f.key}`} />)}
              </FactGroup>
              {firmFilter && v.hasRolls ? (
                <ListGroup>
                  <ListRow
                    title="Bu firmadaki iş emirleri" icon="clipboard-outline" domain="uretim"
                    onPress={() => router.push({ pathname: "/is-emirleri", params: { firma: v.id, firmaAdi: v.title } } as never)}
                    testID="fason-firma-is-emirleri"
                  />
                </ListGroup>
              ) : null}
              {!v.hasRolls ? <Text style={s.note} testID="fason-firma-eski">Fabrika güncellenince müşteri ve ürün kırılımı burada görünür.</Text> : null}
              {v.customers.length > 0 ? (
                <>
                  <SectionHeader title="Kimin malı" domain="cariler" count={v.customers.length} />
                  <ListGroup testID="fason-firma-musteriler">
                    {v.customers.map((c) => <ListRow key={c.key} title={c.title} value={c.value} lines={c.lines} icon="person-outline" domain="cariler" testID={`fason-musteri-${c.key}`} />)}
                  </ListGroup>
                </>
              ) : null}
              {v.products.length > 0 ? (
                <>
                  <SectionHeader title="Hangi kumaş" domain="uretim" count={v.products.length} />
                  <ListGroup testID="fason-firma-urunler">
                    {v.products.map((u) => <ListRow key={u.key} title={u.title} value={u.value} lines={u.lines} icon="layers-outline" domain="uretim" testID={`fason-urun-${u.key}`} />)}
                  </ListGroup>
                </>
              ) : null}
            </>
          );
        }}
      </SnapshotGate>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  note: { ...typography.footnote, color: t.textSecondary },
}));
