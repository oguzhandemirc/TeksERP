// Formun sağ sütunundaki "Görünüm" kartı: tel düzeni şeridi + tarak planı. Kayıtlı kartın açılımı
// SUNUCUDAN (`GET /api/warp-specs/:id` → `endsSequence`); iplik satırı ya da dizilim değişmişse kayıtlı
// açılım eskidir → oransal blok + "kaydedince çözülür" (istemci notu açmaz).
import { useQuery } from "@tanstack/react-query";
import { useFormContext, useWatch } from "react-hook-form";
import { Grid3x3 } from "lucide-react";
import { WarpEndsStrip } from "@/components/weave/WarpEndsStrip";
import { ReedPlan } from "@/components/weave/ReedPlan";
import { parseInput } from "@/pages/Operations/WarpPlan/warp-plan-model";
import { buildDefaults } from "./payload";
import type { WarpSpecFormValues } from "./schema";
import { warpSpecService } from "./service";
import type { WarpSpec } from "./types";
import { totalEnds } from "./YarnRowsEditor";
import { useWarpCalc } from "./useWarpCalc";

type YarnRows = WarpSpecFormValues["yarns"];
const rowsKey = (rows: YarnRows) => rows.map((r) => `${r.yarnItemId}:${String(r.endsCount ?? "").trim()}`).join("|");

/** Kayıtlı açılım bu form değerleri için hâlâ geçerli mi (satır kümesi ve dizilim kayıttakiyle aynı). */
export function isSavedLayout(initial: WarpSpec | null | undefined, yarns: YarnRows, note: string | undefined): boolean {
  if (!initial) return false;
  const saved = buildDefaults(initial);
  return rowsKey(saved.yarns) === rowsKey(yarns) && (saved.sequenceNote ?? "").trim() === (note ?? "").trim();
}

const intOf = (v: unknown): number | null => {
  const n = parseInput(String(v ?? ""));
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};

export function WarpSpecVisualPanel({ initial }: { initial?: WarpSpec | null }) {
  const { control } = useFormContext<WarpSpecFormValues>();
  const { yarns, per1000 } = useWarpCalc();
  const [note, endsPerDent, reedNo, selvedge] = useWatch({ control, name: ["sequenceNote", "endsPerDent", "reedNo", "selvedgeEnds"] });
  const detail = useQuery({
    queryKey: ["warp-specs", "detail", initial?.id],
    queryFn: () => warpSpecService.getById(initial!.id),
    enabled: !!initial?.id,
    staleTime: 30_000,
  });
  const saved = isSavedLayout(initial, yarns, note);
  const serverSeq = detail.data?.data?.endsSequence;
  const seq = saved ? (serverSeq ?? null) : null;
  // Yükleniyor / eski sunucu (alan yok) "dizilim okunamadı" demesin.
  const hint = !saved ? undefined
    : detail.isLoading ? "Dizilim yükleniyor…"
    : detail.data && serverSeq === undefined ? "Tel tel dizilim sunucu güncellenince görünür; şimdilik ipliklerin tel payı gösteriliyor."
    : undefined;
  const nameOf = (id: string) =>
    per1000?.yarns.find((y) => y.yarnItemId === id)?.name
    ?? initial?.yarns?.find((y) => y.yarnItemId === id)?.yarnItem?.name
    ?? (id ? "İplik" : "İplik seçilmedi");
  const stripYarns = yarns.map((r) => ({ label: nameOf(r.yarnItemId), endsCount: intOf(r.endsCount) ?? 0 }));
  const total = totalEnds(yarns);
  return (
    <aside className="rounded-xl border border-card-border bg-card shadow-card" aria-label="Görünüm" data-testid="warp-visual-panel">
      <header className="flex items-center gap-2 border-b px-5 py-2.5">
        <Grid3x3 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Görünüm</h3>
        <span className="ml-auto text-xs text-muted-foreground">tel düzeni · tarak</span>
      </header>
      <div className="space-y-4 px-5 py-4">
        <section className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tel düzeni (çözgü raporu)</h4>
          <WarpEndsStrip yarns={stripYarns} endsSequence={seq} sequenceNote={note} pending={!saved} fallbackHint={hint} maxWidth={300} />
        </section>
        <section className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tarak planı</h4>
          <ReedPlan endsPerDent={intOf(endsPerDent)} reedNo={reedNo} totalEnds={total} selvedgeEnds={intOf(selvedge)} endsSequence={seq} maxWidth={300} />
        </section>
      </div>
    </aside>
  );
}
