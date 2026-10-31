// Cari ayrıntısı: kimlik kartı (ad, kod, roller) · bakiye kartları (`cari-hesap`, sunucu `cariKartId` süzgeci; tutar
// yalnız `.finans` alt satırı izinliyse) · son hareketler (`cari-hareket`, sunucu `cariHesapId` süzgeci — sunucu beyan
// etmiyorsa bölüm yok) · ekstre isteği (rapor) · son siparişler (`siparis`, `cariKartId`) · iletişim.
// Bakiye, vadesi geçen tutar ve cari kilidi (D4-I6) fabrikadan; uygulama hesap yapmaz.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import type { ProjectionRecord } from "../../../src/api/wire";
import { can } from "../../../src/lib/access";
import { cariLockView } from "../../../src/lib/cari-lock";
import { fmtFactoryDateTime } from "../../../src/lib/factory-time";
import { formatMoney, formatNumber } from "../../../src/lib/format";
import { cariKindLabel, cariRoles, destinationLabel } from "../../../src/lib/labels/siparis";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { Screen } from "../../../src/ui/Frame";
import { IconChip } from "../../../src/ui/IconChip";
import { Button, Muted } from "../../../src/ui/kit";
import { ListGroup } from "../../../src/ui/ListRow";
import { openRecord } from "../../../src/ui/nav";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { StatusBadge } from "../../../src/ui/StatusBadge";
import { useListCapability } from "../../../src/ui/siparis/capabilities";
import { CustomerMovements } from "../../../src/ui/siparis/OrderLines";
import { OrderRow, asObj, str } from "../../../src/ui/siparis/OrderRow";
import { FactGroup, FactRow, ListStates, RolePill, StaleNote } from "../../../src/ui/siparis/parts";
import { useRemoteList } from "../../../src/ui/siparis/useRemoteList";
import { makeStyles, useTokens } from "../../../src/ui/theme-context";
import { FONT_SCALE, STRIPE, radius, space, tabularNums, typography } from "../../../src/ui/tokens";

interface Amount { doviz: string; value: unknown }
const amounts = (v: unknown, field: "bakiye" | "tutar"): Amount[] =>
  Array.isArray(v) ? v.map((x) => asObj(x)).map((x) => ({ doviz: str(x.doviz) ?? "TRY", value: x[field] })) : [];

function BalanceCard({ r }: { r: ProjectionRecord }) {
  const t = useTokens();
  const s = useStyles();
  const k = asObj(r.kayit);
  const fin = r.finans === undefined ? null : asObj(r.finans);
  const balances = fin ? amounts(fin.bakiyeler, "bakiye") : [];
  const overdue = fin ? amounts(fin.gecikmis, "tutar") : [];
  const lock = cariLockView(k);
  return (
    <View style={s.card} testID={`cari-hesap-${r.id}`}>
      <View style={[s.stripe, { backgroundColor: t.domain.finans.fg }]} />
      <View style={s.cardHead}>
        <IconChip domain="finans" icon="wallet-outline" />
        <Text style={s.cardTitle}>{cariKindLabel(k.tur)}</Text>
        {k.aktif === false ? <StatusBadge kind="bilgi" label="Pasif" size="sm" /> : null}
        {lock.state === "KILITLI" ? <StatusBadge kind="kritik" label={lock.label} size="sm" testID={`cari-kilit-${r.id}`} /> : null}
      </View>
      {lock.state === "KILITLI" ? <Text style={s.meta} testID={`cari-kilit-ayrinti-${r.id}`}>{lock.text}</Text> : null}
      {lock.state === "BILINMIYOR" ? <Text style={s.meta} testID={`cari-kilit-bilinmiyor-${r.id}`}>{lock.text}</Text> : null}
      {fin === null ? <Muted>Tutarları görme izniniz yok.</Muted> : null}
      {fin !== null && balances.length === 0 ? <Text style={s.zero}>Bakiye yok</Text> : null}
      {balances.map((b) => (
        <View key={b.doviz} style={s.balance} accessible accessibilityLabel={`Bakiye ${formatMoney(b.value, b.doviz)}`}>
          <Text style={s.balanceValue} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={FONT_SCALE.title}>{formatMoney(b.value, b.doviz)}</Text>
        </View>
      ))}
      {overdue.length > 0 ? (
        <View style={s.overdue}>
          {overdue.map((o) => <StatusBadge key={o.doviz} kind="kritik" label={`Vadesi geçmiş ${formatMoney(o.value, o.doviz)}`} testID={`vadesi-gecmis-${o.doviz}`} />)}
        </View>
      ) : fin !== null && balances.length > 0 ? (
        <StatusBadge kind="iyi" label="Vadesi geçmiş borç yok" size="sm" />
      ) : null}
      {fin !== null && (fin.vadeGun != null || fin.riskLimiti != null) ? (
        <Text style={s.meta}>
          {[fin.vadeGun != null ? `Vade ${formatNumber(fin.vadeGun, 0)} gün` : null, fin.riskLimiti != null ? `Risk limiti ${formatMoney(fin.riskLimiti, str(k.varsayilanDoviz) ?? "TRY")}` : null].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, permissions } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const cariId = id ? String(id) : null;
  const r = useRemote(cariId ? `kayit:cari-kart:${cariId}` : null, () => api.record("cari-kart", String(cariId)));
  const balance = can(permissions, "bulut:cari-bakiye:oku");
  const statement = balance && can(permissions, "bulut:rapor:oku");
  const orders = can(permissions, "bulut:siparis:oku");
  const movements = useListCapability().idFilter("cari-hareket", "cariHesapId") && balance;
  const [tick, setTick] = useState(0);
  const accounts = useRemoteList("cari-hesap", { cariKartId: cariId ?? undefined }, { enabled: balance && !!cariId && !!r.data });
  const recent = useRemoteList("siparis", { cariKartId: cariId ?? undefined }, { enabled: orders && !!cariId && !!r.data, limit: 10 });
  const k = asObj(r.data?.kayit);
  const kisisel = r.data?.kisisel === undefined || r.data.kisisel === null ? null : asObj(r.data.kisisel);
  const roles = cariRoles(k);
  const place = [str(k.ilce), str(k.il), str(k.ulke)].filter(Boolean).join(", ");
  const refresh = () => {
    r.reload();
    accounts.reload();
    recent.reload();
    setTick((n) => n + 1);
  };
  return (
    <Screen title={str(k.ad) ?? "Cari"} module="cariler" back onRefresh={refresh} refreshing={r.refreshing} subtitle={<StaleNote stale={r.stale} savedAt={r.savedAt} />}>
      {r.loading && !r.data ? <LoadingSkeleton rows={3} /> : null}
      {r.error && !r.data ? <ErrorState text={r.error} onRetry={r.reload} /> : null}
      {r.data ? (
        <>
          <View style={s.card} testID="cari-kimlik">
            <View style={[s.stripe, { backgroundColor: t.domain.cariler.fg }]} />
            <View style={s.cardHead}>
              <IconChip domain="cariler" icon="business-outline" size={44} />
              <View style={s.flex}>
                <Text style={s.name} maxFontSizeMultiplier={FONT_SCALE.title}>{str(k.kod) ?? "—"}</Text>
                {place ? <Text style={s.code}>{place}</Text> : null}
              </View>
            </View>
            <View style={s.pills}>
              {roles.map((x) => <RolePill key={x.key} roleKey={x.key} label={x.label} />)}
              {k.aktif === false ? <StatusBadge kind="bilgi" label="Pasif" size="sm" /> : null}
            </View>
            {str(k.varsayilanYon) ? <Text style={s.meta}>{`Varsayılan sevk yönü: ${destinationLabel(k.varsayilanYon)}`}</Text> : null}
          </View>

          {balance ? (
            <>
              <SectionHeader title="Bakiye" domain="finans" />
              {accounts.items.map((a) => <BalanceCard key={a.id} r={a} />)}
              <ListStates list={accounts} empty="Bu carinin muhasebe hesabı yok" domain="finans" testID="cari-hesaplar" />
              {statement ? (
                <Button label="Ekstre iste" tone="secondary" icon="document-text-outline" testID="ekstre-iste"
                  onPress={() => router.push({ pathname: "/raporlar/yeni", params: { anahtar: "finance/statement", cariKartId: String(cariId) } } as never)} />
              ) : null}
              {movements ? <CustomerMovements accounts={accounts.items} tick={tick} /> : null}
            </>
          ) : <Muted>Bakiye görme izniniz yok.</Muted>}

          {orders ? (
            <>
              <SectionHeader title="Son siparişler" domain="siparisler" />
              {recent.items.length > 0 ? (
                <ListGroup testID="cari-siparisler">
                  {recent.items.map((o) => <OrderRow key={o.id} r={o} showCustomer={false} onPress={() => openRecord(router, "siparis", o.id)} />)}
                </ListGroup>
              ) : null}
              <ListStates list={recent} empty="Bu cariye ait sipariş yok" domain="siparisler" testID="cari-siparis" />
            </>
          ) : null}

          {kisisel ? (
            <>
              <SectionHeader title="İletişim" />
              <FactGroup>
                <FactRow label="Yetkili" value={str(kisisel.yetkili) ?? "—"} />
                <FactRow label="Telefon" value={str(kisisel.telefon) ?? "—"} />
              </FactGroup>
            </>
          ) : null}

          <Text style={s.foot}>{`Fabrika verisi ${fmtFactoryDateTime(r.data.surum)}`}</Text>
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  card: { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, paddingLeft: space.l + STRIPE, marginBottom: space.m, overflow: "hidden" as const, gap: space.s, ...t.cardShadow },
  stripe: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: STRIPE },
  cardHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m },
  cardTitle: { ...typography.headline, color: t.text, flex: 1 },
  flex: { flex: 1 },
  name: { ...typography.headline, ...tabularNums, color: t.text },
  code: { ...typography.subhead, ...tabularNums, color: t.textSecondary, marginTop: 2 },
  pills: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.xs },
  meta: { ...typography.footnote, color: t.textSecondary },
  zero: { ...typography.body, color: t.textSecondary },
  balance: { flexDirection: "row" as const, alignItems: "baseline" as const },
  balanceValue: { ...typography.kpi, color: t.text, flexShrink: 1 },
  overdue: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.xs },
  foot: { ...typography.footnote, color: t.textMuted, textAlign: "center" as const, marginTop: space.m },
}));
