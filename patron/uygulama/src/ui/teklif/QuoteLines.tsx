// Teklif kalemleri: SUNUCU kimlik süzgeciyle (`teklifId`) okunur; süzgeç beyansızsa (eski bulut) bölüm hiç çizilmez.
// Kalem tutarı `.finans`tadır; maliyet izni yoksa satırda tutar YOK (hesap da yok — miktar × fiyat yapılmaz).
import type { ProjectionRecord } from "../../api/wire";
import { formatMoney, formatNumber } from "../../lib/format";
import { unitLabel } from "../../lib/labels/siparis";
import { ListGroup, ListRow } from "../ListRow";
import { SectionHeader } from "../SectionHeader";
import { asObj, str } from "../siparis/OrderRow";
import { ListStates } from "../siparis/parts";
import { useListCapability } from "../siparis/capabilities";
import { useRemoteList } from "../siparis/useRemoteList";

export function quoteLineText(r: ProjectionRecord, currency: string) {
  const k = asObj(r.kayit);
  const f = r.finans ? asObj(r.finans) : null;
  return {
    title: str(k.tanim) ?? "—",
    subtitle: `${formatNumber(k.miktar)} ${unitLabel(k.birim)}`,
    value: f && f.tutar != null ? formatMoney(f.tutar, currency) : undefined,
  };
}

export function QuoteLines({ teklifId, currency }: { teklifId: string; currency: string }) {
  const enabled = useListCapability().idFilter("teklif-kalemi", "teklifId");
  const list = useRemoteList("teklif-kalemi", { teklifId }, { enabled, tags: ["teklif-kalemi", "teklif"] });
  if (!enabled) return null;
  return (
    <>
      <SectionHeader title="Kalemler" domain="siparisler" />
      {list.items.length > 0 ? (
        <ListGroup testID="teklif-kalemleri">
          {list.items.map((r) => {
            const x = quoteLineText(r, currency);
            return <ListRow key={r.id} title={x.title} subtitle={x.subtitle} value={x.value} domain="siparisler" icon="layers-outline" testID={`kalem-${r.id}`} />;
          })}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty="Bu teklifin kalemi yok" domain="siparisler" testID="teklif-kalem" />
    </>
  );
}
