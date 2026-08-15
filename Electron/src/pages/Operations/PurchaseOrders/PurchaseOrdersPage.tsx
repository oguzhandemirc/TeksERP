// =============================================================================
// ALIŞ SİPARİŞLERİ — "ne ısmarladım, ne geldi"
// =============================================================================
// NEDEN VAR: mal kabul fişi "ne GELDİ" der. "Ne ısmarlamıştım, kalan ne"
// sorusunun panelde cevabı yoktu ve satın almacı bunu Excel'de tutuyordu —
// Excel'de tutulan taahhüt, tedarikçi eksik gönderdiğinde SESSİZCE kaybolur.
//
// İKİ GÖRÜNÜM, TEK EKRAN:
//   • **Siparişler** — satır = SİPARİŞ. "Hangi siparişi ne zaman açtım."
//   • **Açık kalemler** — satır = KALEM, termin sırasında. "Hangi maldan ne
//     kadar bekliyorum." Aynı veriye iki farklı soruyla bakılıyor; ayrı ekranlara
//     bölmek, satın almacıyı aynı işi iki menüde aratırdı (Kurşun Planlama
//     birleştirmesinin dersi).
//
// ⚠️ TEDARİKÇİ FİLTRESİ İKİ SEKMEDE ORTAKTIR ve bilinçli: "şu tedarikçiden ne
// bekliyorum" sorusu iki görünümde de aynı soru. Ürün filtresi + "yalnız
// gecikmişler" ise yalnız kalem görünümüne aittir (sipariş satırında ürün yok).
//
// ⚠️ DURUM TÜRETİLİR — bu ekranda durum YAZAN hiçbir düğme yoktur. Filtre
// şeridindeki durum seçicisi bir OKUMA daraltmasıdır.
//
// ⚠️ REJİM: bu ekran ticaret paketine aittir; fabrikada `finance.enabled`
// kapalıdır ve uçlar `requireFinanceEnabled` ile 403 döner. Karo/route
// görünürlüğü dikişi ANA OTURUMDA bağlanır (bkz. teslim notu) — sayfa kendi
// başına bir rejim kapısı ÇİZMEZ, çünkü kullanıcı buraya ancak görünür bir
// yoldan gelir ve iki yerde iki kapı, biri değişince sessizce ayrışırdı.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionGate } from "@/components/PermissionGate";
import { supplierPartyQuery } from "@/components/forms/supplierParty";
import { listPurchaseOrders, type PurchaseOrderListRow } from "./service";
import { PurchaseOrderTable } from "./PurchaseOrderTable";
import { PurchaseOrderFormDialog } from "./PurchaseOrderFormDialog";
import { PurchaseOrderDetailSheet } from "./PurchaseOrderDetailSheet";
import { CancelPurchaseOrderDialog } from "./CancelPurchaseOrderDialog";
// Sipariş → fiş tıkla-git; bağ geri çağrıyla kurulur (gerekçe: mount noktası).
import { GoodsReceiptDetailSheet } from "../GoodsReceipts/GoodsReceiptDetailSheet";
import { OpenLinesPanel } from "./OpenLinesPanel";
import {
  EMPTY_PO_FILTERS, PurchaseOrderFilterBar, isPoFilterDirty, type PurchaseOrderFilterState,
} from "./PurchaseOrderFilterBar";
import { dayEndIso, dayStartIso } from "./dates";

const PAGE_SIZE = 100;

export function PurchaseOrdersPage() {
  const [filters, setFilters] = useState<PurchaseOrderFilterState>(EMPTY_PO_FILTERS);
  const [tab, setTab] = useState<"orders" | "open-lines">("orders");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  // Sipariş detayından açılan mal kabul fişi (tıkla-git, 2026-08-15).
  const [receiptId, setReceiptId] = useState<string | null>(null);
  // Kalem görünümünün kendi daraltmaları (sipariş satırında ürün/termin yok).
  const [openLineItemId, setOpenLineItemId] = useState<string | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const { search, status, supplier, dateFrom, dateTo } = filters;

  const q = useQuery({
    queryKey: ["purchase-orders", search, status, supplier?.kind ?? "", supplier?.id ?? "", dateFrom, dateTo],
    queryFn: () =>
      listPurchaseOrders({
        page: 1,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        status: status || undefined,
        // C4 — daraltma DOĞRU BACAKTAN gider; yanlış anahtar boş liste döndürür
        // ve satın almacı "bu tedarikçiye sipariş yok" sanır.
        ...supplierPartyQuery(supplier),
        // Gün sınırı İSTEMCİNİNDİR: yerel 00:00 / 23:59:59.999 (bkz. dates.ts).
        // Boş/bozuk değer `undefined` döner → parametre hiç gitmez.
        dateFrom: dayStartIso(dateFrom),
        dateTo: dayEndIso(dateTo),
      }),
  });

  const rows: PurchaseOrderListRow[] = q.data?.data ?? [];
  const total = q.data?.pagination?.total ?? 0;
  const dirty = isPoFilterDirty(filters);

  const openEdit = (id: string) => {
    setEditId(id);
    setFormOpen(true);
  };

  return (
    <PageShell>
      <PageHeader
        title="Alış Siparişleri"
        description="Tedarikçiye verilen sipariş bir TAAHHÜTTÜR — stoğa hiçbir şey yazmaz. Mal geldikçe mal kabul fişi siparişe bağlanır ve “ne kaldı” kendiliğinden hesaplanır."
        actions={
          <PermissionGate permission="purchase-order:write">
            <Button
              onClick={() => {
                setEditId(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              Yeni Sipariş
            </Button>
          </PermissionGate>
        }
      />

      {/* ⚠️ Şerit sekmeye göre daralır: "Ne bekliyorum?" KALEM ucundan besleniyor
          ve o uç arama/durum/tarih tanımıyor — çizili bıraksaydık kullanıcı
          yazar, liste değişmez, ekran "bozuk" görünürdü. */}
      <PurchaseOrderFilterBar
        value={filters}
        onChange={setFilters}
        scope={tab === "orders" ? "orders" : "open-lines"}
      />

      <PageBody className="p-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="orders">Siparişler</TabsTrigger>
            {/* Ekranın asıl sorusu bu sekmede — adı da soruyla aynı. */}
            <TabsTrigger value="open-lines">Ne bekliyorum?</TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            {q.isLoading ? (
              <p className="text-sm text-muted-foreground">Yükleniyor…</p>
            ) : q.isError ? (
              /* "HATA" ile "KAYIT YOK" AYRI EKRANLAR: boş diziyi "sipariş yok"
                 diye basmak, kullanıcıyı aynı siparişi ikinci kez açmaya iter.
                 Interceptor'ın toast'ı birkaç saniyede kaybolur; ekranda kalan
                 cümle doğruyu söylemek zorunda. */
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
                <p className="font-medium text-destructive">Sipariş listesi yüklenemedi.</p>
                <p className="mt-1 text-muted-foreground">
                  Bu bir “sipariş yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi.
                  Kayıtlarınız yerinde duruyor; yeni sipariş açmadan önce tekrar deneyin.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
                  Tekrar dene
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                {dirty
                  ? "Bu filtreyle sipariş yok. Tamamlanan ve iptal edilenleri görmek için durum filtresini “Tümü” yapın."
                  : "Henüz alış siparişi yok. “Yeni Sipariş” ile tedarikçiye verdiğiniz siparişi kaydedin; mal geldikçe kalan miktar kendiliğinden düşer."}
              </div>
            ) : (
              <>
                <PurchaseOrderTable
                  rows={rows}
                  onDetail={(r) => setDetailId(r.id)}
                  onEdit={(r) => openEdit(r.id)}
                  onCancel={(r) => setCancelId(r.id)}
                />
                {total > rows.length && (
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-500">
                    {total} siparişin ilk {rows.length} tanesi gösteriliyor (en yeni önce). Aradığınızı
                    bulmak için arama, tedarikçi ya da tarih filtresini kullanın.
                  </p>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="open-lines">
            <OpenLinesPanel
              supplier={supplier}
              itemId={openLineItemId}
              onItemChange={setOpenLineItemId}
              overdueOnly={overdueOnly}
              onOverdueChange={setOverdueOnly}
              onOpenOrder={setDetailId}
            />
          </TabsContent>
        </Tabs>
      </PageBody>

      {/* Diyaloglar KOŞULLU mount edilir: her açılış taze bileşen demektir —
          ön-doldurma yalnız başlangıç değeri olarak kalır ve `clientToken`
          form oturumu başına bir kez doğar. */}
      {formOpen && (
        <PurchaseOrderFormDialog
          open={formOpen}
          orderId={editId}
          onOpenChange={(o) => {
            setFormOpen(o);
            if (!o) setEditId(null);
          }}
          onSaved={(id) => {
            if (id) setDetailId(id);
          }}
        />
      )}

      <PurchaseOrderDetailSheet
        id={detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        onEdit={(id) => {
          setDetailId(null);
          openEdit(id);
        }}
        onCancel={(id) => {
          setDetailId(null);
          setCancelId(id);
        }}
        // ⭐ SİPARİŞ → FİŞ: uyarı bandı "aşağıdaki fişleri açıp kontrol edin"
        // diyor; eylem artık gerçekten var. Sipariş sheet'i AÇIK KALIR —
        // kullanıcı fişi kapatınca siparişin başına döner.
        onOpenReceipt={setReceiptId}
      />

      {/* Fiş yüzeyi sahibinin bileşeni; burada yalnız mount edilir. Bu bağ
          İMPORT ile değil geri çağrı ile kuruldu: fiş sheet'i sipariş sheet'ini
          zaten import ediyor (fiş → sipariş yönü) ve karşılıklı import modül
          döngüsü demekti. */}
      <GoodsReceiptDetailSheet id={receiptId} onOpenChange={(o) => !o && setReceiptId(null)} />

      {cancelId && (
        <CancelPurchaseOrderDialog
          orderId={cancelId}
          onOpenChange={(o) => !o && setCancelId(null)}
          onCancelled={() => setCancelId(null)}
        />
      )}
    </PageShell>
  );
}
