// Finans: açık alacak + yaşlandırma (fabrikanın `ozet-finans` anlığı), çek vadeleri ve izinli hareket segmentleri
// (Kasa · Masraf · Kârlılık · Çek · Fatura · Tahsilat). İzinsiz segment HİÇ konmaz; tutarlar fabrikanın, para birimiyle basılır.
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import type { ProjectionRecord } from "../../../src/api/wire";
import { can } from "../../../src/lib/access";
import { formatAgo, formatDateTime } from "../../../src/lib/format";
import { invalidate } from "../../../src/state/changes";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { ProjectionList, type ProjectionRowView } from "../../../src/ui/data";
import { ExpenseSummary } from "../../../src/ui/finans/ExpenseSummary";
import { ProfitabilitySummary } from "../../../src/ui/finans/ProfitabilitySummary";
import { ChequeDue, ReceivableHero } from "../../../src/ui/finans/FinanceSummary";
import { FINANCE_TABS, FINANCE_TAGS, type FinanceTab } from "../../../src/ui/finans/tabs";
import { bankaRow, cekRow, faturaRow, kasaRow, tahsilatRow } from "../../../src/ui/finans/rows";
import { Screen } from "../../../src/ui/Frame";
import { openRecord } from "../../../src/ui/nav";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { space } from "../../../src/ui/tokens";

function List({ projection, row, empty }: { projection: string; row: (r: ProjectionRecord) => ProjectionRowView; empty: string }) {
  const router = useRouter();
  return <ProjectionList projection={projection} row={row} domain="finans" empty={empty} onOpen={(r) => openRecord(router, projection, r.id)} />;
}

export default function Finance() {
  const { api, permissions, factoryStamp } = useSession();
  const tabs = FINANCE_TABS.filter((t) => can(permissions, t.perm));
  const [picked, setPicked] = useState<FinanceTab | undefined>(undefined);
  const tab = picked && tabs.some((t) => t.key === picked) ? picked : tabs[0]?.key;
  const summaryAllowed = can(permissions, "bulut:cari-bakiye:oku");
  const summary = useRemote(summaryAllowed ? "anlik:ozet-finans" : null, () => api.snapshot("ozet-finans"), { tags: ["ozet-finans"] });
  const refresh = useCallback(() => invalidate(FINANCE_TAGS), []);
  const caption = summary.stale && summary.savedAt
    ? `Saklı kopya · ${formatAgo(summary.savedAt)}`
    : factoryStamp ? `Fabrika verisi ${formatDateTime(factoryStamp)}` : undefined;

  return (
    <Screen module="finans" back={false} onRefresh={refresh} refreshing={summary.refreshing}>
      {summaryAllowed ? (
        <View>
          {summary.loading && !summary.data ? <LoadingSkeleton variant="kpi" rows={2} /> : null}
          {summary.error && !summary.data ? <ErrorState text={summary.error} onRetry={summary.reload} /> : null}
          {summary.data ? <ReceivableHero veri={summary.data.veri} caption={caption} /> : null}
          {summary.data && can(permissions, "bulut:cek:oku") ? <ChequeDue veri={summary.data.veri} /> : null}
        </View>
      ) : null}
      {tab ? (
        <View>
          <SectionHeader title="Hareketler" domain="finans" />
          {tabs.length > 1 ? (
            <View style={{ marginBottom: space.m }}>
              <SegmentedControl items={tabs} value={tab} onChange={setPicked} testIDPrefix="sekme-" accessibilityLabel="Finans bölümleri" />
            </View>
          ) : null}
          {tab === "kasa" ? (
            <>
              <SectionHeader title="Kasalar" />
              <List projection="kasa" row={kasaRow} empty="Kasa yok" />
              <SectionHeader title="Bankalar" />
              <List projection="banka" row={bankaRow} empty="Banka hesabı yok" />
            </>
          ) : null}
          {tab === "masraf" ? <ExpenseSummary /> : null}
          {tab === "karlilik" ? <ProfitabilitySummary /> : null}
          {tab === "cek" ? <List projection="cek-senet" row={cekRow} empty="Çek/senet yok" /> : null}
          {tab === "fatura" ? <List projection="fatura" row={faturaRow} empty="Fatura yok" /> : null}
          {tab === "tahsilat" ? <List projection="tahsilat-odeme" row={tahsilatRow} empty="Tahsilat/ödeme yok" /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
