// Excel'den kalem yükleme — şablon indir + dosya oku.
// Ayrıştırma mantığı `receiptImport.ts`'te (saf, test edilebilir); burası yalnız
// dosya okuma + katalog toplama + sonucun RAPORLANMASI.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { loadAllForPicker } from "@/lib/picker-loader";
import { buildWorkbook, downloadWorkbook } from "@/lib/xlsx-export";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { useFoldValues } from "@/hooks/useFoldValues";
import { IMPORT_HEADERS, parseReceiptRows, type ImportRowError } from "./receiptImport";
import type { DraftLine } from "./ReceiptLineRows";

interface Props {
  onImported: (lines: DraftLine[]) => void;
}

export function ReceiptImportButton({ onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<ImportRowError[]>([]);
  const { values: foldValues } = useFoldValues();

  const itemsQ = useQuery({
    queryKey: ["items", "picker"],
    queryFn: () => loadAllForPicker(itemService),
    staleTime: 60_000,
  });
  const colorsQ = useQuery({
    queryKey: ["colors", "picker"],
    queryFn: () => loadAllForPicker(colorService),
    staleTime: 60_000,
  });

  const downloadTemplate = async () => {
    const blob = await buildWorkbook([
      {
        name: "Mal Kabul",
        columns: IMPORT_HEADERS.map((h) => ({ header: h, key: h, width: h.length + 8 })),
        // Örnek satır: kolonların ne beklediğini yazıyla anlatmaktan daha iyi anlatır.
        rows: [
          {
            "Kumaş Kodu": itemsQ.data?.data?.[0]?.code ?? "KMS-000001",
            "Kumaş Adı": "",
            Renk: colorsQ.data?.data?.[0]?.name ?? "",
            Metre: 500,
            "En (cm)": 250,
            Kg: "",
            Kat: foldValues[0]?.name ?? "",
            Adet: 20,
          },
        ],
        notes: [
          "Kumaş Kodu yazmanız yeterli — ad yalnız kod boşsa kullanılır ve birden fazla kumaşa uyuyorsa satır reddedilir.",
          "Adet = o satırdan kaç TOP geldiği. Her top ayrı barkodla, yazdığınız metrede doğar.",
          "Kg, En ve Kat boş bırakılabilir. Kat yazacaksanız katalogdaki değerlerden biri olmalı.",
          // Sınıf 5: iplik kalemi de aynı şablonla yüklenir — kural formdakiyle bire bir.
          "İPLİK kaleminde Metre kolonu KG olarak okunur; Renk, En, Kg ve Kat iplikte boş bırakılır (formda da sorulmaz).",
        ],
      },
    ]);
    downloadWorkbook(blob, "mal-kabul-sablon.xlsx");
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setErrors([]);
    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("Dosyada sayfa yok.");

      // Başlıklar ilk satırdan okunur — kolon SIRASI değil ADI bağlayıcıdır
      // (kullanıcı kolon taşımış olabilir; sıraya güvenmek sessizce yanlış
      // kolonu okumak demektir).
      const headerRow = ws.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell((cell, col) => {
        headers[col] = String(cell.text ?? "").trim();
      });

      const rows: Array<Record<string, unknown>> = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const obj: Record<string, unknown> = {};
        for (let c = 1; c < headers.length; c++) {
          const h = headers[c];
          if (!h) continue;
          const v = row.getCell(c).value;
          // Formül hücresi: sonucu al, ifadeyi değil.
          obj[h] = v && typeof v === "object" && "result" in v ? v.result : v;
        }
        rows.push(obj);
      }

      const result = parseReceiptRows(rows, {
        // `yarn` bayrağı ayrıştırıcının iplik kuralını açar (Renk/En/Kg/Kat
        // dolu iplik satırı SEBEBİYLE reddedilir, sessizce düşürülmez).
        items: (itemsQ.data?.data ?? []).map((i) => ({
          id: i.id, code: i.code, name: i.name, yarn: i.itemType === "YARN",
        })),
        colors: (colorsQ.data?.data ?? []).map((c) => ({ id: c.id, code: c.code, name: c.name })),
        folds: foldValues.map((f) => ({ code: f.code, name: f.name })),
      });

      setErrors(result.errors);
      if (result.lines.length > 0) {
        onImported(result.lines);
        // Toast İÇERİĞİ türe göre sayar (Sınıf 5): iplik satırını "top" diye
        // saymak, formun ekranda öğrettiği kuralı toast'ta yalanlamak olurdu.
        // Katalog zaten elimizde (picker) — ek istek yok; iplik yokken metin
        // bayt-bayt eski ("N kalem (M top) yüklendi.").
        const yarnIds = new Set(
          (itemsQ.data?.data ?? []).filter((i) => i.itemType === "YARN").map((i) => i.id),
        );
        const rolls = result.lines.filter((l) => !yarnIds.has(l.itemId)).reduce((s, l) => s + l.count, 0);
        const yarnCount = result.lines.filter((l) => yarnIds.has(l.itemId)).reduce((s, l) => s + l.count, 0);
        const parts = [
          ...(rolls > 0 || yarnCount === 0 ? [`${rolls} top`] : []),
          ...(yarnCount > 0 ? [`${yarnCount} iplik`] : []),
        ].join(" + ");
        toast.success(`${result.lines.length} kalem (${parts}) yüklendi.`);
      }
      // Atlanan satır SESSİZ GEÇMEZ — sayısı toast'ta, sebepleri altta durur.
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} satır alınamadı — sebepleri aşağıda.`);
      } else if (result.lines.length === 0) {
        toast.error("Dosyada okunabilir satır bulunamadı. Şablonu indirip kolon başlıklarını karşılaştırın.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dosya okunamadı.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const ready = !itemsQ.isLoading && !colorsQ.isLoading;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void downloadTemplate()}>
          <Download className="mr-1 h-4 w-4" />
          Şablon indir
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || !ready}
          onClick={() => fileRef.current?.click()}
        >
          <FileSpreadsheet className="mr-1 h-4 w-4" />
          {busy ? "Okunuyor…" : "Excel'den yükle"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </div>

      {errors.length > 0 && (
        <div className="max-h-28 overflow-auto rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
          <p className="mb-1 font-medium">Alınamayan satırlar ({errors.length}):</p>
          <ul className="space-y-0.5">
            {errors.map((e) => (
              <li key={e.row}>
                <b>Satır {e.row}:</b> {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
