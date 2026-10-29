// Excel'den satır yükleme (ReceiptImportButton deseni): şablon indir + dosya oku + TOPLU gönder.
// Parti token'ı deneme başına: belirsiz hatada aynı token'la tekrar → sunucu satırları ikilemez.
import { useRef, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildWorkbook, downloadWorkbook } from "@/lib/xlsx-export";
import { useAttemptToken } from "@/lib/attemptToken";
import { addLines } from "./service";
import { LINE_IMPORT_HEADERS, parseLineRows, type LineImportError } from "./lineImport";

async function downloadTemplate() {
  const blob = await buildWorkbook([
    {
      name: "Gelen Belge",
      columns: LINE_IMPORT_HEADERS.map((h) => ({ header: h, key: h, width: h.length + 8 })),
      rows: [{ Blok: 1, "Top No": "1", Metre: 120.5, Kilo: "", "En (cm)": "", Kumaş: "", Renk: "" }],
      notes: ["Metre zorunlu; ondalık virgül ya da nokta. Blok boşsa 1.", "Kumaş/Renk belgedeki yazıyla girilir; eşleme ekranda önerilir."],
    },
  ]);
  downloadWorkbook(blob, "gelen-belge-sablon.xlsx");
}

/** İlk sayfanın 1. satırı başlık; kalan satırlar başlık→değer nesnesi (formül hücresinde sonuç). */
async function readSheetRows(file: File): Promise<Array<Record<string, unknown>>> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Dosyada sayfa yok.");
  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cell.text ?? "").trim();
  });
  const rows: Array<Record<string, unknown>> = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, c) => {
      if (!h) return;
      const v = ws.getRow(r).getCell(c).value;
      obj[h] = v && typeof v === "object" && "result" in v ? v.result : v;
    });
    rows.push(obj);
  }
  return rows;
}

export function LineImportButton({ noteId, onImported }: { noteId: string; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<LineImportError[]>([]);
  const attempt = useAttemptToken();

  const handleFile = async (file: File) => {
    setBusy(true);
    setErrors([]);
    try {
      const rows = await readSheetRows(file);
      const result = parseLineRows(rows);
      setErrors(result.errors);
      if (result.lines.length > 0) {
        try {
          await addLines(noteId, result.lines, attempt.token());
          attempt.onSuccess();
        } catch (e) {
          attempt.onFailure(e);
          return;
        }
        toast.success(`${result.lines.length} satır yüklendi.`);
        onImported();
      }
      if (result.errors.length > 0) toast.warning(`${result.errors.length} satır atlandı — sebepler aşağıda.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dosya okunamadı.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void downloadTemplate()}>
          <Download className="mr-1 h-4 w-4" />
          Şablon
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <FileSpreadsheet className="mr-1 h-4 w-4" />
          Excel'den yükle
        </Button>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])} />
      </div>
      {errors.length > 0 && (
        <ul className="text-xs text-destructive">
          {errors.map((er) => (
            <li key={`${er.row}:${er.message}`}>{er.row > 0 ? `Satır ${er.row}: ` : ""}{er.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
