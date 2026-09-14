// =============================================================================
// ELLE İPLİK HAREKETİ — giriş / çıkış / sayım düzeltmesi
// =============================================================================
// ⚠️ MİKTAR HER ZAMAN POZİTİF GİRİLİR, yönü İŞLEM TÜRÜ söyler. Eksi işaretli
// tek bir miktar kutusu, bir gün birinin `Math.abs()` yazıp eksi sayım farkını
// artı saymasına açık kapı bırakırdı — ve o hata deftere DOĞRU GÖRÜNEN bir
// satır olarak yazılırdı. Backend de aynı sözleşmeyi DB CHECK ile kilitliyor.
//
// ⚠️ KUTU `type="number"` DEĞİL `type="text"` + `inputMode="decimal"`. Sebep
// ölçülmüş bir sahne: Chromium'da `type="number"` alanına virgül yazılınca
// değer GEÇERSİZ sayılır ve `e.target.value` BOŞ STRING döner — yani operatör
// "12,5" yazar, ekranda hiçbir şey belirmez ve neden olmadığını söyleyen tek
// kelime yoktur. Metin kutusu yazılanı gösterir, biz de kuralı ÖNDEN söyleriz.
//
// ⚠️ VİRGÜL NOKTAYA ÇEVRİLMEZ (ne burada ne backend'de): "1,500" bu ülkede hem
// "1,5" hem "1500" okunur ve tahmin etmek deftere yanlış rakam yazmanın en
// sessiz yoludur. Kural İKİ katmanda da AYNI cümleyle söylenir; ayrışsalardı
// hangisinin doğru olduğu sorulamazdı.
//
// ⚠️ MİKTAR BACKEND'E **STRING** GİDER, `Number()`'a çevrilmez: çevirmek uzun
// ondalıkta kullanıcının YAZDIĞI değerden farklı bir rakam göndermek olurdu.
//
// ⚠️ SEBEP ALANI SAYIM DÜZELTMESİNDE ÖNE ÇIKAR. `YarnMovement.reason` bir
// KOLONDUR, audit kaydı değil: audit `archive-scheduler` ile 6 ayda bir
// taşınır, kolon kalır (emsal `Roll.entryReason`). Zorunlu değildir — vardiya
// ortasında zorlanan sebep alanı "aaa"/"." ile doldurulur ve o, boş bırakmaktan
// KÖTÜDÜR (denetimde cevap varmış gibi görünür, hiçbir şey söylemez). Bu yüzden
// istenir, dayatılmaz ve boş bırakılırsa sonucu AÇIKÇA yazılır.
//
// ⚠️ `clientToken` GÖNDERİLMEZ: bu ucun Zod şeması `.strict()` ve o anahtarı
// TANIMIYOR → 400. Çift kayıt koruması bekleyen varsa: yoktur. İkinci basış
// ikinci bir defter satırıdır ve TERS KAYITLA kapatılır (defter felsefesi).
// Düğme `isPending` boyunca kapalıdır; asıl güvence budur.
//
// ⚠️ DEPO ÇOK DEPOLU KURULUMDA ÖN SEÇİLMEZ. Yanlış depoya kg yazmak sessizdir:
// iki depo da "gerçek" görünür, fark yalnız sayımda çıkar. Tek depolu kurulumda
// ise seçilecek bir şey yoktur → seçici çizilmez, depo otomatik seçilir.
// =============================================================================
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { cn } from "@/lib/utils";
import {
  YARN_KINDS,
  YARN_KIND_META,
  backendMessage,
  createYarnMovement,
  listYarnLots,
  type YarnMovementKind,
} from "./service";
import { YARN_ITEM_FILTER } from "./YarnFilterBar";
import { useYarnBalance } from "./useYarnBalance";
import { checkQtyInput, isNegative, kg } from "./qty";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Satırdan açıldıysa ön-doldurma. Yalnız BAŞLANGIÇ değeridir (diyalog koşullu mount). */
  initialItemId?: string | null;
  initialWarehouseId?: string | null;
  initialKind?: YarnMovementKind;
  onCreated: () => void;
}

export function YarnMovementDialog({
  open,
  onOpenChange,
  initialItemId,
  initialWarehouseId,
  initialKind,
  onCreated,
}: Props) {
  const { multiWarehouse, warehouses, isLoading: warehousesLoading } = useMultiWarehouse();

  const [kind, setKind] = useState<YarnMovementKind>(initialKind ?? "IN");
  const [itemId, setItemId] = useState<string | null>(initialItemId ?? null);
  const [warehouseId, setWarehouseId] = useState<string>(initialWarehouseId ?? "");
  const [qtyRaw, setQtyRaw] = useState("");
  const [reason, setReason] = useState("");
  // Devere Faz 2: lot etiketi opsiyonel — seçilen ipliğin AKTİF lotları; "" = lot yok (açıkça).
  const [lotId, setLotId] = useState("");
  const lotsQ = useQuery({ queryKey: ["yarn", "lots", itemId, "movement-dialog"], queryFn: () => listYarnLots({ itemId: itemId!, isActive: true, limit: 200 }), enabled: !!itemId });
  const lots = lotsQ.data?.data ?? [];

  // Tek depolu kurulumda seçici çizilmez → depo burada otomatik seçilir. Çok
  // depoluda ASLA ön seçim yapılmaz (dosya başlığındaki gerekçe).
  const onlyWarehouseId = !multiWarehouse ? warehouses[0]?.id : undefined;
  useEffect(() => {
    if (!warehouseId && onlyWarehouseId) setWarehouseId(onlyWarehouseId);
  }, [warehouseId, onlyWarehouseId]);

  const meta = YARN_KIND_META[kind];
  const qtyCheck = checkQtyInput(qtyRaw);

  // Mevcut bakiye — "ne yazıyorum, üstüne ne geliyor" sorusunun cevabı. Kayıt
  // yoksa henüz hiç hareket görmemiş bir kalem/depo çiftidir (bakiye satırı ilk
  // hareketle doğar), bu da söylenir. Sorgu döküm paneliyle ORTAK hook'tadır —
  // iki yüzey aynı anahtarı kullansın diye (bkz. `useYarnBalance`).
  const balance = useYarnBalance(itemId, warehouseId);
  const currentBalance = balance.balanceKg;

  // ⚠️ Yalnız UYARI için karşılaştırma; hesaplanan bir bakiye ASLA ekrana
  // basılmaz. Aritmetik backend'de Decimal ile yapılır — istemcide float ile
  // "yeni bakiye" göstermek, defterdekinden farklı bir rakamı doğruymuş gibi
  // sunmak olurdu.
  //
  // ⚠️ `balance.resolved` ŞART: bakiye henüz okunmadıysa (kalem/depo seçilmedi,
  // sorgu yolda ya da düştü) "bu işlem bakiyeyi EKSİYE düşürür" cümlesi
  // DOĞRULUĞU BİLİNMEYEN bir iddiadır. Bilinmeyeni 0 sayarsak her çıkışta
  // yanlış alarm basardık — üstelik "bakiye okunamadı" satırının hemen altında,
  // yani ekran kendi kendisiyle çelişirdi. Bakiye satırı gerçekten yoksa
  // (`resolved` + null) uyarı DOĞRUDUR ve basılır.
  const willGoNegative =
    meta.sign < 0 &&
    qtyCheck.ok &&
    balance.resolved &&
    Number(qtyCheck.value) > Number(currentBalance ?? 0);

  const valid = Boolean(itemId) && Boolean(warehouseId) && qtyCheck.ok;

  const createM = useMutation({
    mutationFn: (v: { itemId: string; warehouseId: string; qtyKg: string }) =>
      createYarnMovement({
        itemId: v.itemId,
        warehouseId: v.warehouseId,
        kind,
        qtyKg: v.qtyKg,
        reason: reason.trim() || null,
        lotId: lotId || null,
      }),
    onSuccess: (r) => {
      // Backend'in cümlesi yeni bakiyeyi ve gerekirse EKSİ BAKİYE uyarısını
      // taşır — kendi cümlemizle EZMEYİZ.
      if (r.data.negative) toast.warning(r.message ?? "Hareket yazıldı.");
      else toast.success(r.message ?? "Hareket yazıldı.");
      onCreated();
      onOpenChange(false);
    },
    // Hata toast'ı YOK — interceptor backend'in cümlesini zaten basıyor. Aynı
    // cümle ayrıca diyalogda KALICI olarak gösterilir (toast birkaç saniyede
    // kaybolur, düzeltmesi gereken kişi hâlâ formun başındadır).
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>İplik Stok Hareketi</DialogTitle>
          <DialogDescription>
            Defter satırı silinmez, düzeltilmez. Yanlış yazılan bir hareket ters kayıtla (sayım düzeltmesi)
            kapatılır — bu yüzden kaydetmeden önce tür, depo ve miktarı kontrol edin.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label>İşlem türü</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as YarnMovementKind)}
            >
              {YARN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {YARN_KIND_META[k].label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{meta.hint}</p>
          </div>

          <div>
            <Label>İplik</Label>
            <div className="mt-1">
              <ReferenceSelect<Item>
                value={itemId}
                onChange={setItemId}
                service={itemService}
                queryKey="items-yarn"
                getLabel={(it) => `${it.code} — ${it.name}`}
                placeholder="İplik ara..."
                // Yalnız İPLİK kalemleri: kumaş stoğu top (Roll) olarak izlenir
                // ve backend kumaş seçilirse bunu söyleyerek reddeder. Listeyi
                // önden daraltmak o hatayı hiç doğurmaz.
                extraFilters={YARN_ITEM_FILTER}
              />
            </div>
          </div>

          {multiWarehouse && (
            <div>
              <Label>Depo</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">Depo seçin…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {itemId && lots.length > 0 && (
            <div>
              <Label>Lot (isteğe bağlı)</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={lotId} onChange={(e) => setLotId(e.target.value)} aria-label="İplik lotu">
                <option value="">Lot yok</option>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.lotNo} · {kg(l.balanceKg)} kg
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ⚠️ SESSİZ ÇIKMAZ KAPISI: tek depolu kurulumda seçici çizilmediği
              için, depo listesi hiç gelmezse (izin yok / sunucuya ulaşılamıyor)
              "Kaydet" sonsuza dek KAPALI kalır ve sebebi hiçbir yerde yazmaz.
              Kullanıcı formu doğru doldurduğunu bilir, düğme tepki vermez. */}
          {!multiWarehouse && !warehouseId && !warehousesLoading && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              Depo bilgisi okunamadı, bu yüzden hareket yazılamıyor. Sayfayı yenileyip tekrar deneyin; sorun
              sürerse depo tanımlarını görme yetkiniz olmayabilir.
            </p>
          )}

          {itemId && warehouseId && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {balance.isLoading ? (
                <span className="text-muted-foreground">Mevcut bakiye okunuyor…</span>
              ) : balance.isError ? (
                <span className="text-muted-foreground">
                  Mevcut bakiye okunamadı — bu “bakiye yok” demek DEĞİLDİR. Hareket yine de yazılabilir.
                </span>
              ) : balance.resolved && currentBalance === null ? (
                // ⚠️ `resolved` şart: "hiç hareket görmemiş" bir CEVAPTIR, cevap
                // gelmeden söylenemez. Cevapsız durumda aşağıdaki dal koşar ve
                // `kg(null)` sözleşme gereği “—” (bilinmiyor) basar.
                <span className="text-muted-foreground">
                  Bu iplik bu depoda henüz hiç hareket görmemiş — bakiye ilk hareketle başlar.
                </span>
              ) : (
                <span>
                  Mevcut bakiye:{" "}
                  <b className={cn(isNegative(currentBalance) && "text-amber-700 dark:text-amber-500")}>
                    {kg(currentBalance)}
                  </b>
                </span>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="yarn-qty">Miktar (kg)</Label>
            <Input
              id="yarn-qty"
              // Sayı kutusu DEĞİL — dosya başlığındaki virgül tuzağı.
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className="mt-1 text-lg tabular-nums"
              placeholder="Örn. 250 veya 12.5"
              value={qtyRaw}
              onChange={(e) => setQtyRaw(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Ondalık için <b>nokta</b> kullanın (12.5). Miktarı her zaman <b>artı</b> yazın — yönü yukarıdaki
              işlem türü belirler ({meta.sign > 0 ? "bakiyeye eklenir" : "bakiyeden düşer"}).
            </p>
            {/* Boş kutu için uyarı basılmaz: form daha doldurulmadan kırmızı
                göstermek, hata yapmamış kullanıcıyı hata yapmış gibi karşılar. */}
            {!qtyCheck.ok && qtyCheck.problem !== "EMPTY" && (
              <p className="mt-1 text-xs font-medium text-destructive">{qtyCheck.hint}</p>
            )}
          </div>

          <div className={cn(meta.adjustment && "rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40")}>
            <Label htmlFor="yarn-reason">
              {meta.adjustment ? "Düzeltmenin sebebi" : "Açıklama (opsiyonel)"}
            </Label>
            <Textarea
              id="yarn-reason"
              className="mt-1 bg-background"
              rows={2}
              maxLength={300}
              placeholder={
                meta.adjustment
                  ? "Örn. yıl sonu sayımı · çuval yırtığı · yanlış girilen mal kabul düzeltmesi"
                  : "Örn. üretime verildi · X firmasından geldi"
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {meta.adjustment && !reason.trim() && (
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                Sebep yazmazsanız bu düzeltmenin nedeni hiçbir yerde yazmaz — aylar sonra deftere bakan kişi
                yalnız rakamı görür. Zorunlu değil, ama yazın.
              </p>
            )}
          </div>

          {willGoNegative && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Bu işlem bakiyeyi <b>eksiye</b> düşürür. Engellenmez — mal fiziksel olarak çıkmış olabilir,
                eksik olan KAYITTIR. Açılış ya da sayım girişi yapılmadıysa önce onu girmeyi düşünün.
              </span>
            </div>
          )}

          {createM.isError && (
            // Backend'in cümlesi AYNEN — bu projede hata mesajları yol gösterici
            // yazılır ("Ondalık ayırıcı NOKTA'dır…" gibi). Kendi cümlemizle
            // özetlemek tam da işe yarayan kısmı silmek olurdu.
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {backendMessage(createM.error, "Hareket yazılamadı. Bağlantıyı kontrol edip tekrar deneyin.")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={!valid || createM.isPending}
            onClick={() =>
              qtyCheck.ok &&
              itemId &&
              warehouseId &&
              createM.mutate({ itemId, warehouseId, qtyKg: qtyCheck.value })
            }
          >
            {createM.isPending
              ? "Kaydediliyor…"
              : `Kaydet (${meta.sign > 0 ? "+" : "−"}${qtyCheck.ok ? qtyCheck.value : "0"} kg)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
