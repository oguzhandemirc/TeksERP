// Devere maliyet dilim 2-3 + K7: dokuma iş emrinin GERÇEKLEŞEN maliyeti (tezgâh · devere · çözgü · atkı ipliği) standart karşılığıyla.
// Sayılar ve metinler sunucudan (`/api/cost/weaving-orders/:id/actual`); panel hesaplamaz, boş değere 0 yazmaz.
import { useQuery } from "@tanstack/react-query";
import { InfoPopover } from "@/components/ui/info-popover";
import { costItemService, type WeavingActualRow } from "@/pages/Cost/Items/service";
import { fmtDecFull } from "@/pages/Cost/shared/format";

const ROW_INFO: Record<WeavingActualRow["anahtar"], string> = {
  TEZGAH: "Tezgâhın bu işte çalıştığı süre × o tarihteki saat ücreti, işin toplarının metresine bölünür. Standart: maliyet kartındaki dokuma satırları.",
  DEVERE: "Devereci faturasının KDV hariç tutarı, topun kullandığı çözgü kadar. Fatura yoksa devere siparişindeki ücretten tahmin edilir. Standart maliyette devere ayrı seçilemediği için karşılaştırılmaz.",
  COZGU_IPLIGI: "Leventteki iplik kilosu × lotun alış fiyatı (devere firesi dahil), topun kullandığı çözgü kadar. Lot fiyatı yoksa maliyet kartındaki iplik fiyatından tahmin edilir. Atkı ipliği girmez.",
  ATKI_IPLIGI: "Atkı tartılmadığı için miktar normdur: standart maliyetteki atkı miktarı × topun metresi. Fiyat gerçektir: topun doğduğu ana kadar o ipliğin son giren lotunun alış fiyatı; yoksa maliyet kartındaki fiyattan tahmin edilir. Müşterinin ipliği maliyetimize girmez.",
};

function value(v: string | null, eksik: string[]): string {
  if (v !== null) return `${fmtDecFull(v, 4)} TL/m`;
  return eksik.length > 0 ? "eksik" : "—";
}

export function WeavingActualCost({ weavingOrderId }: { weavingOrderId: string }) {
  const q = useQuery({
    queryKey: ["cost-weaving-actual", weavingOrderId],
    queryFn: () => costItemService.weavingOrderActual(weavingOrderId),
  });
  if (q.isLoading) return <div className="emptybox">Gerçekleşen maliyet yükleniyor…</div>;
  if (q.isError || !q.data) return <div className="emptybox">Gerçekleşen maliyet okunamadı.</div>;
  const d = q.data;
  return (
    <div data-testid="wo-actual">
      <div className="order">
        <span className="cust">Gerçekleşen</span>
        <span className="spacer" />
        <span className="text-xs text-muted-foreground">{fmtDecFull(d.topMetre, 1)} m top{d.devamEdiyor ? " · iş devam ediyor" : ""}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left font-normal">Kalem</th>
            <th className="text-right font-normal">Standart</th>
            <th className="text-right font-normal">Gerçekleşen</th>
            <th className="text-left font-normal pl-3">Kaynak</th>
          </tr>
        </thead>
        <tbody>
          {d.satirlar.map((r) => (
            <tr key={r.anahtar} data-testid="wo-actual-row">
              <td className="py-1">
                <span className="inline-flex items-center gap-1">{r.ad}<InfoPopover desc={ROW_INFO[r.anahtar]} label={`${r.ad} açıklaması`} /></span>
              </td>
              <td className="py-1 text-right num">{r.standartTlM !== null ? `${fmtDecFull(r.standartTlM, 4)} TL/m` : "—"}</td>
              <td className="py-1 text-right num" data-testid={`wo-actual-${r.anahtar}`}>
                {value(r.gercekTlM, r.eksik)}
                {r.tahmini && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800" data-testid="wo-actual-estimated">tahmini</span>}
              </td>
              <td className="py-1 pl-3 text-xs text-muted-foreground">
                {[r.kaynak, r.eksik.length > 0 ? `eksik: ${r.eksik.join(", ")}` : null].filter(Boolean).join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.notlar.length > 0 && (
        <ul className="mt-1 text-xs text-muted-foreground" data-testid="wo-actual-notes">
          {d.notlar.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}
