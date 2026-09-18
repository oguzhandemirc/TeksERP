// =============================================================================
// KASA HAREKETLERİ TABLOSU
// =============================================================================
// ⚠️ TUTAR YÖNLÜ BASILIR ve yön `row.direction`'dan okunur — türden yeniden
// TÜRETİLMEZ (saf katman notu). İşaret (+/−) her zaman yazılır: renk tek başına
// erişilebilir bir ayrım değildir ve gri tonlu/parlak ekranda kaybolur.
//
// ⚠️ İPTAL SATIRI SİLİNMİŞ GİBİ GÖSTERİLMEZ: soluklaşır ve tutarı üstü çizili
// basılır (`PaymentsPage` emsali). Defterde duruyor olması bilgidir.
// =============================================================================

import { Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { money } from "../service";
import { fmtDate } from "../Cheques/dates";
import { useDrillTarget } from "@/components/layout/tabs/use-tab-target";
import { DIRECTION_TONE, KIND_LABEL, STATUS_LABEL, accountNameOf, isPaymentLedgerRow, paymentSearchPath, withSign } from "./cashTxnRules";
import type { CashTxnRow } from "./service";

interface Props {
  rows: CashTxnRow[];
  onCancel: (row: CashTxnRow) => void;
}

export function CashTxnTable({ rows, onCancel }: Props) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Belge No</th>
            <th className="px-3 py-2 text-left">Tür</th>
            <th className="px-3 py-2 text-left">Hesap</th>
            <th className="px-3 py-2 text-left">Tarih</th>
            <th className="px-3 py-2 text-right">Tutar</th>
            <th className="px-3 py-2 text-left">Kategori</th>
            <th className="px-3 py-2 text-left">Açıklama</th>
            <th className="px-3 py-2 text-left">Kaynak</th>
            <th className="px-3 py-2 text-left">Durum</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cancelled = r.status === "CANCELLED";
            const amountText = withSign(r.direction, money(r.amount, r.currency));
            return (
              <tr key={r.id} className={`border-t ${cancelled ? "opacity-60" : ""}`}>
                <td className="px-3 py-2 font-mono text-xs">{r.docNo}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className={DIRECTION_TONE[r.direction]}>
                    {KIND_LABEL[r.kind]}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-medium">{accountNameOf(r)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.txnDate)}</td>
                <td className={`px-3 py-2 text-right font-medium ${cancelled ? "" : DIRECTION_TONE[r.direction]}`}>
                  {cancelled ? <span className="line-through">{amountText}</span> : amountText}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.category ?? "—"}</td>
                <td className="max-w-[22rem] truncate px-3 py-2 text-muted-foreground" title={r.description ?? ""}>
                  {r.description ?? "—"}
                  {r.reference && <span className="ml-1 text-xs">· {r.reference}</span>}
                </td>
                <td className="px-3 py-2">{r.payment ? <PaymentLink payment={r.payment} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2">
                  {cancelled ? (
                    <Badge className="bg-muted text-muted-foreground">{STATUS_LABEL.CANCELLED}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">{STATUS_LABEL.ACTIVE}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {!cancelled && !isPaymentLedgerRow(r) && (
                    <PermissionGate permission="finance:payment">
                      <Button variant="outline" size="sm" onClick={() => onCancel(r)}>
                        <Ban className="mr-1 h-3.5 w-3.5" />
                        İptal
                      </Button>
                    </PermissionGate>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Ödemeden doğan satırın kaynağı — tıklayınca Tahsilat/Ödeme listesi o belge no ile açılır (yerinde; orta tık yeni sekme). */
function PaymentLink({ payment }: { payment: NonNullable<CashTxnRow["payment"]> }) {
  const drill = useDrillTarget(paymentSearchPath(payment.docNo));
  return (
    <button type="button" className="text-left text-primary hover:underline" title="Tahsilat/Ödeme kaydını aç" onClick={drill.onClick} onAuxClick={drill.onAuxClick} onContextMenu={drill.onContextMenu}>
      <span className="font-mono text-xs">{payment.docNo}</span>
      <span className="ml-1 text-xs text-muted-foreground">{payment.direction === "IN" ? "Tahsilat" : "Ödeme"} · {payment.cari.name}</span>
    </button>
  );
}
