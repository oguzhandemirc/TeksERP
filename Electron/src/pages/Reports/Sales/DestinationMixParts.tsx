// Yurtiçi / Yurtdışı Satış — kapsam notu ve "Açık sipariş ve termin" sekmesi.
import { DetailTable, MetricCard } from "../_components";
import { fmtInt, fmtNum } from "../_components/formatters";
import type { DestinationMix } from "./destinationMix";
import { backlogExportColumns } from "./destinationMixColumns";

/** Her sayının kapsamı ekranın başında: fiyatlı satır, kur kaynağı, ülke doluluğu. */
export function DestinationMixCoverage({ r, priced, lines }: { r: DestinationMix; priced: number; lines: number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground" data-testid="destination-mix-kapsam">
      <p>
        <b className="text-foreground">Tutar kapsamı:</b> fiyatlı {fmtInt(priced)} / {fmtInt(lines)} tahsis satırı.
        {priced === 0 && lines > 0
          ? " Bu dönemde sipariş satırlarına fiyat girilmemiş — tutar sütunları boş; fiyat girildikçe dolar (bu bir hata değil)."
          : ""}{" "}
        Para birimleri ayrı gösterilir.
      </p>
      <p><b className="text-foreground">TL karşılığı:</b> {r.kapsam.kurKaynagi}.</p>
      <p>
        <b className="text-foreground">Ülke:</b> serbest metin, düzeltilmez — {fmtInt(r.kapsam.customersWithCountry)} / {fmtInt(r.kapsam.customersInPeriod)} müşteride dolu.
      </p>
    </div>
  );
}

/** Açık sipariş (BUGÜN) + termini dönemde olan siparişlerin gerçekleşmesi — yön siparişin bugünkü zinciri. */
export function DestinationMixOrdersTab({ r, isLoading }: { r: DestinationMix; isLoading: boolean }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {r.backlog.map((b) => {
          const f = r.fulfillment.find((x) => x.bucket === b.bucket);
          const termin = f
            ? `termini dönemde ${fmtInt(f.orderCount)} sipariş · zamanında ${fmtInt(f.onTime)} · geç ${fmtInt(f.lateCompleted)}${f.shippedPct == null ? "" : ` · gerçekleşme %${fmtNum(f.shippedPct)}`}`
            : "termini dönemde sipariş yok";
          const hint = [`termini geçen ${fmtNum(b.overdueQty)} m`, termin, b.nonMtLines > 0 ? `${fmtInt(b.nonMtLines)} KG/adet satırı ölçülmedi` : ""];
          return <MetricCard key={b.bucket} label={`Açık · ${b.label}`} value={`${fmtNum(b.openQty)} m`} hint={hint.filter(Boolean).join(" · ")} isLoading={isLoading} />;
        })}
      </div>
      <DetailTable
        title="Yurtdışı açık siparişler"
        description="BUGÜNKÜ durum (dönemden bağımsız); yön siparişin bugünkü cari/şube yönüdür."
        data={r.backlogExport}
        columns={backlogExportColumns}
        isLoading={isLoading}
        emptyLabel="Yurtdışı açık sipariş yok"
      />
    </>
  );
}
