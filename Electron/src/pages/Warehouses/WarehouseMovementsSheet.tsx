// =============================================================================
// DEPO HAREKET DÖKÜMÜ — depo detayından açılan defter paneli
// =============================================================================
// Defter 2026-08-14'ten beri YAZILIYOR ama okuyan tek yüzey transfer detayıydı
// (`transferId` ile süzülmüş TRANSFER satırları). "Bu depoya ne girdi / bundan ne
// çıktı" sorusunun cevabı hiçbir ekranda yoktu. Bu panel o kapıdır ve iplik
// dökümünün (`YarnMovementsSheet`) sözleşmesini birebir izler.
//
// ⚠️ "YÜRÜYEN BAKİYE" / "TOPLAM" SÜTUNU BİLİNÇLİ OLARAK YOKTUR. Döküm en yeniden
// eskiye sıralı ve SAYFALIDIR (cursor); elimizdeki kısmi sayfadan toplam
// hesaplamak, ilk satırın üstünde görünmeyen hareketleri yok saymak olurdu ve
// ekranda defterle UYUŞMAYAN bir rakam belirirdi. Gerçekten gerekirse çözüm
// istemcide toplamak değil, backend'in filtre bazlı aggregate döndürmesidir.
//
// ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLARDIR. İstek düşerse elimizde boş bir
// dizi kalır; onu "hiç hareket yok" diye basmak DÜPEDÜZ YALANDIR — kullanıcı
// malın hiç girmediği sonucuna varır. Interceptor'ın toast'ı birkaç saniyede
// kaybolur, ekranda kalan cümle doğruyu söylemek zorunda.
//
// ⚠️ SATIRLAR SALT-OKUNURDUR. Defter append-only: düzeltme/silme ucu YOK ve
// eklenmeyecek. Yanlış satır TERS OLAYLA kapatılır (transfer iptali, sevk
// stornosu, iade). Burada "Düzelt" düğmesi aramayın.
//
// ⚠️ KIRPMA SESSİZ DEĞİL: altbilgi listenin bitip bitmediğini HER ZAMAN söyler
// (`pageFooterText`). "N kayıt" tek başına, sayfanın defterin tamamı olduğu
// izlenimini verir ve o izlenim sayım kararını değiştirir.
// =============================================================================
import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { dayEndIso, dayStartIso } from "@/pages/Finance/Cheques/dates";
import { listWarehouseMovements } from "./service";
import {
  EMPTY_MOVEMENT_FILTER,
  WAREHOUSE_EVENT_TYPES,
  counterpartName,
  directionMeta,
  eventBadgeClass,
  eventMeta,
  formatInstant,
  isFiltered,
  movementActor,
  movementSource,
  pageFooterText,
  rollLabel,
  signedQty,
  type MovementFilter,
  type WarehouseEventType,
} from "./movements";
import type { Warehouse } from "./types";
import { DateRangeInput } from "@/components/forms/DateRangeInput";

const PAGE_SIZE = 50;

interface Props {
  /** Seçili depo — `null` ise panel kapalıdır. */
  warehouse: Warehouse | null;
  onClose: () => void;
}

export function WarehouseMovementsSheet({ warehouse, onClose }: Props) {
  const [filter, setFilter] = useState<MovementFilter>(EMPTY_MOVEMENT_FILTER);
  const warehouseId = warehouse?.id;

  // Depo değişince filtre sıfırlanır: önceki depoda "sadece sevkler" seçip
  // kapatan kullanıcı, başka bir depoyu açtığında boş liste bulup "bu depoda
  // hiç hareket yok" sanardı (2026-08-12 Tambur modalı dersi).
  useEffect(() => {
    setFilter(EMPTY_MOVEMENT_FILTER);
  }, [warehouseId]);

  const q = useInfiniteQuery({
    // Anahtar filtreleri İÇERİR: aksi halde tür/tarih değişince eski sayfalar
    // yeni filtrenin sonucuymuş gibi ekranda kalırdı.
    queryKey: [
      "warehouses",
      "movements",
      warehouseId ?? "",
      filter.eventType,
      filter.dateFrom,
      filter.dateTo,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listWarehouseMovements({
        limit: PAGE_SIZE,
        cursor: pageParam,
        warehouseId,
        eventType: filter.eventType || undefined,
        // Gün sınırı İSTEMCİNİNDİR (yerel 00:00 / 23:59:59.999); boş/bozuk
        // değerde parametre hiç gitmez.
        dateFrom: dayStartIso(filter.dateFrom),
        dateTo: dayEndIso(filter.dateTo),
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(warehouseId),
  });

  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = isFiltered(filter);

  return (
    <Sheet open={Boolean(warehouse)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-[860px] flex-col sm:max-w-[860px]">
        <SheetHeader>
          <SheetTitle className="pr-8">{warehouse ? `${warehouse.name} — Hareketler` : "…"}</SheetTitle>
        </SheetHeader>

        {warehouse && (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{warehouse.code}</span>
              <span className="text-xs text-muted-foreground">
                Defter append-only: satırlar düzeltilmez, ters olayla kapanır.
              </span>
            </div>

            <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filter.eventType}
                onChange={(e) =>
                  setFilter((f) => ({ ...f, eventType: e.target.value as WarehouseEventType | "" }))
                }
              >
                <option value="">Tüm hareketler</option>
                {WAREHOUSE_EVENT_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {eventMeta(k).label}
                  </option>
                ))}
              </select>
              <DateRangeInput
                from={filter.dateFrom}
                to={filter.dateTo}
                onFrom={(v) => setFilter((f) => ({ ...f, dateFrom: v }))}
                onTo={(v) => setFilter((f) => ({ ...f, dateTo: v }))}
                inputClassName="w-36"
                fromLabel="Başlangıç tarihi"
                toLabel="Bitiş tarihi"
              />
              {filtered && (
                <Button variant="ghost" size="sm" onClick={() => setFilter(EMPTY_MOVEMENT_FILTER)}>
                  Filtreyi temizle
                </Button>
              )}
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-md border">
              {q.isLoading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
              ) : q.isError && rows.length === 0 ? (
                /* ⚠️ Hata bloğu YALNIZ elde hiç satır yokken tüm alanı kaplar.
                   "Daha fazla yükle" düşerse zaten okunmuş defter satırlarını
                   ekrandan silmek, olan bilgiyi yok etmek olurdu. */
                <div className="p-6 text-center text-sm">
                  <p className="font-medium text-destructive">Hareket dökümü yüklenemedi.</p>
                  <p className="mt-1 text-muted-foreground">
                    Bu bir “hareket yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi. Defter
                    yerinde duruyor; karar vermeden önce tekrar deneyin.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
                    Tekrar dene
                  </Button>
                </div>
              ) : rows.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {filtered
                    ? "Bu filtreyle hareket yok. Tür/tarih daraltmasını genişletin."
                    : "Bu depoda henüz hiç hareket yok. (Defter 2026-08-14'te açıldı — daha eski girişler burada görünmez.)"}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase text-muted-foreground backdrop-blur">
                    <tr>
                      <th className="px-3 py-2 text-left">Tarih</th>
                      <th className="px-3 py-2 text-left">Olay</th>
                      <th className="px-3 py-2 text-left">Yön</th>
                      <th className="px-3 py-2 text-right">Metraj</th>
                      <th className="px-3 py-2 text-left">Top</th>
                      <th className="px-3 py-2 text-left">Karşı taraf</th>
                      <th className="px-3 py-2 text-left">Belge</th>
                      <th className="px-3 py-2 text-left">Kullanıcı</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => {
                      // Bilinmeyen olay (backend önde) ham adıyla basılır; ekran çökmez.
                      // TEK KAYNAK `eventMeta` — sözlük burada DOĞRUDAN indekslenmez (bekçi ölçer).
                      const meta = eventMeta(m.eventType);
                      const dir = directionMeta(m.direction);
                      return (
                        <tr key={m.id} className="border-t align-top">
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            {formatInstant(m.createdAt)}
                          </td>
                          <td className="px-3 py-2">
                            {/* Tanınmayan tür: kesik kenar — "eksik çeviri mi, gerçek tür mü" ipucuyla ayrılır. */}
                            <Badge
                              className={cn(eventBadgeClass(m.isReversal), meta.unknown && "border border-dashed opacity-80")}
                              title={meta.hint}
                            >
                              {meta.label}
                            </Badge>
                          </td>
                          {/* Yön KELİMEYLE de yazılır — renk tek başına bilgi taşımaz. */}
                          <td className={cn("px-3 py-2 whitespace-nowrap", dir.className)}>{dir.label}</td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap",
                              dir.className,
                            )}
                          >
                            {signedQty(m)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-mono text-xs">{rollLabel(m)}</div>
                            {m.sack && (
                              <div className="text-[11px] text-muted-foreground">Çuval {m.sack.sackNo}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{counterpartName(m)}</td>
                          <td className="px-3 py-2">
                            <div>{movementSource(m)}</div>
                            {/* Not KIRPILMAZ: kısaltılan gerekçe, yarısı okunan
                                gerekçedir. Uzun metin satır sarar. */}
                            {m.notes && (
                              <div className="text-[11px] break-words text-muted-foreground">{m.notes}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{movementActor(m)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {rows.length > 0 && (
              <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{pageFooterText(rows.length, q.hasNextPage)}</span>
                {q.hasNextPage && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={q.isFetchingNextPage}
                    onClick={() => void q.fetchNextPage()}
                  >
                    {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla yükle"}
                  </Button>
                )}
                {q.isError && (
                  // Yukarıdaki satırlar geçerli; DÜŞEN yalnız devamıdır. Bunu
                  // söylemezsek kullanıcı listenin bittiğini sanır.
                  <span className="font-medium text-destructive">
                    Devamı yüklenemedi — liste eksik olabilir, tekrar deneyin.
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
