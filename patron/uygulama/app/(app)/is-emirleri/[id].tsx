// İş emri ayrıntısı — dört soru: Kimin (müşteri → cari kartı) · Hangi sipariş (→ sipariş; bağsızsa "Siparişsiz (stok)") ·
// Ne (kumaş · renk) · Nerede (aşama kırılımı + fason firma payları, "N gündür" renksiz). Altta üretim ayrıntıları.
// Hepsi fabrikanın alanları (`is-emri` v3); ekran yalnız etikete çevirir. Termin/gecikme yok.
import { useLocalSearchParams, useRouter } from "expo-router";
import { moduleVisible } from "../../../src/lib/access";
import { customers, detailRows, fabricText, firmRows, noOrder, NO_ORDER_TEXT, orders, stageRows, whereText, workOrderNo, type Kayit } from "../../../src/lib/is-emri";
import { shipReadinessView } from "../../../src/lib/ship-readiness";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { ErrorBox } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { FactGroup, FactRow, StaleNote } from "../../../src/ui/siparis/parts";
import { LoadingSkeleton } from "../../../src/ui/StateViews";
import { TERIM } from "../../../src/lib/terim";

export default function WorkOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, permissions } = useSession();
  const router = useRouter();
  const r = useRemote(id ? `kayit:is-emri:${id}` : null, () => api.record("is-emri", String(id)), { tags: ["is-emri"] });
  const k: Kayit = typeof r.data?.kayit === "object" && r.data?.kayit !== null ? (r.data.kayit as Kayit) : {};
  const cariOpen = moduleVisible(permissions, "cariler");
  const orderOpen = moduleVisible(permissions, "siparisler");
  const sip = orders(k);
  const stages = stageRows(k);
  const firms = firmRows(k);
  const ready = shipReadinessView(k);

  return (
    <Screen title={r.data ? workOrderNo(k) : TERIM.terbiyeIsEmri.tekil} module="is-emirleri" back onRefresh={r.reload} refreshing={r.refreshing} subtitle={<StaleNote stale={r.stale} savedAt={r.savedAt} />}>
      {r.loading && !r.data ? <LoadingSkeleton rows={5} /> : null}
      {r.error && !r.data ? <ErrorBox text={r.error} onRetry={r.reload} /> : null}
      {r.data ? (
        <>
          <SectionHeader title="Kimin" domain="cariler" testID="is-emri-kim" />
          <ListGroup>
            {customers(k).map((c, i) => (
              <ListRow
                key={c.id ?? `ad-${i}`} title={c.ad} icon="person-outline" domain="cariler"
                onPress={c.id && cariOpen ? () => router.push({ pathname: "/cariler/[id]", params: { id: c.id! } } as never) : undefined}
                testID={`is-emri-musteri-${i}`}
              />
            ))}
          </ListGroup>

          <SectionHeader title="Hangi sipariş" domain="siparisler" count={sip.length > 1 ? sip.length : undefined} testID="is-emri-siparisler" />
          <ListGroup>
            {sip.length === 0 ? (
              <ListRow title={noOrder(k) ? NO_ORDER_TEXT : "—"} icon="document-text-outline" domain="siparisler" testID="is-emri-siparissiz" />
            ) : sip.map((o, i) => (
              <ListRow
                key={`${o.no}-${i}`} title={o.no} icon="receipt-outline" domain="siparisler"
                onPress={o.id && orderOpen ? () => router.push({ pathname: "/siparisler/[id]", params: { id: o.id! } } as never) : undefined}
                testID={`is-emri-siparis-${i}`}
              />
            ))}
          </ListGroup>

          <SectionHeader title="Ne" domain="uretim" testID="is-emri-ne" />
          <ListGroup>
            <ListRow title={fabricText(k)} icon="layers-outline" domain="uretim" testID="is-emri-kumas" />
          </ListGroup>

          <SectionHeader title="Nerede" domain="uretim" testID="is-emri-nerede" />
          <FactGroup testID="is-emri-asamalar">
            <FactRow label="Şu an" value={whereText(k)} testID="is-emri-yer" />
            {stages.map((a) => <FactRow key={a.key} label={a.label} value={a.value} testID={`is-emri-asama-${a.key}`} />)}
            {ready ? <FactRow label="Sevke hazırlık" value={ready.text} tone={ready.kind} testID="is-emri-sevke-hazir" /> : null}
          </FactGroup>
          {firms.length > 0 ? (
            <>
              <SectionHeader title="Fasondaki firmalar" domain="fason" count={firms.length > 1 ? firms.length : undefined} testID="is-emri-firmalar" />
              <ListGroup>
                {firms.map((f) => (
                  <ListRow
                    key={f.key} title={f.label} value={f.value} lines={f.line ? [f.line] : undefined} icon="business-outline" domain="fason"
                    onPress={f.firmId ? () => router.push({ pathname: "/fason/[firmaId]", params: { firmaId: f.firmId! } } as never) : undefined}
                    testID={`is-emri-firma-${f.key}`}
                  />
                ))}
              </ListGroup>
            </>
          ) : null}

          <SectionHeader title="Üretim ayrıntıları" domain="uretim" testID="is-emri-ayrinti" />
          <FactGroup>
            {detailRows(k).map((b) => <FactRow key={b.key} label={b.label} value={b.value} testID={`is-emri-bilgi-${b.key}`} />)}
          </FactGroup>
        </>
      ) : null}
    </Screen>
  );
}
