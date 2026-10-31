// Finans › Masraf segmenti (D4-H2): fabrikanın `ozet-masraf` anlığı — bu ay harcanan, geçen aya göre fark ve
// ilk 15 kategori + "Diğer". Rakamlar fabrikanın; bu bileşen yalnız `lib/expense-summary` görünümünü çizer.
import { Text, View } from "react-native";
import { expenseView } from "../../lib/expense-summary";
import { IconChip } from "../IconChip";
import { Card } from "../kit";
import { ListRow } from "../ListRow";
import { SnapshotGate } from "../pano/SnapshotGate";
import { useSnapshot } from "../pano/useSnapshot";
import { SectionHeader } from "../SectionHeader";
import { Empty } from "../StateViews";
import { EMPTY_ICON } from "../icons";
import { makeStyles } from "../theme-context";
import { FONT_SCALE, space, typography } from "../tokens";

const NOT_YET = "Fabrikadan masraf özeti henüz gelmedi";

export function ExpenseSummary() {
  const remote = useSnapshot("ozet-masraf");
  return (
    <SnapshotGate remote={remote} domain="finans" variant="list" rows={3} empty={NOT_YET} testID="masraf-ozeti">
      {(veri) => <ExpenseBody veri={veri} />}
    </SnapshotGate>
  );
}

function ExpenseBody({ veri }: { veri: unknown }) {
  const s = useStyles();
  const v = expenseView(veri);
  if (!v) return <Empty text={NOT_YET} domain="finans" icon={EMPTY_ICON.bekliyor} testID="masraf-ozeti-bos" />;
  return (
    <View>
      <Card domain="finans" testID="masraf-bu-ay">
        <View style={s.head}>
          <IconChip domain="finans" icon="wallet-outline" />
          <Text style={s.headTitle} maxFontSizeMultiplier={FONT_SCALE.title}>{`${v.monthTitle} harcanan`}</Text>
        </View>
        <Text style={s.big} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={FONT_SCALE.title} testID="masraf-toplam">{v.total}</Text>
        <Text style={s.line} testID="masraf-fark">{`Geçen aya göre ${v.change.text}`}</Text>
        <Text style={s.caption}>{`${v.lastMonthText} · ${v.yearText}`}</Text>
      </Card>
      <SectionHeader title="Kategoriler" domain="finans" />
      {v.rows.length === 0 ? (
        <Empty text="Son 12 ayda masraf yok" domain="finans" icon={EMPTY_ICON.bekliyor} testID="masraf-kategori-yok" />
      ) : (
        v.rows.map((r) => <ListRow key={r.key} title={r.title} value={r.value} lines={r.lines} domain="finans" icon="pricetag-outline" testID={`masraf-kategori-${r.key}`} />)
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  headTitle: { ...typography.headline, color: t.text },
  big: { ...typography.display, color: t.text, marginTop: space.s },
  line: { ...typography.callout, color: t.textSecondary, marginTop: space.xs },
  caption: { ...typography.footnote, color: t.textMuted, marginTop: space.xs },
}));
