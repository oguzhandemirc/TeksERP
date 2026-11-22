// Dokuma iş emri panelinde "Yapı": iş emrinin taşıdığı kartlarla (pin) mini armür + atkı seçici + çözgü tel
// düzeni, "Desen kartını yazdır" (A4, sunucu HTML'i, `printTracked`). Görsel salt-okunurdur; ızgaraya tıklamak
// desen kartının Armür sekmesini açar. Uç düşerse bölüm "kayıt yok" demez, okunamadı der.
import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Printer } from "lucide-react";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { printTracked } from "@/lib/print";
import { WarpEndsStrip } from "@/components/weave/WarpEndsStrip";
import { WeaveGrid } from "@/components/weave/WeaveGrid";
import { WeaveScrollBox } from "@/components/weave/WeaveScrollBox";
import { YarnLegend } from "@/components/weave/YarnLegend";
import { useWeaveDirection } from "@/components/weave/weave-direction";
import { LENO_LABEL, LENO_TINT, LIFT_COLOR, yarnColor, yarnLetter } from "@/components/weave/weave-palette";
import { V3Section } from "@/pages/Operations/WorkOrders/detail-v3/V3Section";
import { constructionSlots, slotOf } from "@/components/weave/shared-palette";
import { stripYarnsOf } from "@/pages/WeaveDesigns/tabs/WarpLayersVisual";
import { WARP_LAYER_ROLE_LABEL, WEAVE_KIND_LABEL, type WarpRef } from "@/pages/WeaveDesigns/types";
import { weavingOrderService } from "../service";
import { miniLiftLayout, weaveDesignHref, type WeavingOrderConstruction } from "./construction-visual";

export const WEAVING_ORDER_CONSTRUCTION_QUERY_KEY = "weaving-order-construction";

/** `.wo-v3` ezdiği tema değişkenlerini kart görseli için geri getirir (sağlayıcı: sheet'in `--app-*`'ı). */
const APP_SCOPE = { "--border": "var(--app-border, 245 25% 91%)", "--muted": "var(--app-muted, 245 30% 96%)" } as CSSProperties;

interface Props {
  weavingOrderId: string;
  weavingOrderNumber: string;
  itemId: string;
  /** Bağlantıya geçmeden paneli kapat. */
  onNavigate: () => void;
}

export function ConstructionVisualSection({ weavingOrderId, weavingOrderNumber, itemId, onNavigate }: Props) {
  const q = useQuery({
    queryKey: [WEAVING_ORDER_CONSTRUCTION_QUERY_KEY, weavingOrderId],
    queryFn: () => weavingOrderService.construction(weavingOrderId),
  });
  const c = q.data;
  const hasAny = !!c && (!!c.weaveDesign || !!c.weft || !!c.groundWarp || c.warpLayers.length > 0);
  return (
    <V3Section title="Yapı">
      <div className="card p-3.5"><div className="space-y-3" style={APP_SCOPE} data-testid="wo-construction">
        {q.isError ? (
          <p className="text-xs text-muted-foreground">Yapı okunamadı (yetki, modül ya da ağ).</p>
        ) : q.isLoading ? (
          <p className="text-xs text-muted-foreground">Yükleniyor…</p>
        ) : !hasAny ? (
          <p className="text-xs text-muted-foreground" data-testid="wo-construction-empty">Bu işin ürününde çözgü, atkı ya da desen kartı tanımlı değil.</p>
        ) : (
          <ConstructionBody c={c!} itemId={itemId} onNavigate={onNavigate}
            print={<PrintCardButton weavingOrderId={weavingOrderId} no={c!.weavingOrderNumber ?? weavingOrderNumber} disabled={!c!.weaveDesign} />} />
        )}
      </div></div>
    </V3Section>
  );
}

function ConstructionBody({ c, itemId, onNavigate, print }: { c: WeavingOrderConstruction; itemId: string; onNavigate: () => void; print: ReactNode }) {
  const d = c.weaveDesign ?? null;
  const w = c.weft;
  const openTarget = useOpenTarget();
  const { hasPermission } = useRoleAccess();
  const canOpenDesign = !!d && hasPermission("warpspec:read");
  const openDesign = canOpenDesign
    ? (e: MouseEvent) => {
        onNavigate();
        openTarget(weaveDesignHref(d.id, itemId), e);
      }
    : undefined;
  const bands: Array<{ key: string; title: string; warp: WarpRef }> = [];
  if (c.groundWarp) bands.push({ key: "ground", title: "Zemin", warp: c.groundWarp });
  for (const l of c.warpLayers) bands.push({ key: l.warpSpec.id, title: WARP_LAYER_ROLE_LABEL[l.role] ?? l.role, warp: l.warpSpec });
  // Ortak palet: çözgü bantları harf+renk, atkı seçici renk (harfi atkı kartının kendi kodundaki harftir).
  const palette = constructionSlots(bands.map((b) => b.warp), (w?.yarns ?? []).map((y) => y.yarnItem.id));
  return (
    <>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
        {d && (<><dt className="text-muted-foreground">Desen</dt>
          <dd className="min-w-0 break-words">{d.name} <span className="text-muted-foreground">({d.code} · {WEAVE_KIND_LABEL[d.kind] ?? d.kind}{d.loomFileName ? ` · ${d.loomFileName}` : ""})</span></dd></>)}
        {w && (<><dt className="text-muted-foreground">Atkı</dt>
          <dd className="min-w-0 break-words">{w.name} <span className="text-muted-foreground">({w.code}{w.sequenceCode ? ` · ${w.sequenceCode}` : ""})</span></dd></>)}
        {c.variantCode && (<><dt className="text-muted-foreground">Varyant</dt><dd>{c.variantCode}</dd></>)}
      </dl>
      {d && <MiniLiftPlan c={c} onOpen={openDesign} weftSlots={palette.weft} />}
      {bands.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tel düzeni (çözgü raporu)</h3>
          {bands.map((b, i) => (
            <WarpEndsStrip key={b.key} maxWidth={520} title={`${b.title} · ${b.warp.name === b.title ? b.warp.code : b.warp.name}`} yarns={stripYarnsOf(b.warp)} slots={palette.warp[i]}
              endsSequence={b.warp.endsSequence ?? null} sequenceNote={b.warp.sequenceNote} cardEnds={b.warp.endsCount} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {print}
        {openDesign && (
          <button type="button" className="btn sm" onClick={openDesign}>
            <ExternalLink className="h-3.5 w-3.5" /> Desen kartında aç
          </button>
        )}
      </div>
    </>
  );
}

/** Küçük karede iki haneli çerçeve noları sıkışmasın: yalnız çiftler yazılır. */
const frameLabel = (n: number, cell: number) => (n < 10 || cell >= 14 || n % 2 === 0 ? String(n) : null);

function MiniLiftPlan({ c, onOpen, weftSlots }: { c: WeavingOrderConstruction; onOpen?: (e: MouseEvent) => void; weftSlots: readonly number[] }) {
  const weftColor = (n: number) => yarnColor(slotOf(weftSlots, n));
  const [direction] = useWeaveDirection();
  const d = c.weaveDesign!;
  const leno = d.lenoFrames ?? [];
  const yarns = c.weft?.yarns ?? [];
  const seq = c.weft?.pickSequence ?? null;
  const lay = miniLiftLayout(d.liftPlan, leno, seq, yarns.length);
  if (!lay) return <p className="text-xs text-muted-foreground">Desen kartında armür planı girilmemiş.</p>;
  const plan = d.liftPlan!;
  const lenoSet = new Set(leno);
  const grid = (
    <WeaveGrid ariaLabel={`Armür planı: ${lay.rows} atkı, ${lay.frames} çerçeve${lay.selCols ? ", atkı seçici" : ""}`}
      rows={lay.rows} cols={lay.cols} cell={lay.cell} direction={direction} colGapsBefore={lay.gaps}
      colTint={(col) => (col < lay.frames && lenoSet.has(col + 1) ? LENO_TINT : null)}
      colLabel={(col) => (col >= lay.frames ? yarnLetter(col - lay.frames) : frameLabel(col + 1, lay.cell))}
      colLabelColor={(col) => (col < lay.frames && lenoSet.has(col + 1) ? LENO_LABEL : undefined)}
      fill={(r, col) => {
        if (col < lay.frames) return plan[r]?.[col] === 1 ? LIFT_COLOR : null;
        const n = col - lay.frames + 1;
        return seq?.[r] === n ? weftColor(n) : null;
      }} />
  );
  return (
    <div className="space-y-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Armür planı{lay.selCols ? " + atkı seçici" : ""} <span className="font-normal normal-case">· atkı 1 {direction === "bottom-up" ? "altta" : "üstte"}</span>
      </h3>
      <WeaveScrollBox direction={direction} className="max-h-[400px] p-1.5">
        {onOpen ? (
          <button type="button" onClick={onOpen} title="Desen kartının Armür sekmesinde aç" aria-label="Armür planını desen kartında aç"
            className="block cursor-pointer rounded-sm hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" data-testid="wo-construction-lift">
            {grid}
          </button>
        ) : <div data-testid="wo-construction-lift">{grid}</div>}
      </WeaveScrollBox>
      <YarnLegend entries={[
        { color: LIFT_COLOR, label: "Çerçeve kalkık" },
        ...(lenoSet.size > 0 ? [{ color: LENO_TINT, label: "Döner çerçeve" }] : []),
        ...yarns.map((y, i) => ({ color: weftColor(i + 1), mark: y.letter || yarnLetter(i), label: `${y.yarnItem.name} (atkı)` })),
      ]} />
    </div>
  );
}

function PrintCardButton({ weavingOrderId, no, disabled }: { weavingOrderId: string; no: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const print = async () => {
    setBusy(true);
    try {
      const html = await weavingOrderService.cardHtml(weavingOrderId);
      await printTracked({ subject: { kind: "DESEN_KARTI", no }, html });
    } catch {
      /* hata toast'ını apiClient gösterir */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn sm" disabled={disabled || busy} onClick={() => void print()} data-testid="wo-print-card"
      title={disabled ? "Bu işin desen kartı yok" : "Bu işin kartlarıyla A4 desen kartını bas"}>
      <Printer className="h-3.5 w-3.5" /> Desen kartını yazdır
    </button>
  );
}
