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
// `chequeExport.test.ts` §2 bu tablonun `<thead>`'ini KAYNAKTAN okuyup dosya
// kolonlarıyla birebir eşliyor — seçim kutusu bir "veri kolonu" değildir ve o
// eşlemeye girmemelidir (erişilebilirlik `aria-label` ile sağlanır).
//
// ⚠️ SEÇİLEMEYEN SATIRIN KUTUSU KAPALI AMA SESSİZ DEĞİL: sebep `title` ile
// satırın üstünde durur. Sebepsiz kapalı bir kutu "ekran bozuk" diye okunur —
// oysa kural (tek yön / iptal edilmiş kayıt) kullanıcının değiştirebileceği
// bir şeydir.
// =============================================================================
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
import { cn } from "@/lib/utils";
import { money } from "../service";
import type { Currency } from "../service";
import { toNum, type ChequeRow } from "./service";
import { DOCTYPE_LABEL, KIND_LABEL, STATUS_BADGE, STATUS_LABEL, cariName } from "./labels";
import { DUE_TONE_CLASS, dueHint, dueTone, fmtDate } from "./dates";
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

interface Props {
  rows: ChequeRow[];
  onDetail: (row: ChequeRow) => void;
  onAction: (row: ChequeRow, def: ChequeActionDef) => void;
  selection?: ChequeTableSelection;
}

export function ChequeTable({ rows, onDetail, onAction, selection }: Props) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
          <tr>
            {selection && (
              <th className="w-9 px-3 py-2">
                <Checkbox
                  checked={
                    selection.allChecked ? true : selection.someChecked ? "indeterminate" : false
                  }
                  onCheckedChange={() => selection.onToggleAll()}
                  aria-label="Sayfadaki uygun kayıtların tümünü seç"
                  title="Sayfadaki uygun kayıtların tümünü seç"
                />
              </th>
            )}
            <th className="px-3 py-2 text-left">Belge No</th>
            <th className="px-3 py-2 text-left">Tür</th>
            <th className="px-3 py-2 text-left">Cari</th>
            <th className="px-3 py-2 text-left">Keşideci / Banka</th>
            <th className="px-3 py-2 text-left">İşlem / Keşide</th>
            <th className="px-3 py-2 text-left">Vade</th>
            <th className="px-3 py-2 text-left">Durum</th>
            <th className="px-3 py-2 text-right">Tutar</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const tone = dueTone(c.dueDate, c.status);
            const hint = dueHint(tone);
            const actions = availableActions(c);
            const allocated = toNum(c.allocatedTotal);
            const cancelled = c.status === "CANCELLED";
            const selectBlock = selection?.blockReason(c) ?? null;
            return (
              <tr key={c.id} className={cn("border-t", cancelled && "opacity-60")}>
                {selection && (
                  <td className="px-3 py-2">
                    {/* ⚠️ `title` SARMALAYICI span'de, kutunun kendisinde DEĞİL:
                        tarayıcı `disabled` bir düğmede yerel ipucunu göstermez
                        (fare olayı hiç doğmaz) → sebep tam da gerekli olduğu
                        anda kaybolurdu. `aria-label` yine kutuda kalır. */}
                    <span title={selectBlock ?? "Teslim bordrosuna ekle"}>
                      <Checkbox
                        checked={selection.selectedIds.has(c.id)}
                        disabled={selectBlock !== null}
                        onCheckedChange={() => selection.onToggle(c)}
                        aria-label={selectBlock ?? `${c.docNo} bordroya seç`}
                      />
                    </span>
                  </td>
                )}
                <td className="px-3 py-2 font-mono text-xs">
                  {c.docNo}
                  {c.serialNo && (
                    <div className="text-[11px] text-muted-foreground">Seri: {c.serialNo}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{DOCTYPE_LABEL[c.docType]}</div>
                  <div className="text-[11px] text-muted-foreground">{KIND_LABEL[c.kind]}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{cariName(c.cari)}</div>
                  {c.endorsedToCari && (
                    // Ciro edilen taraf ciro sonrası da saklanır; "çek kimde"
                    // sorusunun cevabı satırda görünmeli.
                    <div className="text-[11px] text-muted-foreground">
                      Ciro: {cariName(c.endorsedToCari)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  <div>{c.drawerName ?? "—"}</div>
                  {c.bankName && <div className="text-[11px]">{c.bankName}</div>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                  {/* İKİ TARİH AYRI ETİKETLE (SINIF 1) — etiketsiz tek tarih
                      "keşide mi işlem mi" karışıklığını satırda yeniden üretirdi.
                      `postingDate` liste ucunda henüz yok (bkz. service.ts) —
                      alan gelmezse yalnız keşide basılır, "—" uydurulmaz. */}
                  {c.postingDate && <div>İşlem: {fmtDate(c.postingDate)}</div>}
                  <div>Keşide: {fmtDate(c.issueDate)}</div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={DUE_TONE_CLASS[tone]}>{fmtDate(c.dueDate)}</span>
                  {hint && <div className={cn("text-[11px]", DUE_TONE_CLASS[tone])}>{hint}</div>}
                </td>
                <td className="px-3 py-2">
                  <Badge className={STATUS_BADGE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                  {c.status === "AT_BANK" && c.bankAccount && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{c.bankAccount.name}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  <span className={cn(cancelled && "line-through")}>
                    {money(toNum(c.amount), c.currency as Currency)}
                  </span>
                  {c.currency !== "TRY" && (
                    <div className="text-xs text-muted-foreground">
                      ≈ {money(toNum(c.amountTry), "TRY")}
                    </div>
                  )}
                  {allocated > 0 && (
                    // Kapama, karşılıksız/iade/iptal yolunu KAPATIR — kullanıcı
                    // menüyü açmadan önce bilmeli.
                    <div className="text-[11px] text-amber-700 dark:text-amber-500">Faturaya kapatıldı</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      title="Detay ve olay geçmişi"
                      onClick={() => onDetail(c)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {actions.length > 0 && (
                      <PermissionGate permission="finance:cheque">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" title="Yapılabilecek işlemler">
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
