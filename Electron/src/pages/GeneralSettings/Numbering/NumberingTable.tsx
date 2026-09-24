import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { lockSentence, lockBadge, userCanResolve } from "./lockText";
import { LockInfo } from "./LockInfo";
import type { NumberSeriesRow } from "./types";

/**
 * Seri tablosu. ⚠️ KİLİTLİ SATIR DA ÇİZİLİR — süzgeç YOK. Gerekçe sayfanın
 * başlığında; burada yalnız uygulanıyor.
 */
export function NumberingTable({
  rows,
  onEdit,
}: {
  rows: NumberSeriesRow[];
  onEdit: (row: NumberSeriesRow) => void;
}) {
  return (
    <table className="w-full table-fixed text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="px-4 py-2 text-left font-medium">Seri</th>
          <th className="w-24 px-3 py-2 text-left font-medium">Ön ek</th>
          <th className="hidden w-24 px-3 py-2 text-left font-medium sm:table-cell">Tarih</th>
          <th className="hidden w-16 px-3 py-2 text-left font-medium sm:table-cell">Hane</th>
          <th className="w-52 px-3 py-2 text-left font-medium">Örnek</th>
          <th className="w-28 px-4 py-2 text-right font-medium">
            <span className="sr-only">Düzenle</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((r) => (
          <NumberingRow key={r.key} row={r} onEdit={onEdit} />
        ))}
      </tbody>
    </table>
  );
}

function NumberingRow({
  row,
  onEdit,
}: {
  row: NumberSeriesRow;
  onEdit: (row: NumberSeriesRow) => void;
}) {
  const kilit = row.lockKind ? lockSentence(row) : null;
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-2.5 align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{row.label}</span>
          {kilit && row.lockKind && (
            <span className="inline-flex items-center gap-1">
              {/* Kullanıcının KENDİ çözebileceği kilit vurgulu rozet alır. */}
              <Badge
                variant={userCanResolve(row) ? "default" : "secondary"}
                className="shrink-0 whitespace-nowrap px-1.5 py-0 text-[10px]"
              >
                {lockBadge(row.lockKind)}
              </Badge>
              <LockInfo text={kilit} />
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 align-top font-mono text-xs">{row.prefix}</td>
      <td className="hidden px-3 py-2.5 align-top text-xs sm:table-cell">{row.dateSegment}</td>
      <td className="hidden px-3 py-2.5 align-top text-xs sm:table-cell">{row.digits}</td>
      <td className="px-3 py-2.5 align-top font-mono text-xs">
        {row.preview}
        {/* TÜKENME LİSTEDE de görünür (K8): biçimi kilitli seride (top barkodu)
            kullanıcı kapasitenin dolduğunu başka hiçbir yerde göremiyordu. */}
        {row.exhaustion?.warn && (
          <div className="mt-0.5 text-[10px] font-medium text-destructive">
            {row.exhaustion.used?.toLocaleString("tr-TR")}/{row.exhaustion.limit?.toLocaleString("tr-TR")} — sınıra yaklaşıldı
          </div>
        )}
        {row.pending && (
          <div className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">
            {new Date(row.pending.effectiveFrom).toLocaleDateString("tr-TR")} → {row.pending.preview}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-right align-top">
        {/* ⚠️ BİÇİM kilidi satırı kapatmaz: sayaç ayarları AYRI bir kilide tabi
            ve biçimi kilitli 46 seride AÇIK. Yalnız `editable`a bakan bir düğme,
            motoru olan ama çıkış yüzeyi olmayan bir yetenek üretirdi. */}
        <Button
          size="sm"
          variant="outline"
          disabled={!row.editable && !row.counter.startValue}
          onClick={() => onEdit(row)}
        >
          Düzenle
        </Button>
      </td>
    </tr>
  );
}
