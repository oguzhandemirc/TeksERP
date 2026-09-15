// =============================================================================
// SÜZGEÇ ŞERHLERİ — EKRANDA, çıktıdakiyle AYNI dizi
// =============================================================================
// Aynı diziyi hem buraya hem `ReportExportSpec.meta`ya veririz: ekranda yazıp
// kâğıtta yazmamak, tek başına paylaşılan dosyada UYARISIZ rapor demektir.
// =============================================================================
export function ReportFilterNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      {notes.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
    </ul>
  );
}
