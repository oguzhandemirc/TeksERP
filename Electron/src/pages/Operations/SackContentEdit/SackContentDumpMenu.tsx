import { useState } from "react";
import { PackageSearch } from "lucide-react";
import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { ExportMenu } from "@/components/data-table/ExportMenu";
import {
  dumpHasNotes,
  printSackDump,
  saveSackDumpExcel,
  saveSackDumpPdf,
  type SackDump,
} from "./sackDump";

interface Props {
  /**
   * Dökümü alınacak çuvallar. Editörde bellekteki tek çuval, listede seçili N
   * çuval. `undefined` döndüren async loader ile de kullanılabilir (bkz. `load`).
   */
  dumps?: SackDump[];
  /**
   * Liste ekranı için: aksiyon tıklanınca dökümü ÇEKEN fonksiyon (seçili çuvallar
   * için tek istek). Verilirse `dumps` yerine bu kullanılır — menü açılışında ağ
   * çağrısı yapılmaz, yalnız gerçekten indirilirken.
   */
  load?: () => Promise<SackDump[]>;
  /** Not onay kutusunu göstermek için: seçimde not var mı (liste ekranı bilir). */
  hasNotes?: boolean;
  label: string;
  disabled?: boolean;
  align?: "start" | "end";
}

/**
 * "İçerik Dökümü ▾" — çuvalın/çuvalların İÇİNDEKİ topların dökümü: Yazdır · PDF · Excel.
 *
 * Tek dropdown olarak durur: aksiyon çubuğuna üç ayrı tuş binmez ve `DataTable`'ın
 * jenerik "Seçili PDF / Seçili Excel" tuşlarıyla (onlar EKRANDAKİ LİSTEYİ indirir)
 * karışmaz — ayrı ikon + tooltip + konum.
 *
 * Çuval notu maddesi OPT-IN ve varsayılan KAPALI (kök CLAUDE.md: iç not her yerde
 * opt-in). Yalnız gerçekten not olan bir seçimde görünür — boş bir seçenek kafa
 * karıştırır (çeki listesi diyaloğundaki `notedCount > 0` kalıbı). Hiçbir yere
 * kaydedilmez; oturum içinde bileşen yaşadıkça korunur.
 */
export function SackContentDumpMenu({ dumps, load, hasNotes, label, disabled, align = "start" }: Props) {
  const [withNotes, setWithNotes] = useState(false);

  const resolve = async (): Promise<SackDump[]> => (load ? await load() : (dumps ?? []));
  // Notlu çuval yoksa açık kalmış bayrak sessizce etkisiz olsun (yanlış "dahil" izlenimi yok).
  const notesAvailable = hasNotes ?? (dumps ? dumpHasNotes(dumps) : false);
  const opts = { withNotes: withNotes && notesAvailable };

  return (
    <ExportMenu
      label={label}
      align={align}
      disabled={disabled}
      icon={<PackageSearch className="h-4 w-4" />}
      title="Çuvalın İÇİNDEKİ topların dökümü (barkod bazında) — ekrandaki liste değil"
      onPrint={async () => printSackDump(await resolve(), opts)}
      onPdf={async () => saveSackDumpPdf(await resolve(), opts)}
      onExcel={async () => saveSackDumpExcel(await resolve(), opts)}
      footer={
        notesAvailable ? (
          <DropdownMenuCheckboxItem
            checked={withNotes}
            onCheckedChange={(v) => setWithNotes(!!v)}
            onSelect={(e) => e.preventDefault()} // işaretleme menüyü kapatmasın
          >
            Çuval notunu dahil et
          </DropdownMenuCheckboxItem>
        ) : undefined
      }
    />
  );
}
