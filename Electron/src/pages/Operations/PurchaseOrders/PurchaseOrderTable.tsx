// =============================================================================
// ALIŞ SİPARİŞİ LİSTESİ
// =============================================================================
// ⚠️ LİSTE KARŞILANMA YÜZDESİ BASMAZ ve bu bilinçlidir: liste ucu kalem bazında
// `receivedQty` TAŞIMAZ (yalnız kalem/fiş SAYISI ve türetilmiş durum). Yüzdeyi
// burada uydurmak — örneğin "fiş var → yarısı geldi" gibi — hiçbir şeye
// dayanmayan bir sayı üretirdi. Rakam DETAYDA, kaynağından okunur.
//
// ⚠️ DURUM ROZETİ TEK BAŞINA RENK DEĞİL: yanında kısa ibare var ("bir kısmı
// geldi"). Renk körlüğü + eldivenli hızlı bakış.
//
// ⚠️ AKSİYONLAR DURUMA GÖRE ÇİZİLİR: düzenleme yalnız `OPEN`, iptal yalnız
// iptal edilmemiş siparişte. Gri bir düğme "burada bir yol var ama sana kapalı"
// der; oysa gerçek şudur — mal görmüş sipariş revize edilmez, yenisi açılır.
// =============================================================================
import { Eye, Pencil, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import type { PurchaseOrderListRow } from "./service";
import { PO_STATUS_BADGE, PO_STATUS_HINT, PO_STATUS_LABEL } from "./labels";
import { EXPECTED_TONE_CLASS, expectedHint, expectedTone, fmtDate } from "./dates";

interface Props {
  rows: PurchaseOrderListRow[];
  onDetail: (row: PurchaseOrderListRow) => void;
  onEdit: (row: PurchaseOrderListRow) => void;
  onCancel: (row: PurchaseOrderListRow) => void;
}

export function PurchaseOrderTable({ rows, onDetail, onEdit, onCancel }: Props) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Sipariş No</th>
            <th className="px-3 py-2 text-left">Tedarikçi</th>
            <th className="px-3 py-2 text-left">Sipariş tarihi</th>
            <th className="px-3 py-2 text-left">Beklenen</th>
            <th className="px-3 py-2 text-right">Kalem</th>
            <th className="px-3 py-2 text-right">Fiş</th>
            <th className="px-3 py-2 text-left">Durum</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const tone = expectedTone(o.expectedDate, o.status);
            const hint = expectedHint(tone);
            const cancelled = o.status === "CANCELLED";
            // ⚠️ `PARTIAL`/`CLOSED` durumu, aktif bir mal kabul fişinin VARLIĞINI
            // KANITLAR (durum karşılanmadan türetiliyor; tüm fişler iptal
            // edilseydi karşılanma 0'a düşer ve durum OPEN olurdu). Backend bu
            // siparişlerin iptalini kesin olarak reddediyor. Düğme yine de
            // çizilir — sebebi ve çözümü ("önce fişleri iptal edin") yalnız iptal
            // diyaloğunda, fiş numaralarıyla yazılı ve onu gizlemek kullanıcıyı
            // cevapsız bırakırdı. Ama ipucu bunu ÖNCEDEN söyler, boşuna diyalog
            // açtırmaz.
            const goodsReceived = o.status === "PARTIAL" || o.status === "CLOSED";
            return (
              <tr
                key={o.id}
                className={cn("cursor-pointer border-t hover:bg-muted/40", cancelled && "opacity-60")}
                onClick={() => onDetail(o)}
              >
                <td className="px-3 py-2 font-mono text-xs">
                  {o.orderNo}
                  <div className="text-[11px] text-muted-foreground">{o.currency}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{o.supplier?.name ?? "—"}</div>
                  {o.supplier?.code && (
                    <div className="text-[11px] text-muted-foreground">{o.supplier.code}</div>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(o.orderDate)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={EXPECTED_TONE_CLASS[tone]}>{fmtDate(o.expectedDate)}</span>
                  {hint && <div className={cn("text-[11px]", EXPECTED_TONE_CLASS[tone])}>{hint}</div>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{o._count.lines}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {o._count.goodsReceipts > 0 ? (
                    o._count.goodsReceipts
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge className={PO_STATUS_BADGE[o.status]}>{PO_STATUS_LABEL[o.status]}</Badge>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{PO_STATUS_HINT[o.status]}</div>
                </td>
                {/* Satır tıklaması detayı açıyor; buradaki düğmeler onu tetiklemesin. */}
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="outline" size="icon" title="Detay ve kalemler" onClick={() => onDetail(o)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <PermissionGate permission="purchase-order:write">
                      <>
                        {/* Mal görmüş sipariş revize EDİLMEZ (backend 409) →
                            düğme yalnız OPEN'da çizilir. */}
                        {o.status === "OPEN" && (
                          <Button variant="outline" size="icon" title="Siparişi düzenle" onClick={() => onEdit(o)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {!cancelled && (
                          <Button
                            variant="outline"
                            size="icon"
                            title={
                              goodsReceived
                                ? "Siparişi iptal et — bu siparişe mal kabul edilmiş, önce ilgili fişler iptal edilmeli"
                                : "Siparişi iptal et"
                            }
                            className="text-destructive"
                            onClick={() => onCancel(o)}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    </PermissionGate>
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
