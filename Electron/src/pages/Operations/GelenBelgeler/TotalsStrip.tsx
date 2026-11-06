// Toplam fark şeridi (canlı): onay kapısının hükmü backend `totalsCheck`ten — panel yeniden hesaplamaz; satır yazımı
// detay sorgusunu tazeler, şerit onunla değişir. Eski backend alanı göndermezse şerit çizilmez.
import { blockSummary, describeDiff } from "./reviewView";
import { blockChipLabel } from "./noteLines";
import type { DocumentCheck, TotalsCheck } from "./reviewTypes";

const HEAD = {
  ok: { cls: "border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300", text: "Toplamlar tutuyor" },
  bad: { cls: "border-destructive bg-destructive/10 text-destructive", text: "Toplamlar tutmuyor — onayda fark gerekçesi istenir" },
  badClosed: { cls: "border-destructive bg-destructive/10 text-destructive", text: "Toplamlar tutmuyor" },
  none: { cls: "bg-muted/40 text-muted-foreground", text: "Belgede toplam beyanı yok — doğrulanamaz" },
} as const;

/**
 * `approvable` false (onaylanmış belge): onay yönergesi ("fark gerekçesi istenir") basılmaz, yalnız hüküm kalır.
 * `partiesShown`: Partiler kartı çiziliyse parti (blok) kartları orada — aynı veri iki terimle iki yerde görünmesin.
 */
export function TotalsStrip({ check, approvable = true, partiesShown = false }: { check: TotalsCheck | undefined; approvable?: boolean; partiesShown?: boolean }) {
  if (!check) return null;
  const blocks = partiesShown ? [] : check.blocks;
  const head = check.ok === true ? HEAD.ok : check.ok === false ? (approvable ? HEAD.bad : HEAD.badClosed) : HEAD.none;
  return (
    <div className="flex flex-col gap-2" data-testid="totals-strip" data-ok={check.ok === null ? "unknown" : String(check.ok)}>
      <div className={`rounded-md border px-3 py-2 text-sm font-medium ${head.cls}`} data-testid="totals-verdict">
        {head.text}
      </div>
      <div className="flex flex-wrap gap-2">
        {blocks.map((b, i) => (
          <div
            key={`${b.blockNo}-${i}`}
            data-testid={`block-${b.blockNo}`}
            data-ok={b.ok === null ? "unknown" : String(b.ok)}
            className={`rounded-md border px-3 py-2 text-xs ${b.ok === false ? "border-destructive bg-destructive/10" : b.ok ? "border-emerald-500 bg-emerald-500/10" : "bg-muted/40"}`}
          >
            <div className="font-medium">{blockChipLabel(b.blockNo, blocks.length)}</div>
            <div className="tabular-nums">{blockSummary(b)}</div>
            {b.ok === null && <div className="text-muted-foreground">Beyan yok — doğrulanamaz</div>}
            {b.ok === true && <div className="text-emerald-700 dark:text-emerald-400">Beyanla tutuyor</div>}
            {b.diffs.map((d) => (
              <div key={d.field} className="text-destructive tabular-nums">
                {describeDiff(d)}
              </div>
            ))}
          </div>
        ))}
        {check.document && <DocumentCard doc={check.document} />}
        {check.warnings.map((w) => (
          <div key={w} className="rounded-md border border-amber-500 bg-amber-500/10 px-3 py-2 text-xs">
            {w} (uyarı)
          </div>
        ))}
      </div>
    </div>
  );
}

/** Başlıktaki belge geneli beyan (ör. "Müşteri MT 238") ↔ bütün satırlar — hüküm backend `totalsCheck.document`. */
function DocumentCard({ doc }: { doc: DocumentCheck }) {
  const names = Object.values(doc.labels).filter(Boolean).join(" · ");
  // Fabrika ayarı INFO (varsayılan): fark bilgi tonunda, onayı engellemez; eski backend `blocking` göndermez → kırmızı.
  const info = doc.ok === false && doc.blocking === false;
  const tone = info ? "border-amber-500 bg-amber-500/10" : doc.ok === false ? "border-destructive bg-destructive/10" : doc.ok ? "border-emerald-500 bg-emerald-500/10" : "bg-muted/40";
  return (
    <div data-testid="block-document" data-ok={doc.ok === null ? "unknown" : String(doc.ok)} data-blocking={String(doc.blocking !== false)} className={`rounded-md border px-3 py-2 text-xs ${tone}`}>
      <div className="font-medium">Belge geneli{names ? ` (${names})` : ""}</div>
      <div className="tabular-nums">{blockSummary({ blockNo: 0, ...doc })}</div>
      {doc.ok === true && <div className="text-emerald-700 dark:text-emerald-400">Beyanla tutuyor</div>}
      {info && <div className="text-amber-800 dark:text-amber-300">Bilgi — onayı engellemez</div>}
      {doc.diffs.map((d) => (
        <div key={d.field} className={`${info ? "text-amber-800 dark:text-amber-300" : "text-destructive"} tabular-nums`}>
          {describeDiff(d)}
        </div>
      ))}
    </div>
  );
}
