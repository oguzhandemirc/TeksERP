import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { lockSentence, lockBadge, userCanResolve } from "./lockText";
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
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="p-2 text-left">Seri</th>
            <th className="p-2 text-left">Ön ek</th>
            <th className="hidden p-2 text-left sm:table-cell">Tarih</th>
            <th className="hidden p-2 text-left sm:table-cell">Hane</th>
            <th className="p-2 text-left">Örnek</th>
            <th className="p-2 text-right">Düzenle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <NumberingRow key={r.key} row={r} onEdit={onEdit} />
          ))}
        </tbody>
      </table>
    </div>
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
    <tr className="border-t">
      <td className="p-2">
        <div className="font-medium">{row.label}</div>
        {kilit && row.lockKind && (
          <div className="mt-0.5 flex items-center gap-1.5">
            {/* Kullanıcının KENDİ çözebileceği kilit vurgulu rozet alır. */}
            <Badge
              variant={userCanResolve(row) ? "default" : "secondary"}
              className="px-1 py-0 text-[10px]"
            >
              {lockBadge(row.lockKind)}
            </Badge>
            <span className="text-xs text-muted-foreground">{kilit}</span>
          </div>
        )}
      </td>
      <td className="p-2 font-mono text-xs">{row.prefix}</td>
      <td className="hidden p-2 text-xs sm:table-cell">{row.dateSegment}</td>
      <td className="hidden p-2 text-xs sm:table-cell">{row.digits}</td>
      <td className="p-2 font-mono text-xs">{row.preview}</td>
      <td className="p-2 text-right">
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
