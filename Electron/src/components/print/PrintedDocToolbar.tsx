import type { ReactNode } from "react";
import { ChevronDown, Download, FileDown, Printer, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { printHtmlString } from "@/lib/print";
import { usePdfSave } from "@/components/print/PdfSaveButton";
import { PrintPageSizeToggle, type DocPageSize } from "@/components/print/PrintPageSizeToggle";

// =============================================================================
// Belge araç çubuğu — TEK ÇUBUK: [Yazdır ▾] [İndir ▾] [Baskı seçenekleri ▾] [A4|A5]
// =============================================================================
// Eskiden bu kalemler diyalog gövdesine dikey olarak serpiliyordu (not alanı,
// iki tik, footer) ve her belge yüzeyi kendi düzenini kuruyordu. Çubuk tek
// yerde yaşar; belge türüne özgü kalemler SLOT ile gelir — jenerik bileşen
// hiçbir belge türünü tanımaz.
// =============================================================================

interface Props {
  html: string | null;
  /** PDF kaydet dialoğuna önerilen dosya adı. */
  fileName: string;
  /** Yeni HTML çekiliyor — kâğıt boyu düğmesi kilitlenir (yarış önlenir). */
  fetching?: boolean;
  /** "Yazdır ▾" menüsüne ek kalemler (verilmezse düğme sade kalır, menü açılmaz). */
  printMenu?: ReactNode;
  /** "İndir ▾" menüsüne ek kalemler (Excel vb.). */
  downloads?: ReactNode;
  /** "Baskı seçenekleri ▾" popover'ının gövdesi (verilmezse düğme çizilmez). */
  optionsContent?: ReactNode;
  pageSize: DocPageSize | undefined;
  onPageSizeChange: (next: DocPageSize | undefined) => void;
  docPageSize: DocPageSize | undefined;
}

export function PrintedDocToolbar({
  html,
  fileName,
  fetching = false,
  printMenu,
  downloads,
  optionsContent,
  pageSize,
  onPageSizeChange,
  docPageSize,
}: Props) {
  const pdf = usePdfSave(html, fileName);
  const print = () => html && printHtmlString(html);

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      {printMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" className="gap-1.5">
              <Printer className="h-4 w-4" /> Yazdır <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem disabled={!html} onSelect={print} className="gap-2">
              <Printer className="h-4 w-4" /> Belgeyi yazdır
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {printMenu}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button type="button" size="sm" className="gap-1.5" disabled={!html} onClick={print}>
          <Printer className="h-4 w-4" /> Yazdır
        </Button>
      )}

      {(pdf.available || downloads) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="gap-1.5">
              <Download className="h-4 w-4" /> İndir <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {pdf.available && (
              <DropdownMenuItem disabled={!html || pdf.busy} onSelect={() => void pdf.save()} className="gap-2">
                <FileDown className="h-4 w-4" /> {pdf.busy ? "PDF…" : "PDF kaydet"}
              </DropdownMenuItem>
            )}
            {downloads}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {optionsContent && (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Baskı seçenekleri
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-96 space-y-3 p-3 text-xs">
            {optionsContent}
          </PopoverContent>
        </Popover>
      )}

      {/* Tek seferlik kâğıt boyu — kalıcı ayarı da donmuş belgeyi de DEĞİŞTİRMEZ. */}
      <PrintPageSizeToggle
        value={pageSize}
        onChange={onPageSizeChange}
        docPageSize={docPageSize}
        disabled={!html || fetching}
        label="Kâğıt:"
      />
    </div>
  );
}

/** Tek-seferlik satır bayrağı kutucuğu (çuval notu / izi) — baskı seçenekleri içinde. */
export function RowFlagCheck({
  id,
  checked,
  onChange,
  icon,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <div className="border-t pt-2.5">
      <label htmlFor={id} className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5"
        />
        <span className="min-w-0 flex-1 cursor-pointer">
          <span className="flex items-center gap-1.5 font-medium">{icon} {label}</span>
          <span className="block text-[10px] text-muted-foreground">{hint}</span>
        </span>
      </label>
    </div>
  );
}
