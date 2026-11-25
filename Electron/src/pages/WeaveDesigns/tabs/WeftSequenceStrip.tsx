// Atkı sırası sekmesi görseli: atkı seçici sütunu (atkı başına satır, iplik harfi sütununda dolu kare) +
// renk raporu bandı (her atkı bir ince şerit, iki rapor, sınır kalın) + pay özeti. Kaynak KAYITLI etkin yapının
// `weft.pickSequence`i (sunucu açar); istemci sıra kodunu açmaz — yazılan kod kaydedilince görünüm güncellenir.
import { useQuery } from "@tanstack/react-query";
import { InfoPopover } from "@/components/ui/info-popover";
import { WeaveGrid } from "@/components/weave/WeaveGrid";
import { WeaveScrollBox } from "@/components/weave/WeaveScrollBox";
import { WeaveDirectionToggle } from "@/components/weave/WeaveViewControls";
import { YarnLegend } from "@/components/weave/YarnLegend";
import { picksPerYarn } from "@/components/weave/weave-drawdown";
import { useWeaveDirection } from "@/components/weave/weave-direction";
import { yarnColor, yarnLetter } from "@/components/weave/weave-palette";
import { formatQty } from "@/lib/format";
import { constructionApi } from "../service";

const INFO = "Satır = atkı, sütun = atkı ipliği (A, B, C…). Dolu kare o atkıda hangi ipliğin atıldığını gösterir; tezgâhın atkı "
  + "seçicisi bu sırayla çalışır. Alttaki renk raporu bandı aynı sırayı soldan sağa iki rapor boyunca gösterir; kalın çizgi rapor sınırıdır.";

export function WeftSequenceStrip({ fabricId }: { fabricId: string }) {
  const [direction, setDirection] = useWeaveDirection();
  const construction = useQuery({
    queryKey: ["item-construction", fabricId, null],
    queryFn: () => constructionApi.get(fabricId),
  });
  const weft = construction.data?.weft ?? null;
  const seq = weft?.pickSequence ?? null;
  const yarns = weft?.yarns ?? [];
  return (
    <section className="min-w-0 space-y-3 rounded-lg border bg-card p-3" aria-label="Atkı seçici görünümü">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          Atkı seçici
          <InfoPopover label="Atkı seçici nasıl okunur" desc={INFO} />
        </h3>
        {seq && <WeaveDirectionToggle value={direction} onChange={setDirection} />}
      </div>
      {construction.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : !seq || seq.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sıra kodu girilip kaydedilince atkı seçici burada çizilir (ör. A4 B1 A4 C1).</p>
      ) : (
        <SequenceView seq={seq} letters={yarns.map((y, i) => y.letter || yarnLetter(i))} names={yarns.map((y) => y.yarnItem.name)} direction={direction} />
      )}
    </section>
  );
}

function SequenceView({ seq, letters, names, direction }: {
  seq: readonly number[]; letters: readonly string[]; names: readonly string[]; direction: ReturnType<typeof useWeaveDirection>[0];
}) {
  const count = Math.max(letters.length, ...seq);
  const per = picksPerYarn(seq, count);
  const band = seq.length <= 256 ? [...seq, ...seq] : [...seq];
  // Bant kutuya sığsın (kısa raporda kaydırma yok); uzun raporda 2 px'te durur, kutu yatay kayar.
  const bandCell = Math.max(2, Math.min(8, Math.floor(320 / band.length)));
  return (
    <>
      <WeaveScrollBox direction={direction} className="max-h-[60vh]">
        <WeaveGrid ariaLabel="Atkı seçici sütunu" rows={seq.length} cols={count} cell={13} direction={direction}
          colLabel={(c) => letters[c] ?? yarnLetter(c)} colLabelColor={() => "hsl(var(--foreground))"}
          fill={(r, c) => (seq[r] === c + 1 ? yarnColor(c + 1) : null)} />
      </WeaveScrollBox>
      <div className="space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">Renk raporu {band.length > seq.length ? "(2 rapor)" : ""}</span>
        <WeaveScrollBox direction="top-down" className="p-1">
          <WeaveGrid ariaLabel="Renk raporu bandı" rows={Math.ceil(24 / bandCell)} cols={band.length} cell={bandCell} rowLabel={false} colBandEvery={seq.length} gridLines={false}
            fill={(_, c) => yarnColor(band[c]!)} />
        </WeaveScrollBox>
      </div>
      <p className="text-sm tabular-nums" data-testid="weft-pick-summary">
        {per.map((n, i) => `${letters[i] ?? yarnLetter(i)} ${formatQty(n, 0)}`).join(" · ")} = <strong>{formatQty(seq.length, 0)} atkı/rapor</strong>
      </p>
      <YarnLegend entries={per.map((n, i) => ({ color: yarnColor(i + 1), mark: letters[i] ?? yarnLetter(i), label: names[i] ?? `${i + 1}. iplik` }))} />
    </>
  );
}
