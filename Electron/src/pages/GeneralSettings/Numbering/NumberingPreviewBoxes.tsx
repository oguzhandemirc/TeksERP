/**
 * İKİ NUMARA KUTUSU — iki AYRI soru (K19, 2026-09-23).
 *
 * "Biçim örneği" kodun ŞEKLİNİ gösterir ve hep sıra 1'dir; "sıradaki numara" bir
 * sonraki kaydın GERÇEK numarasıdır. Tek kutu varken kullanıcı örneği sıradaki
 * sanıyordu (ekranda `PZ-1`, açılan kayıt `PZ-4` — d3 ölçtü). Ölçülemeyen seride
 * (kendi sayaç mekanizması olan) "—" yazılır; sayı UYDURULMAZ.
 */
export function NumberingPreviewBoxes({
  preview,
  next,
  warnings = [],
}: {
  preview: string;
  next: string | null;
  /** Sunucunun önizleme notu (engel değil): etikete SIĞMAYAN biçim — yazarken görünür, tost olmaz. */
  warnings?: string[];
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border bg-muted/40 p-3 text-center">
          <div className="text-xs text-muted-foreground">Biçim örneği</div>
          <div className="font-mono text-xl font-semibold tracking-wide">{preview || "—"}</div>
        </div>
        <div className="rounded-md border bg-muted/40 p-3 text-center">
          <div className="text-xs text-muted-foreground">Sıradaki numara</div>
          <div className="font-mono text-xl font-semibold tracking-wide">{next ?? "—"}</div>
        </div>
      </div>
      {warnings.length > 0 && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {warnings.join(" · ")}
        </p>
      )}
    </div>
  );
}
