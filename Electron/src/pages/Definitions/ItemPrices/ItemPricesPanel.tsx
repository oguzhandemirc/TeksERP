// =============================================================================
// KALEM FİYATLARI — GÖMÜLEBİLİR BÖLÜM ("Fiyatlar")
// =============================================================================
// NEDEN AYRI BİLEŞEN: bu bölümün asıl yeri ÜRÜN KARTIDIR (kalem kartının
// "Fiyatlar" sekmesi). Kendi sayfası (`ItemPricesPage`) yalnız ona giden ikinci
// bir kapıdır. Aynı yüzeyi iki yerde ayrı ayrı yazmak, birinde düzeltilen bir
// kuralın diğerinde kalması demekti.
//
// ── ⚠️ İKİ BÖLÜM GÖRSEL OLARAK AYRIDIR VE BU, EKRANIN VAR OLMA SEBEBİDİR ─────
//   «Varsayılan fiyat»      → `customerId = null`  · müşteri istisnası olmayan
//                              HERKESE uygulanır.
//   «Müşteri istisnaları»   → `customerId = uuid`  · yalnız o müşteriye.
// Tek listede karışsalardı kullanıcı hangisinin geçerli olduğunu bilemezdi;
// üstelik `customerId = null` satırı "müşterisi silinmiş fiyat" diye okunurdu.
// Bu yüzden başlıklar cümle kurar, kolon adı taşımaz.
//
// ── ⚠️ BOŞ HÜCRE ÇİZİLİR, GİZLENMEZ ──────────────────────────────────────────
// "Satış fiyatı girilmemiş" ancak boş bir satır çizilirse görünür. Yalnız var
// olan satırları listelemek, eksikliği ekrandan silerdi — kullanıcı göremediği
// şeyi eksik değil YOK sanar. Ve boş hücre **0,00 basmaz**: sıfır bir FİYATTIR
// (promosyon/numune), boş "girilmemiş" demektir.
//
// ── ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLARDIR ───────────────────────────────
// İstek düşerse (modül kapalı, izin yok, sunucu yok) elimizde boş bir dizi
// kalır; onu "fiyat tanımlı değil" diye basmak yalandır ve kullanıcıyı fiyatı
// ikinci kez girmeye gönderir.
//
// ── ⚠️⚠️ LİSTE YÜKLENMEDEN YAZMA DÜĞMESİ AÇILMAZ ─────────────────────────────
// Yukarıdaki kural TABLOYU kapsıyordu ama başlıktaki «Fiyat tanımla» /
// «İstisna ekle» düğmeleri kart BAŞLIĞINDA, yani hata/yükleniyor dalının
// DIŞINDA duruyordu. Sonuç ölçüldü ve sessizdi: liste düşünce `rows` boş kalır,
// formdaki `findExisting` hiçbir şey bulamaz, "bu kutuda zaten bir fiyat var —
// ÜZERİNE YAZILIR" uyarısı HİÇ ÇIKMAZ ve backend `upsert` olduğu için kayıt
// hata da vermez: eski fiyat sessizce EZİLİR. Yani listenin düşmesi
// "mükerrer kayıt" değil **veri kaybı** üretiyordu.
//
// Bu yüzden "yeni fiyat teklif edilebilir mi" kararı SAF katmandadır
// (`regime.canOfferNewPrice`, bekçisi `regime.test.ts`): uyarıyı üretecek veri
// elimizde değilse, o uyarıya dayanan işlem de teklif edilmez. Düğme GİZLENMEZ
// (yol kalıcı olarak kapalı değil, ŞU AN kapalı) — devre dışı kalır ve sebebi
// hemen altındaki hata kutusunda "Tekrar dene" ile birlikte yazar.
//
// ⚠️ DÜZELT/KALDIR bu kısıta TABİ DEĞİL ve olmamalı: onlar yalnız gerçekten
// yüklenmiş bir satırın üstünde çizilir ve kimliklerini o satırdan alır.
// =============================================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Tag, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { safeFormat } from "@/lib/format";
import {
  PRICE_KIND_LABEL,
  listItemPrices,
  priceText,
  removeItemPrice,
  type ItemPriceRow,
} from "./service";
import { buildDefaultCells, buildExceptionViews, describeRemoval } from "./prices";
import { ItemPriceFormDialog, type ItemPriceFormInitial } from "./ItemPriceFormDialog";
import { ResolvePriceCard } from "./ResolvePriceCard";
import { useItemPricesAccess } from "./useItemPricesAccess";
import { canOfferNewPrice } from "./regime";

const PAGE_SIZE = 200;

interface Props {
  itemId: string;
  /** "STK-000123 — Poplin" gibi tek satırlık kimlik. */
  itemLabel: string;
  /** Kalemin birimi (MT/KG/ADET) — "1 MT fiyatı" cümlesi için. */
  unit?: string | null;
  /** Kontrol kartını gizle (dar bir gömüde yer yoksa). Varsayılan: göster. */
  hideResolveCheck?: boolean;
}

export function ItemPricesPanel({ itemId, itemLabel, unit, hideResolveCheck }: Props) {
  const qc = useQueryClient();
  const access = useItemPricesAccess();
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState<ItemPriceRow | null>(null);
  const [formInitial, setFormInitial] = useState<ItemPriceFormInitial | undefined>(undefined);
  const [removeTarget, setRemoveTarget] = useState<ItemPriceRow | null>(null);

  const q = useQuery({
    queryKey: ["item-prices", "item", itemId],
    queryFn: () => listItemPrices({ itemId, pageSize: PAGE_SIZE }),
    // Rejim kapalıyken uç 403 verir; boşuna sormayalım (ve kullanıcıya kırmızı
    // bir hata kutusu göstermeyelim — sebep hata değil, kurulum).
    enabled: access.visible,
  });

  const rows = useMemo(() => q.data?.data ?? [], [q.data?.data]);
  const total = q.data?.pagination.total ?? 0;
  // Karar SAF katmanda (`canOfferNewPrice`); burada yalnız girdi derlenir.
  const canAdd = canOfferNewPrice(access, q.isSuccess);
  const addBlockedTitle = q.isError
    ? "Mevcut fiyatlar yüklenemedi — üzerine yazma uyarısı üretilemez. Önce «Tekrar dene»."
    : "Mevcut fiyatlar yükleniyor…";
  const cells = useMemo(() => buildDefaultCells(rows), [rows]);
  const exceptions = useMemo(() => buildExceptionViews(rows), [rows]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["item-prices"] });

  const removeM = useMutation({
    mutationFn: (id: string) => removeItemPrice(id),
    onSuccess: (r) => {
      toast.success(r.message ?? "Fiyat satırı kaldırıldı.");
      setRemoveTarget(null);
      invalidate();
    },
    // Hata toast'ı YOK — interceptor backend'in cümlesini basıyor.
  });

  const openNew = (initial?: ItemPriceFormInitial) => {
    setEditRow(null);
    setFormInitial(initial);
    setFormOpen(true);
  };
  const openEdit = (row: ItemPriceRow) => {
    setEditRow(row);
    setFormInitial(undefined);
    setFormOpen(true);
  };

  if (access.isLoading) {
    return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  }

  if (!access.ticaretEnabled) {
    // Backend'in cümlesiyle aynı yönü gösterir (403: "Ticaret modülü bu
    // kurulumda kapalı — Genel Ayarlar → Modüller").
    return (
      <Callout tone="muted" title="Fiyat tanımları bu kurulumda kapalı">
        Kalem fiyatı TİCARET modülünün bir parçasıdır (ön muhasebeden bağımsız). Genel Ayarlar →
        Modüller bölümünden açılabilir.
      </Callout>
    );
  }

  // İzinsiz kullanıcıya açıklama basmayız — proje deseni (PermissionGate hiçbir
  // şey çizmez); olmayan bir yetkinin tarifi ekranda gürültüdür.
  if (!access.canRead) return null;

  return (
    <div className="space-y-4">
      {/* ── VARSAYILAN ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Tag className="h-4 w-4 text-muted-foreground" />
              Varsayılan fiyat
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Müşteri istisnası olmayan <strong>herkese</strong> uygulanır
              {unit ? ` — 1 ${unit} fiyatı.` : "."}
            </p>
          </div>
          {access.editable && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canAdd}
              title={canAdd ? undefined : addBlockedTitle}
              onClick={() => openNew({ scope: "DEFAULT", kind: "SALE", currency: "TRY" })}
            >
              <Plus className="mr-1 h-4 w-4" />
              Fiyat tanımla
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : q.isError ? (
            <ErrorBlock onRetry={() => void q.refetch()} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Yön</TableHead>
                  <TableHead>Para birimi</TableHead>
                  <TableHead>Birim fiyat</TableHead>
                  <TableHead>Son güncelleme</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {cells.map((cell) => (
                  <TableRow key={`${cell.kind}-${cell.currency}`}>
                    <TableCell className="font-medium">{PRICE_KIND_LABEL[cell.kind]}</TableCell>
                    <TableCell>{cell.currency}</TableCell>
                    <TableCell className="tabular-nums">
                      {cell.row ? (
                        <span className="font-semibold">{priceText(cell.row.price, cell.currency)}</span>
                      ) : (
                        // ⚠️ "0,00" YAZMAZ. Boş = "girilmemiş", sıfır = "bedava".
                        <span className="text-xs text-muted-foreground">Fiyat girilmemiş</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {cell.row ? safeFormat(cell.row.updatedAt, "dd.MM.yyyy HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {access.editable &&
                        (cell.row ? (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(cell.row as ItemPriceRow)}>
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              Düzelt
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setRemoveTarget(cell.row)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openNew({ scope: "DEFAULT", kind: cell.kind, currency: cell.currency })}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Tanımla
                          </Button>
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── MÜŞTERİ İSTİSNALARI ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              Müşteri istisnaları
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Yalnız seçilen müşteriye uygulanır ve o müşteride{" "}
              <strong>kart varsayılanının önüne geçer</strong>.
            </p>
          </div>
          {access.editable && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canAdd}
              title={canAdd ? undefined : addBlockedTitle}
              onClick={() => openNew({ scope: "CUSTOMER", kind: "SALE", currency: "TRY" })}
            >
              <Plus className="mr-1 h-4 w-4" />
              İstisna ekle
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : q.isError ? (
            <ErrorBlock onRetry={() => void q.refetch()} />
          ) : exceptions.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Bu kalemde müşteriye özel fiyat yok — <strong>herkese kart varsayılanı</strong> uygulanır.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Müşteri</TableHead>
                  <TableHead>Yön</TableHead>
                  <TableHead>Para birimi</TableHead>
                  <TableHead>Birim fiyat</TableHead>
                  <TableHead>Varsayılana göre</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {exceptions.map((v) => (
                  <TableRow key={v.row.id}>
                    <TableCell className="font-medium">{v.customerLabel}</TableCell>
                    <TableCell>{PRICE_KIND_LABEL[v.row.kind]}</TableCell>
                    <TableCell>{v.row.currency}</TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {priceText(v.row.price, v.row.currency)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {v.base ? (
                        <span className="text-muted-foreground">
                          {priceText(v.base.price, v.base.currency)}
                          {v.deltaPct !== null && (
                            <Badge variant="muted" className="ml-2">
                              {v.deltaPct > 0 ? "+" : ""}
                              {v.deltaPct.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}%
                            </Badge>
                          )}
                        </span>
                      ) : (
                        // Karşılaştırma tabanı yok — uydurma bir oran basmaktansa
                        // sebebini söyleriz.
                        <span className="text-muted-foreground">Varsayılan tanımlı değil</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {access.editable && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(v.row)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Düzelt
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setRemoveTarget(v.row)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Kırpma SESSİZ DEĞİL: sunucu toplamı çekilenden fazlaysa söylenir,
              yoksa kullanıcı göremediği istisnayı YOK sanar.

              ⚠️ KIRPILAN YALNIZ İSTİSNALARDIR ve bu bir tesadüf değil: backend
              satırları `customerId` NULLS FIRST sıralar, yani kart varsayılanları
              (en fazla 2 yön × 5 para birimi = 10 satır) HER ZAMAN ilk sayfadadır.
              Üstteki matris bu yüzden kırpmadan etkilenmez — etkilenseydi var olan
              bir varsayılan "Fiyat girilmemiş" görünür ve kullanıcı onu yeniden
              tanımlayıp eskisini ezerdi. Bu sıralama load-bearing'dir.

              ⚠️ Metin kullanıcıyı GERÇEKTEN VAR OLAN bir yola gönderir. Önceki
              hâli "Kalem Fiyatları ekranındaki filtreleri kullanın" diyordu —
              o ekran aynı paneli aynı sınırla çiziyor ve öyle bir filtresi yok;
              yani tarif çıkmaz sokaktı. Tek müşterinin fiyatını görmenin yolu
              aşağıdaki «Geçerli fiyat kontrolü» kartıdır. */}
          {total > rows.length && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-500">
              Bu kalemde {total} fiyat satırı var; listede ilk {rows.length} tanesi gösteriliyor.{" "}
              <strong>Yukarıdaki varsayılanlar eksiksizdir</strong> — kırpılan yalnız müşteri
              istisnalarıdır.{" "}
              {hideResolveCheck
                ? "Belirli bir müşteriye hangi fiyatın çıktığını Kalem Fiyatları ekranındaki «Geçerli fiyat kontrolü» kartından görebilirsiniz."
                : "Belirli bir müşteriye hangi fiyatın çıktığını görmek için aşağıdaki «Geçerli fiyat kontrolü» kartında o müşteriyi seçin."}
            </p>
          )}
        </CardContent>
      </Card>

      {!hideResolveCheck && <ResolvePriceCard itemId={itemId} itemLabel={itemLabel} />}

      {/* Diyaloglar KOŞULLU mount: her açılış taze bileşen, ön-doldurma yalnız
          başlangıç değeri olarak kalır. */}
      {formOpen && (
        <ItemPriceFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          itemId={itemId}
          itemLabel={itemLabel}
          rows={rows}
          row={editRow}
          initial={formInitial}
          onSaved={invalidate}
        />
      )}

      {removeTarget && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemoveTarget(null)}
          destructive
          title="Fiyat satırı kaldırılsın mı?"
          // Somut liste kuralı: hangi satır, sonra ne olacak, geçmiş ne olacak.
          description={describeRemoval(removeTarget, rows, itemLabel)}
          confirmLabel="Fiyatı kaldır"
          isPending={removeM.isPending}
          onConfirm={() => removeM.mutateAsync(removeTarget.id).then(() => undefined)}
        />
      )}
    </div>
  );
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-center text-sm">
      <p className="font-medium text-destructive">Fiyatlar yüklenemedi.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Bu bir “fiyat tanımlı değil” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi.
        Tanımlı fiyatlarınız yerinde duruyor; yeni fiyat girmeden önce tekrar deneyin.
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Tekrar dene
      </Button>
    </div>
  );
}
