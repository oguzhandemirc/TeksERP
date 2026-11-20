// Fasondaki İplik özet şeridi — listeyle AYNI yanıttan (tek where): kg · fasoncu · çeşit · devreden · en eski · değer.
// Değer para birimi başına ayrı (kur çevrilmez); yalnız fiyat alanı gelen kullanıcıda; fiyatsız satır sayısı uyarı tonu.
import { BandStats, ListBand, type BandStatItem } from "@/components/layout/ListPage";
import { formatAmount, formatQty } from "@/lib/format";
import { ageText, CARRIED_HINT, LONG_WAIT_DAYS, type YarnAtSubSummary } from "./model";

const kgText = (v: number) => formatQty(v, 3, 3);

export function summaryItems(s: YarnAtSubSummary, showValue: boolean): BandStatItem[] {
  const items: BandStatItem[] = [
    { key: "kg", label: "Toplam", value: kgText(s.totalKg), unit: "kg" },
    { key: "subs", label: "Fasoncu", value: s.subcontractorCount },
    { key: "yarns", label: "İplik çeşidi", value: s.yarnCount },
    { key: "carried", label: "Devreden", value: kgText(s.carriedKg), unit: "kg", tone: s.carriedKg > 0 ? "warn" : undefined, title: CARRIED_HINT },
  ];
  if (s.oldestDays !== null) {
    items.push({ key: "oldest", label: "En eski", value: ageText(s.oldestDays), tone: s.oldestDays >= LONG_WAIT_DAYS ? "warn" : undefined, title: "En uzun süredir fasonda duran ipliğin bekleme süresi" });
  }
  if (showValue) {
    const title = "kg × mal kabuldeki lot birim fiyatı; para birimleri ayrı toplanır, kur çevrilmez";
    if (s.valueTotals.length === 0) items.push({ key: "value", label: "Değer", value: "—", title });
    for (const v of s.valueTotals) items.push({ key: `value-${v.currency}`, label: `Değer (${v.currency})`, value: formatAmount(v.value), title });
    if (s.unpricedLines > 0) items.push({ key: "unpriced", label: "Fiyatsız", value: s.unpricedLines, unit: "satır", tone: "warn", title: "Lotsuz, mal kabulde fiyatı olmayan ya da farklı para birimli lot — değer toplamına girmedi" });
  }
  return items;
}

export function SummaryBand({ s, filtered, showValue }: { s: YarnAtSubSummary; filtered: boolean; showValue: boolean }) {
  return (
    <ListBand>
      <BandStats label="Fasondaki iplik özeti" scope={filtered ? "Süzgece uyan" : "Tüm fasoncular"} items={summaryItems(s, showValue)} />
    </ListBand>
  );
}
