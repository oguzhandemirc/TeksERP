// =============================================================================
// PORTFÖY LİSTESİ
// =============================================================================
// ⚠️ AKSİYONLAR DURUMA GÖRE ÇİZİLİR (`transitions.availableActions`). Terminal
// durumdaki satırda menü HİÇ ÇİZİLMEZ — gri bir düğme "burada bir yol var ama
// sana kapalı" der, oysa gerçek şudur: o çekin işi bitmiştir ve kimse için bir
// yol yoktur. (Tek istisna COLLECTED — K-2 tahsil stornosu; menüde yalnız
// "Tahsili Geri Al" görünür.)
//
// ⚠️ NEDEN AÇILIR MENÜ, NEDEN SIRA SIRA DÜĞME DEĞİL: elimizdeki bir çekte aynı
// anda ALTI meşru işlem olabilir (bankaya ver · tahsil · ciro · karşılıksız ·
// iade · iptal). Altı düğme satırı okunamaz hale getirir ve yanlış düğmeye
// basma riskini artırır — bunlar geri alınamayan işlemler.
//
// ⚠️ VADE RENGİ tek başına bilgi taşımaz (renk körlüğü + eldivenli hızlı bakış):
// yanına "vadesi geçti" / "bu hafta" ibaresi de basılır.
//
// ⚠️ SEÇİM SÜTUNU KOŞULLUDUR ve BAŞLIĞI METİNSİZDİR. Metinsizlik tesadüf değil:
// `chequeExport.test.ts` §2 bu tablonun metin sütun başlıklarını KAYNAKTAN
// okuyup dosya kolonlarıyla birebir eşliyor — seçim kutusu bir "veri kolonu" değildir
// ve o eşlemeye girmemelidir (erişilebilirlik `aria-label` ile sağlanır). Seçim
// sayfanın durumudur (tek yön kilidi), DataTable'ın satır seçimi değil.
//
// Hücreler TEK SATIR: ikinci bilgi (seri, yön, ciro, banka, vade ibaresi…) aynı
// satırda soluk yazılır; taşan hücre "…" + ipucuyla tamamlanır.
//
// ⚠️ SEÇİLEMEYEN SATIRIN KUTUSU KAPALI AMA SESSİZ DEĞİL: sebep `title` ile
// satırın üstünde durur. Sebepsiz kapalı bir kutu "ekran bozuk" diye okunur —
// oysa kural (tek yön / iptal edilmiş kayıt) kullanıcının değiştirebileceği
// bir şeydir.
// =============================================================================
import { useMemo } from "react";
import type { ColumnDef, Table } from "@tanstack/react-table";
import { Eye, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionGate } from "@/components/PermissionGate";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/data-table/DataTable";
import { useLocalTable } from "@/hooks/useLocalTable";
import { cn } from "@/lib/utils";
import { money } from "../service";
import type { Currency } from "../service";
import { toNum, type ChequeRow } from "./service";
import { DOCTYPE_LABEL, KIND_LABEL, STATUS_BADGE, STATUS_LABEL, cariName } from "./labels";
import { DUE_TONE_CLASS, dueHint, dueTone, fmtDate, fmtDueDate } from "./dates";
import { availableActions, type ChequeActionDef } from "./transitions";

/** Toplu seçim kancası — verilmezse seçim sütunu HİÇ ÇİZİLMEZ. */
export interface ChequeTableSelection {
  selectedIds: ReadonlySet<string>;
  onToggle: (row: ChequeRow) => void;
  /** Seçilemiyorsa SEBEP (kutu kapanır ve sebep `title`'da yazar), yoksa `null`. */
  blockReason: (row: ChequeRow) => string | null;
  /** Sayfadaki seçilebilir satırların TAMAMI seçili mi. */
  allChecked: boolean;
  /** En az biri seçili mi (başlık kutusunun belirsiz hâli). */
  someChecked: boolean;
  onToggleAll: () => void;
}

interface Handlers {
  onDetail: (row: ChequeRow) => void;
  onAction: (row: ChequeRow, def: ChequeActionDef) => void;
  selection?: ChequeTableSelection;
}

const Sub = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn("ml-1.5 text-[11px] text-muted-foreground", className)}>{children}</span>
);

function selectColumn(selection: ChequeTableSelection): ColumnDef<ChequeRow> {
  return {
    id: "select",
    size: 36,
    enableHiding: false,
    enableResizing: false,
    header: () => (
      <Checkbox
        checked={selection.allChecked ? true : selection.someChecked ? "indeterminate" : false}
        onCheckedChange={() => selection.onToggleAll()}
        aria-label="Sayfadaki uygun kayıtların tümünü seç"
        title="Sayfadaki uygun kayıtların tümünü seç"
      />
    ),
    cell: ({ row: { original: c } }) => {
      const selectBlock = selection.blockReason(c);
      // ⚠️ `title` SARMALAYICI span'de, kutunun kendisinde DEĞİL: tarayıcı `disabled` bir düğmede yerel
      // ipucunu göstermez (fare olayı hiç doğmaz) → sebep tam da gerekli olduğu anda kaybolurdu.
      return (
        <span title={selectBlock ?? "Teslim bordrosuna ekle"}>
          <Checkbox
            checked={selection.selectedIds.has(c.id)}
            disabled={selectBlock !== null}
            onCheckedChange={() => selection.onToggle(c)}
            aria-label={selectBlock ?? `${c.docNo} bordroya seç`}
          />
        </span>
      );
    },
  };
}

const DATA_COLUMNS: ColumnDef<ChequeRow>[] = [
  {
    accessorKey: "docNo",
    header: "Belge No",
    cell: ({ row: { original: c } }) => (
      <span className="font-mono text-xs">
        {c.docNo}
        {c.serialNo && <Sub className="font-sans">Seri: {c.serialNo}</Sub>}
      </span>
    ),
  },
  {
    id: "docType",
    header: "Tür",
    meta: { label: "Tür", exportValue: (c) => `${DOCTYPE_LABEL[c.docType]} · ${KIND_LABEL[c.kind]}` },
    cell: ({ row: { original: c } }) => (
      <span>
        <span className="font-medium">{DOCTYPE_LABEL[c.docType]}</span>
        <Sub>{KIND_LABEL[c.kind]}</Sub>
      </span>
    ),
  },
  {
    id: "cari",
    header: "Cari",
    meta: { label: "Cari", exportValue: (c) => cariName(c.cari) },
    cell: ({ row: { original: c } }) => (
      <span>
        <span className="font-medium">{cariName(c.cari)}</span>
        {/* Ciro edilen taraf ciro sonrası da saklanır; "çek kimde" sorusunun cevabı satırda görünmeli. */}
        {c.endorsedToCari && <Sub>Ciro: {cariName(c.endorsedToCari)}</Sub>}
      </span>
    ),
  },
  {
    id: "drawer",
    header: "Keşideci / Banka",
    meta: {
      label: "Keşideci / Banka",
      exportValue: (c) => [c.drawerName, c.bankName].filter(Boolean).join(" · "),
    },
    cell: ({ row: { original: c } }) => (
      <span className="text-muted-foreground">
        {c.drawerName ?? "—"}
        {c.bankName && <Sub>{c.bankName}</Sub>}
      </span>
    ),
  },
  {
    id: "dates",
    header: "İşlem / Keşide",
    size: 220,
    meta: { label: "İşlem / Keşide", exportValue: (c) => fmtDate(c.issueDate) },
    // İKİ TARİH AYRI ETİKETLE (SINIF 1) — etiketsiz tek tarih "keşide mi işlem mi" karışıklığını satırda yeniden
    // üretirdi. `postingDate` liste ucunda henüz yok (bkz. service.ts) — alan gelmezse yalnız keşide, "—" uydurulmaz.
    cell: ({ row: { original: c } }) => (
      <span className="text-xs text-muted-foreground">
        {c.postingDate && <span className="mr-2">İşlem: {fmtDate(c.postingDate)}</span>}
        Keşide: {fmtDate(c.issueDate)}
      </span>
    ),
  },
  {
    id: "dueDate",
    header: "Vade",
    meta: { label: "Vade", exportValue: (c) => fmtDueDate(c.dueDate) },
    cell: ({ row: { original: c } }) => {
      const tone = dueTone(c.dueDate, c.status);
      const hint = dueHint(tone);
      return (
        <span className={DUE_TONE_CLASS[tone]}>
          {fmtDueDate(c.dueDate)}
          {hint && <span className="ml-1.5 text-[11px]">{hint}</span>}
        </span>
      );
    },
  },
  {
    id: "status",
    header: "Durum",
    meta: { label: "Durum", exportValue: (c) => STATUS_LABEL[c.status] },
    cell: ({ row: { original: c } }) => (
      <span>
        <Badge className={STATUS_BADGE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
        {c.status === "AT_BANK" && c.bankAccount && <Sub>{c.bankAccount.name}</Sub>}
      </span>
    ),
  },
  {
    id: "amount",
    header: "Tutar",
    size: 200,
    meta: {
      label: "Tutar",
      align: "right",
      exportValue: (c) => money(toNum(c.amount), c.currency as Currency),
    },
    cell: ({ row: { original: c } }) => (
      <span className="font-medium">
        {toNum(c.allocatedTotal) > 0 && (
          // Kapama, karşılıksız/iade/iptal yolunu KAPATIR — kullanıcı menüyü açmadan önce bilmeli.
          <span className="mr-1.5 text-[11px] font-normal text-amber-700 dark:text-amber-500">
            Faturaya kapatıldı
          </span>
        )}
        {c.currency !== "TRY" && (
          <span className="mr-1.5 text-xs font-normal text-muted-foreground">
            ≈ {money(toNum(c.amountTry), "TRY")}
          </span>
        )}
        <span className={cn(c.status === "CANCELLED" && "line-through")}>
          {money(toNum(c.amount), c.currency as Currency)}
        </span>
      </span>
    ),
  },
];

function actionsColumn({ onDetail, onAction }: Handlers): ColumnDef<ChequeRow> {
  return {
    id: "actions",
    header: () => <span className="sr-only">Eylemler</span>,
    enableHiding: false,
    size: 96,
    meta: { label: "Eylemler", align: "right" },
    cell: ({ row: { original: c } }) => {
      const actions = availableActions(c);
      return (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            title="Detay ve olay geçmişi"
            onClick={() => onDetail(c)}
          >
            <Eye className="h-4 w-4" />
          </Button>
          {actions.length > 0 && (
            <PermissionGate permission="finance:cheque">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-7 w-7" title="Yapılabilecek işlemler">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {c.docNo}
                  </DropdownMenuLabel>
                  {actions.map((def) => (
                    <DropdownMenuItem
                      key={def.action}
                      className={def.destructive ? "text-destructive" : undefined}
                      onClick={() => onAction(c, def)}
                    >
                      {def.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </PermissionGate>
          )}
        </div>
      );
    },
  };
}

const chequeColumns = (h: Handlers): ColumnDef<ChequeRow>[] => [
  ...(h.selection ? [selectColumn(h.selection)] : []),
  ...DATA_COLUMNS,
  actionsColumn(h),
];

/** Tablo sayfada kurulur — standart "Sütunlar" menüsü süzgeç çubuğunda. Düzen `finance:cheques` altında kayıtlı. */
export function useChequeTable(rows: ChequeRow[], { onDetail, onAction, selection }: Handlers) {
  const columns = useMemo(
    () => chequeColumns({ onDetail, onAction, selection }),
    [onDetail, onAction, selection],
  );
  return useLocalTable({ tableKey: "finance:cheques", data: rows, columns });
}

const cancelledRow = (c: ChequeRow) => (c.status === "CANCELLED" ? "opacity-60" : undefined);

export function ChequeTable({ table }: { table: Table<ChequeRow> }) {
  return <DataTable<ChequeRow> table={table} rowClassName={cancelledRow} exportName="Çek ve senetler" />;
}
