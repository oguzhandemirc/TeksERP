// =============================================================================
// SAYIM KÂĞIDI — SATIR TABLOLARI (top + iplik)
// =============================================================================
// İki tablo, çünkü İKİ FARKLI SORU sorulur ve iki farklı birimle cevaplanır:
//   • TOP  → "var mı, yok mu" (ikili karar; metraj sayımın konusu DEĞİL)
//   • İPLİK→ "kaç kg çıktı" (ölçüm; fark defterin kendisine yazılır)
// Tek tabloda birleştirmek, kg ile metreyi aynı kolonda toplayan bir yüzey
// üretirdi (bu projede yazılı yasak).
//
// ⚠️ TOP SATIRINDA METRAJ SALT-OKUNURDUR. Sayım metraja DOKUNMAZ: metraj
// düzeltmesi ayrı bir akıştır (Envanter → "Metrajı düzelt", kendi sapma kaydı ve
// kendi izniyle). Buraya bir metraj kutusu koymak, aynı işi iki farklı defterle
// yapan ikinci bir yol açardı.
//
// ⚠️ ÜÇ DURUMLU İŞARET ve geri alınabilirliği: "Bulundu" / "Eksik" tuşlarına
// İKİNCİ KEZ basmak işareti KALDIRIR (`found: null`). Tek yönlü bir işaret,
// yanlışlıkla "eksik" işaretlenen bir topu tamamlamada kayıttan düşürürdü ve
// operatörün geri dönüşü olmazdı.
// =============================================================================
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StockCountLine, StockCountStatus } from "./service";
import {
  countedQtyHint,
  lineLabel,
  parseCountedQty,
  qty,
  rollLineState,
  rollStateLabel,
  subtractQty,
  yarnLineState,
  yarnStateLabel,
  type RollLineState,
  type YarnLineState,
} from "./stockCountRules";

const ROLL_TONE: Record<RollLineState, string> = {
  FOUND: "text-emerald-700 dark:text-emerald-400",
  MISSING: "text-destructive",
  OUT_OF_SCOPE: "text-amber-700 dark:text-amber-500",
  UNCOUNTED: "text-muted-foreground",
};

const YARN_TONE: Record<YarnLineState, string> = {
  APPLIED: "text-amber-700 dark:text-amber-500",
  MATCH: "text-emerald-700 dark:text-emerald-400",
  OUT_OF_SCOPE: "text-amber-700 dark:text-amber-500",
  UNCOUNTED: "text-muted-foreground",
};

interface RollProps {
  lines: StockCountLine[];
  status: StockCountStatus;
  /** Yalnız taslakta ve yazma yetkisi varsa dolu gelir. */
  onMark?: (lineId: string, found: boolean | null) => void;
  /** En son okutulan satır — listede gözle bulunabilsin diye vurgulanır. */
  highlightLineId?: string | null;
  pendingLineId?: string | null;
}

export function RollLinesTable({ lines, status, onMark, highlightLineId, pendingLineId }: RollProps) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2 text-left">Barkod</th>
            <th className="p-2 text-left">Ürün / Renk</th>
            <th className="p-2 text-right">Metre</th>
            <th className="p-2 text-left">Durum</th>
            {onMark && <th className="p-2 text-right">İşaret</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const state = rollLineState(l);
            return (
              <tr
                key={l.id}
                className={cn(
                  "border-t",
                  highlightLineId === l.id && "bg-primary/10",
                  pendingLineId === l.id && "opacity-60",
                )}
              >
                <td className="p-2 font-mono text-xs">{l.roll?.barcode ?? "—"}</td>
                <td className="p-2">{lineLabel(l)}</td>
                <td className="p-2 text-right tabular-nums">{qty(l.expectedQty)}</td>
                <td className={cn("p-2 text-xs", ROLL_TONE[state])}>
                  {rollStateLabel(state, status)}
                  {/* Kapsam dışı satırda SEBEP de basılır: "işlenmedi" demek
                      yetmez — kâğıtta olduğu gibi ekranda da nedeni yazar. */}
                  {l.outOfScopeReason && (
                    <span className="ml-1 text-muted-foreground">({l.outOfScopeReason})</span>
                  )}
                  {l.notes && <span className="ml-1 text-muted-foreground">· {l.notes}</span>}
                </td>
                {onMark && (
                  <td className="p-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={l.found === true ? "default" : "outline"}
                        className="h-7 px-2"
                        title={l.found === true ? "İşareti kaldır" : "Bulundu olarak işaretle"}
                        aria-label={`Bulundu: ${l.roll?.barcode ?? lineLabel(l)}`}
                        onClick={() => onMark(l.id, l.found === true ? null : true)}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={l.found === false ? "destructive" : "outline"}
                        className="h-7 px-2"
                        title={
                          l.found === false
                            ? "İşareti kaldır"
                            : "Bulunamadı — tamamlamada kayıttan düşülecek"
                        }
                        aria-label={`Eksik: ${l.roll?.barcode ?? lineLabel(l)}`}
                        onClick={() => onMark(l.id, l.found === false ? null : false)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface YarnProps {
  lines: StockCountLine[];
  status: StockCountStatus;
  /** `wire` NOKTALI string'dir (backend Decimal'e çevirir); `null` = temizle. */
  onCount?: (lineId: string, wire: string | null) => void;
  pendingLineId?: string | null;
}

export function YarnLinesTable({ lines, status, onCount, pendingLineId }: YarnProps) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2 text-left">İplik</th>
            <th className="p-2 text-right">Defter (kg)</th>
            <th className="p-2 text-right">Sayılan (kg)</th>
            <th className="p-2 text-right">Fark</th>
            <th className="p-2 text-left">Durum</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <YarnLineRow
              key={l.id}
              line={l}
              status={status}
              onCount={onCount}
              pending={pendingLineId === l.id}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function YarnLineRow({
  line,
  status,
  onCount,
  pending,
}: {
  line: StockCountLine;
  status: StockCountStatus;
  onCount?: (lineId: string, wire: string | null) => void;
  pending: boolean;
}) {
  const serverText = line.countedQty == null ? "" : String(line.countedQty);
  const [text, setText] = useState(serverText);

  // Sunucu değeri değişince kutu ONA döner (kaydettikten sonra normalize edilmiş
  // hâli görünsün). Kullanıcı yazarken tetiklenmez: bağımlılık YALNIZ sunucu
  // değeridir, yerel metin değil.
  useEffect(() => setText(serverText), [serverText]);

  const parsed = parseCountedQty(text);
  const hint = countedQtyHint(text);
  const state = yarnLineState(line);
  const diff = line.countedQty == null ? null : subtractQty(line.countedQty, line.expectedQty);

  const commit = () => {
    if (!onCount) return;
    const trimmed = text.trim();
    if (trimmed === "") {
      // BOŞ = "saymadım"a geri dön. Sıfıra çevirmek, sayılmamış bir kalemi
      // "sıfır saydım" yapıp bakiyeyi sıfırlayan bir düzeltme doğururdu.
      if (line.countedQty != null) onCount(line.id, null);
      return;
    }
    if (!parsed) return; // geçersiz biçim — ipucu zaten basılıyor
    if (parsed.wire === serverText) return; // değişmedi → boş istek atma
    onCount(line.id, parsed.wire);
  };

  return (
    <tr className={cn("border-t", pending && "opacity-60")}>
      <td className="p-2">
        {line.item?.name ?? "—"}
        {line.item?.code && (
          <span className="ml-1 font-mono text-xs text-muted-foreground">{line.item.code}</span>
        )}
      </td>
      <td className="p-2 text-right tabular-nums">{qty(line.expectedQty)}</td>
      <td className="p-2 text-right">
        {onCount ? (
          <div className="flex flex-col items-end">
            <Input
              className="h-8 w-28 text-right tabular-nums"
              inputMode="decimal"
              aria-label={`Sayılan kg: ${line.item?.name ?? ""}`}
              placeholder="—"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
            />
            {hint && <span className="mt-0.5 max-w-[16rem] text-[11px] text-destructive">{hint}</span>}
          </div>
        ) : (
          <span className="tabular-nums">{line.countedQty == null ? "—" : qty(line.countedQty)}</span>
        )}
      </td>
      <td className="p-2 text-right tabular-nums">
        {/* Kapsam dışı satırda FARK BASILMAZ — hesaplanmış ama UYGULANMAMIŞ bir
            sayı, uygulanmış gibi okunurdu (donmuş belgedeki kuralın aynısı). */}
        {state === "OUT_OF_SCOPE" || diff == null ? "—" : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${qty(Math.abs(diff))}`}
      </td>
      <td className="p-2 text-xs">
        <span className={YARN_TONE[state]}>{yarnStateLabel(state, status)}</span>
        {line.outOfScopeReason && (
          <span className="ml-1 text-muted-foreground">({line.outOfScopeReason})</span>
        )}
      </td>
    </tr>
  );
}

/** Küçük durum rozeti — başlıkta sayaçların yanında. */
export function CountBadge({ label, value }: { label: string; value: number }) {
  return (
    <Badge variant="muted" className="gap-1">
      <span className="text-muted-foreground">{label}</span>
      <b className="tabular-nums">{value}</b>
    </Badge>
  );
}
