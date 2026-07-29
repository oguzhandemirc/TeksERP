import { useState } from "react";
import { Download, FileSpreadsheet, FileText, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

/**
 * "İndir ▾" → format seçimi (PDF / Excel). Seçilen formatın callback'ini çağırır;
 * İKİSİNİ BİRDEN indirmez (kullanıcı her seferinde formatı seçer). Callback async
 * olabilir; çalışırken buton "İndiriliyor…" ve pasif olur.
 */
export function ExportMenu({
  label = "İndir",
  onPdf,
  onExcel,
  disabled,
  size = "sm",
  variant = "outline",
  align = "end",
  busyLabel,
}: {
  label?: string;
  onPdf: () => unknown;
  onExcel: () => unknown;
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
  align?: "start" | "end";
  /** Çalışırken "İndiriliyor…" yerine gösterilecek metin (ör. "12.500 / ~30.000").
   *  Büyük "tümünü indir"de ilerleme için — çağıran reaktif olarak günceller. */
  busyLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => unknown) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size={size} variant={variant} className="gap-1.5" disabled={disabled || busy}>
          <Download className="h-4 w-4" /> {busy ? busyLabel ?? "İndiriliyor…" : label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem onSelect={() => void run(onPdf)} className="gap-2">
          <FileText className="h-4 w-4 text-destructive" /> PDF
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run(onExcel)} className="gap-2">
          <FileSpreadsheet className="h-4 w-4 text-success" /> Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
