// =============================================================================
// HAREKET DÖKÜMÜ — seçilen kalem × depo için defter
// =============================================================================
// ⚠️ "YÜRÜYEN BAKİYE" SÜTUNU BİLİNÇLİ OLARAK YOKTUR. Döküm en yeniden eskiye
// sıralı ve SAYFALIDIR (cursor); elimizdeki kısmi sayfadan yürüyen bakiye
// hesaplamak, ilk satırın üstünde görünmeyen hareketleri yok sayardı ve ekranda
// defterle UYUŞMAYAN bir rakam belirirdi. Doğru bakiye tek yerdedir: başlıktaki
// `YarnStock.balanceKg` (backend'in tek yazarı). Bir gün gerçekten gerekirse
// çözüm istemcide toplamak değil, backend'in satır başına bakiye döndürmesidir.
//
// ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLARDIR. İstek düşerse elimizde boş bir
// dizi kalır; onu "hiç hareket yok" diye basmak DÜPEDÜZ YALANDIR — kullanıcı
// ipliğin hiç girmediği sonucuna varır ve ikinci kez giriş yazar. Interceptor'ın
// toast'ı birkaç saniyede kaybolur, ekranda kalan cümle doğruyu söylemek zorunda.
//
// ⚠️ SATIRLAR SALT-OKUNURDUR. Defter append-only: düzeltme/silme ucu YOK ve
// eklenmeyecek. Yanlış satır ters kayıtla kapatılır — bu yüzden burada "Düzelt"
// düğmesi aramayın, "Hareket Ekle" o işi görür.
//
// ⚠️ Filtreler SUNUCUDA uygulanır. Döküm sayfalı olduğu için istemcide süzmek
// yalnız O ANKİ SAYFAYI süzer ve kullanıcı "kayıt yok" sanır — oysa kayıt bir
// sonraki sayfadadır.
//
// ⚠️ BAŞLIKTAKİ BAKİYE CANLI OKUNUR, açılışta alınan satır SNAPSHOT'INDAN
// DEĞİL. Kullanıcı bu panelin içinden hareket yazabiliyor: satır anında listede
// belirirken başlıktaki bakiye eski kalsaydı ekranın bir yarısı yeni, diğer
// yarısı eski olurdu ("+100 kg yazdım, bakiye değişmedi" — sahada güveni en
// hızlı bitiren kusur). Liste satırından tazelemek YETMEZ: liste bakiyeye göre
// sıralı ve sayfalı, satır hareketten sonra başka bir sayfaya taşınabilir.
// Canlı değer gelene kadar snapshot gösterilir (bkz. `useYarnBalance`).
// =============================================================================
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import {
  YARN_FILTER_KINDS,
  YARN_KIND_META,
  yarnKindMeta,
  formatInstant,
  kindBadgeClass,
  listYarnMovements,
  movementActor,
  movementSource,
  type YarnMovementKind,
  type YarnStockRow,
} from "./service";
import { useYarnBalance } from "./useYarnBalance";
import { dayEndIso, dayStartIso, isNegative, kg } from "./qty";
import { DateRangeInput } from "@/components/forms/DateRangeInput";

const PAGE_SIZE = 50;

interface Props {
  /** Seçili bakiye satırı — `null` ise panel kapalıdır. */
  row: YarnStockRow | null;
  onClose: () => void;
  onAddMovement: (row: YarnStockRow) => void;
  showWarehouse: boolean;
}

export function YarnMovementsSheet({ row, onClose, onAddMovement, showWarehouse }: Props) {
  const [kind, setKind] = useState<YarnMovementKind | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const itemId = row?.item.id;
  const warehouseId = row?.warehouse.id;

  // Canlı bakiye (hareket yazıldığında `invalidateQueries(["yarn"])` ile
  // tazelenir). Henüz gelmediyse açılıştaki satır değeri gösterilir — eski
  // rakamı boş bırakmaktansa göstermek doğru, ama TAZELENMESİ şart.
  const balance = useYarnBalance(itemId, warehouseId);
  const shownBalance = balance.balanceKg ?? row?.balanceKg ?? null;

  const q = useInfiniteQuery({
    // Anahtar filtreleri İÇERİR: aksi halde tür/tarih değişince eski sayfalar
    // yeni filtrenin sonucuymuş gibi ekranda kalırdı.
    queryKey: ["yarn", "movements", itemId ?? "", warehouseId ?? "", kind, dateFrom, dateTo],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listYarnMovements({
        limit: PAGE_SIZE,
        cursor: pageParam,
        itemId,
        warehouseId,
        kind: kind || undefined,
        // Gün sınırı İSTEMCİNİNDİR (yerel 00:00 / 23:59:59.999); boş/bozuk
        // değerde parametre hiç gitmez.
        dateFrom: dayStartIso(dateFrom),
        dateTo: dayEndIso(dateTo),
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(itemId && warehouseId),
  });

  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = Boolean(kind || dateFrom || dateTo);

  return (
    <Sheet open={Boolean(row)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-[720px] flex-col sm:max-w-[720px]">
        <SheetHeader>
          <SheetTitle className="pr-8">{row ? row.item.name : "…"}</SheetTitle>
        </SheetHeader>

        {row && (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{row.item.code}</span>
              {showWarehouse && <span className="text-muted-foreground">{row.warehouse.name}</span>}
              <span className="ml-auto">
                Bakiye:{" "}
                <b className={cn(isNegative(shownBalance) && "text-amber-700 dark:text-amber-500")}>
                  {kg(shownBalance)}
                </b>
              </span>
              <PermissionGate permission="yarn:write">
                <Button size="sm" onClick={() => onAddMovement(row)}>
                  <Plus className="mr-1 h-4 w-4" />
                  Hareket Ekle
                </Button>
              </PermissionGate>
            </div>

            {isNegative(shownBalance) && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Bakiye eksi. Bu bir sistem hatası değildir: açılış ya da sayım girilmeden çıkış yazıldığında
                  defter gerçekten eksiye düşer. Düzeltmek için sayım sonucunu “Sayım düzeltmesi (+)” olarak girin.
                </span>
              </div>
            )}

            <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as YarnMovementKind | "")}
              >
                <option value="">Tüm hareketler</option>
                {YARN_FILTER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {YARN_KIND_META[k].label}
                  </option>
                ))}
              </select>
              <DateRangeInput from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} inputClassName="w-36" />
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-md border">
              {q.isLoading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
              ) : q.isError && rows.length === 0 ? (
                /* ⚠️ Hata bloğu YALNIZ elde hiç satır yokken tüm alanı kaplar.
                   "Daha fazla yükle" düşerse zaten okunmuş defter satırlarını
                   ekrandan silmek, olan bilgiyi yok etmek olurdu — ve kullanıcı
                   bunu "defter erişilemez" diye okur. O durumda tablo kalır,
                   uyarı aşağıdaki şeride düşer. */
                <div className="p-6 text-center text-sm">
                  <p className="font-medium text-destructive">Hareket dökümü yüklenemedi.</p>
                  <p className="mt-1 text-muted-foreground">
                    Bu bir “hareket yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi. Defter
                    yerinde duruyor; yeni hareket yazmadan önce tekrar deneyin.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
                    Tekrar dene
                  </Button>
                </div>
              ) : rows.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {filtered
                    ? "Bu filtreyle hareket yok. Tür/tarih daraltmasını genişletin."
                    : "Bu iplik bu depoda henüz hiç hareket görmemiş."}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase text-muted-foreground backdrop-blur">
                    <tr>
                      <th className="px-3 py-2 text-left">Tarih</th>
                      <th className="px-3 py-2 text-left">İşlem</th>
                      <th className="px-3 py-2 text-right">Miktar</th>
                      <th className="px-3 py-2 text-left">Kaynak / Sebep</th>
                      <th className="px-3 py-2 text-left">Lot</th>
                      <th className="px-3 py-2 text-left">Kullanıcı</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => {
                      const meta = yarnKindMeta(m.kind);
                      return (
                        <tr key={m.id} className="border-t align-top">
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            {formatInstant(m.createdAt)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge className={kindBadgeClass(m.kind)}>{meta.short}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap">
                            {/* İşaret TÜRDEN gelir; miktar defterde daima pozitiftir. */}
                            {meta.sign > 0 ? "+" : "−"}
                            {kg(m.qtyKg)}
                          </td>
                          <td className="px-3 py-2">
                            <div>{movementSource(m)}</div>
                            {m.reason && (
                              <div className="text-[11px] text-muted-foreground">{m.reason}</div>
                            )}
                          </td>
                          {/* Devere Faz 2: lot etiketi; lotsuz satır "—" (defter geçmişi, uyarı değil). */}
                          <td className="px-3 py-2 font-mono text-xs">
                            {m.lot ? m.lot.lotNo : <span className="text-muted-foreground">—</span>}
                            {m.bobbinCount != null ? <span className="ml-1 text-muted-foreground">· {m.bobbinCount} bobin</span> : null}
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
                <span>{rows.length} hareket gösteriliyor (en yeniden eskiye).</span>
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
                  // söylemezsek kullanıcı listenin bittiğini sanır ve eksik bir
                  // defterle karar verir.
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
