import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Tag, Undo2, Palette, PackageOpen, Pencil, Ruler, Wrench, AlertTriangle, Send, LogIn } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { safeFormat } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedProgress } from "@/components/motion";
import { StatusBadge, rollStatusTones } from "@/components/operations/StatusBadge";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { RollLabelDialog } from "@/components/labels/RollLabelDialog";
import { RollEditDialog } from "./RollEditDialog";
import { RescueStuckDialog } from "./RescueStuckDialog";
import { RollQtyAdjustDialog } from "./RollQtyAdjustDialog";
import { canAdjustRollQty } from "./qtyAdjustService";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { RollCancelCard } from "./RollCancelCard";
import { rollStatusLabels, rollEntrySourceLabels, rollOperationTypeLabels } from "@/types/enums";
import { rollService } from "./service";
import { type Roll, shipmentScopeLabels, categoryOfDispatch } from "./types";

interface Props {
  roll: Roll | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RollDetailSheet({ roll, open, onOpenChange }: Props) {
  const [labelRollId, setLabelRollId] = useState<string | null>(null);
  const [editRollId, setEditRollId] = useState<string | null>(null);
  const [rescueRollId, setRescueRollId] = useState<string | null>(null);
  const [qtyAdjustOpen, setQtyAdjustOpen] = useState(false);
  const { hasPermission } = useRoleAccess();
  const canManualAdjust = hasPermission("roll:manual-adjust");
  // G4 — "Metraj Düzelt" (sayım) YALNIZ ticaret rejiminde (fabrika sıfır-fark;
  // yüklem bekçili: qtyAdjust.test.ts). RollEditDialog'un ölçüm-düzeltme
  // dalından AYRI iş: burada yalnız currentQty değişir + sapma defteri izi.
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const canQtyAdjust =
    canManualAdjust && !!roll && canAdjustRollQty(roll, financeEnabled);
  // YASAM DONGUSU bolumu AYRI bir izinle korunur (urun karari, 2026-08-05).
  // Izin yoksa bolum HIC CIZILMEZ — bos bir kutu gostermek "bu topun gecmisi
  // yok" yalani olurdu; oysa gecmis var, kullanicinin gorme yetkisi yok.
  const canSeeHistory = hasPermission("roll:history");

  // Liste cevabı `operations` taşımıyor — detay endpoint'i (`/api/rolls/:id`)
  // operation log'unu select ile döndürüyor. Sheet açıldığında lazy fetch.
  const detailQuery = useQuery({
    queryKey: ["roll-detail", roll?.id],
    queryFn: () => rollService.getById(roll!.id),
    enabled: open && !!roll?.id,
    staleTime: 30_000,
  });
  // Ayrı sorgu, ayrı izin: detay ucu (roll:read) herkesin günlük işi, yaşam
  // döngüsü (roll:history) izlenebilirlik verisi. Yetkisiz kullanıcıda istek
  // HİÇ ATILMAZ (enabled) — 403 üretip konsolu kirletmez.
  const historyQuery = useQuery({
    queryKey: ["roll-history", roll?.id],
    queryFn: () => rollService.getHistory(roll!.id),
    enabled: open && !!roll?.id && canSeeHistory,
    staleTime: 30_000,
  });
  // Detay endpoint'i liste cevabında olmayan alanları (operation log, iade, kartela,
  // sevk/çuval) taşır; sheet açıldığında lazy fetch edilir.
  const detail = detailQuery.data?.data;
  /**
   * GÖSTERİM KAYNAĞI — TEK: taze detay varsa O, yoksa liste satırı (`roll`).
   *
   * Eskiden üst blok (barkod/durum/metraj/en/kalite/renk/kat/ağırlık/paket)
   * doğrudan `roll` prop'undan çiziliyordu; o prop LİSTE satırının anlık
   * kopyasıdır ve panel açıkken TAZELENMEZ. Sonuç: sheet içinden yapılan
   * iptal / kalite-metraj düzeltmesi `["roll-detail", id]`'yi tazeliyor,
   * alt bölümler doğru görünüyor ama ÜST ROZET eski değeri göstermeye devam
   * ediyordu (aynı ekranda iki farklı gerçek). Detay ucu (`findRollById`)
   * top-level `include:` kullanır → tüm skaler kolonları döner, yani liste
   * satırının ÜST KÜMESİDİR; alan alan birleştirmeye gerek yok.
   *
   * Fallback yönü önemli: `detail` gelene kadar `roll` çizilir → panel
   * açılışında boş/iskelet üst blok görünmez (mevcut davranış korunur).
   * `roll` null iken (sheet kapalı) bilerek null döner — aksi hâlde önceki
   * topun bayat detayı çizilirdi.
   */
  const r = roll ? (detail ?? roll) : null;
  // "Düzelt": hurda/iptal dışı her top. Yetki/sebep kararı diyaloğun içinde —
  // serbest depoda roll:write|label:edit yeter, üretimdeki topta roll:manual-adjust
  // aranır (backend de aynı guard'ı uygular). Karar TAZE statüden verilir: sheet
  // içinden iptal edilen topta buton anında kaybolur (backend zaten reddederdi).
  const canEditAttributes = !!r && r.status !== "SCRAP" && r.status !== "CANCELLED";
  // "İstasyondan Kurtar" yalnız makinede/istasyonda takılı (IN_PRODUCTION) top için.
  const canRescue = !!r && r.status === "IN_PRODUCTION";
  // En güncel iade kaydı (varsa) — müşteriden dönen top notu/nedeni; Tambur kesimden önce görülür.
  const latestReturn = detail?.returns?.[0] ?? null;
  // AT_KARTELA top: hangi kartela firmasında olduğunu detay panelinde göster.
  const kartelaDispatch = detail?.kartelaDispatchItems?.[0]?.dispatch ?? null;
  // AT_SUBCONTRACTOR top: hangi fason firmasında/işlemde — kartela kartı emsali.
  // Liste cevabı da dispatchItems taşır (fallback) → panel açılır açılmaz dolu görünür.
  const activeDispatch =
    detail?.dispatchItems?.[0]?.dispatch ?? roll?.dispatchItems?.[0]?.dispatch ?? null;
  // Sevkiyat rezervasyonu: top bir çuvala/sevkiyata bağlıysa "serbest depo" değildir.
  // Detay endpoint'i shipment+sack döner; liste cevabı da taşıyabilir (fallback).
  const reservedShipment = detail?.shipment ?? roll?.shipment ?? null;
  const reservedSack = detail?.sack ?? roll?.sack ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-auto">
        <SheetHeader>
          <SheetTitle>Top Detayı</SheetTitle>
          <SheetDescription className="sr-only">
            Top {roll?.barcode ?? ""} · {roll?.item?.name ?? ""} detayı
          </SheetDescription>
        </SheetHeader>

        {roll && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PermissionGate permission="label:read">
              <Button
                type="button"
                size="sm"
                className="gap-1"
                onClick={() => setLabelRollId(roll.id)}
              >
                <Tag className="h-3.5 w-3.5" /> Etiket
              </Button>
            </PermissionGate>
            {/* TEK "Düzelt": renk/metraj/kalite/en/özellik. Üretimdeki topta sebep +
                roll:manual-adjust ister (diyalog kendi içinde yönetir). Eskiden bu iş
                "Yeniden Etiketle/Düzenle" + "Manuel Düzelt" diye iki butondaydı ve
                ikisi de aynı backend motorunu çağırıyordu. */}
            {canEditAttributes && (
              <Button
                type="button"
                size="sm"
                className="gap-1"
                onClick={() => setEditRollId(roll.id)}
              >
                <Pencil className="h-3.5 w-3.5" /> Düzelt
              </Button>
            )}
            {canManualAdjust && canRescue && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setRescueRollId(roll.id)}
              >
                <Wrench className="h-3.5 w-3.5" /> İstasyondan Kurtar
              </Button>
            )}
            {canQtyAdjust && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setQtyAdjustOpen(true)}
              >
                <Ruler className="h-3.5 w-3.5" /> Metraj Düzelt
              </Button>
            )}
          </div>
        )}

        <RollLabelDialog
          rollId={labelRollId}
          onOpenChange={(open) => !open && setLabelRollId(null)}
        />
        <RollEditDialog
          rollId={editRollId}
          onOpenChange={(open) => !open && setEditRollId(null)}
          onSaved={() => void detailQuery.refetch()}
        />
        <RescueStuckDialog
          rollId={rescueRollId}
          onOpenChange={(open) => !open && setRescueRollId(null)}
          onRescued={() => void detailQuery.refetch()}
        />
        <RollQtyAdjustDialog
          roll={qtyAdjustOpen ? roll : null}
          onOpenChange={(open) => !open && setQtyAdjustOpen(false)}
          onAdjusted={() => void detailQuery.refetch()}
        />

        {r && (
          <div className="mt-4 space-y-4">
            {r.barcode ? (
              <Card>
                <CardContent className="flex items-center gap-4 p-3">
                  <div className="rounded bg-white p-2">
                    <QRCodeSVG value={r.barcode} size={112} level="M" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Top Barkodu
                      </div>
                      <div className="mt-1 break-all font-mono text-sm font-semibold">
                        {r.barcode}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-start gap-1">
                      <StatusBadge status={r.status} labels={rollStatusLabels} tones={rollStatusTones} />
                      {r.markedForKartela && (
                        <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300">
                          Kartelalık
                        </Badge>
                      )}
                      {r.labelDirty && (
                        <Badge
                          className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300"
                          title="Veri/metraj düzeltildi; topun üstündeki fiziksel etiket eski — yeniden basılmalı."
                        >
                          <AlertTriangle className="h-3 w-3" /> Etiket güncel değil
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="space-y-2 p-3 text-xs text-muted-foreground">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={r.status} labels={rollStatusLabels} tones={rollStatusTones} />
                    {r.markedForKartela && (
                      <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300">
                        Kartelalık
                      </Badge>
                    )}
                  </div>
                  <div>
                    <Badge variant="outline" className="mr-2 text-[10px]">
                      Açık Kumaş
                    </Badge>
                    Bu rulonun fiziksel barkodu yok — boyahane dönüşü açık kumaş, Kurşun/KK2'de işlenirken üretiliyor.
                  </div>
                </CardContent>
              </Card>
            )}

            {/* İPTAL BİLGİSİ — kimliğin hemen ardında, teknik gridden ÖNCE.
                İptal edilmiş bir topta "kaç metre / hangi en" sorusu ikincildir;
                asıl soru "bu neden ölü ve düzeltebilir miyim"dir. Detay ucundan
                gelen alanlarla çizilir (liste satırı bunları taşımaz). */}
            {detail?.status === "CANCELLED" && <RollCancelCard roll={detail} />}

            <div className="grid grid-cols-3 gap-2 text-sm">
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Metre</div>
                  <div className="mt-0.5">
                    <span className="text-2xl font-semibold tabular-nums">
                      {r.currentQty.toLocaleString("tr-TR", { useGrouping: false })}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">m</span>
                  </div>
                  {r.currentQty !== r.initialQty && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Başlangıç: {r.initialQty.toLocaleString("tr-TR", { useGrouping: false })} m
                    </div>
                  )}
                  {r.initialQty > 0 && (
                    <AnimatedProgress
                      value={(r.currentQty / r.initialQty) * 100}
                      className="mt-2 h-1"
                    />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">En</div>
                  <div className="mt-0.5 font-medium tabular-nums">
                    {r.width != null ? `${r.width} cm` : "—"}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Kalite</div>
                  <div className="mt-0.5 font-medium">
                    {r.qualityGrade ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="space-y-2 p-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="text-xs text-muted-foreground">Kumaş</div>
                  <div>{r.item?.name}</div>
                  <div className="text-xs text-muted-foreground">Biçim</div>
                  <div>
                    <Badge variant="muted" className="text-[10px]">
                      {r.form === "ACIK" ? "Açık Kumaş" : "Top"}
                    </Badge>
                  </div>
                  {r.foldType && (
                    <>
                      <div className="text-xs text-muted-foreground">Kat</div>
                      <div className="text-xs">{r.foldType}</div>
                    </>
                  )}
                  {/* BULUNDUĞU İSTASYON — yalnız bir adımda duran topta anlamlı.
                      Depo/ham stok topunda alan null'dur ve satır çizilmez. */}
                  {detail?.currentStep?.station && (
                    <>
                      <div className="text-xs text-muted-foreground">Bulunduğu İstasyon</div>
                      <div className="text-xs">
                        {detail.currentStep.station.name}
                        {detail.currentStep.workOrder?.workOrderNumber
                          ? ` · ${detail.currentStep.workOrder.workOrderNumber}`
                          : ""}
                      </div>
                    </>
                  )}
                  {r.weightKg != null && (
                    <>
                      <div className="text-xs text-muted-foreground">Ağırlık</div>
                      <div>{r.weightKg.toLocaleString("tr-TR", { useGrouping: false })} kg</div>
                    </>
                  )}
                  {r.color && (
                    <>
                      <div className="text-xs text-muted-foreground">Renk</div>
                      <div className="flex items-center gap-1.5 text-xs">
                        {r.color.hex && (
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: r.color.hex }}
                          />
                        )}
                        {r.color.name}
                      </div>
                    </>
                  )}
                  {r.properties && r.properties.length > 0 && (
                    <>
                      <div className="text-xs text-muted-foreground">Özellikler</div>
                      <div className="flex flex-wrap gap-1">
                        {r.properties.map((p) => (
                          <Badge key={p.propertyId} variant="muted" className="text-[10px]">
                            {/* SEÇİM tipli özellikte DEĞER de basılır ("Gramaj: 50 gr").
                                Yalnız adı basmak, operatörün tablette yaptığı seçimi
                                panelde okunamaz kılardı. */}
                            {p.value ? `${p.property.name}: ${p.value.name}` : p.property.name}
                          </Badge>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* GİRİŞ BİLGİLERİ — "bu top sisteme nereden, ne zaman, kim
                tarafından girdi" sorusunun TEK yeri (2026-08-05 kullanıcı
                talebi: "sidepanelde de rahatça gözüksün").

                Bu alanlar önce teknik özelliklerin (kumaş/en/kat/ağırlık/renk)
                arasına dağılmıştı ve okunmuyordu. İki farklı soruya cevap
                veriyorlar: teknik grid "bu top NEDİR", bu kart "NEREDEN GELDİ".
                Ayrı kart = ayrı soru.

                ⚠️ Liste sütunları bu üçü için varsayılan GİZLİ (envanter
                standardı: liste yüzeyi anlık karar için sade kalır) — bu kart
                onların HER ZAMAN görünen karşılığıdır. */}
            <Card>
              <CardContent className="p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <LogIn className="h-3.5 w-3.5" /> Giriş Bilgileri
                </div>
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
                  <div className="text-xs text-muted-foreground">Giriş Kaynağı</div>
                  <div>
                    <Badge variant="muted" className="text-[10px]">
                      {rollEntrySourceLabels[
                        r.entrySource as keyof typeof rollEntrySourceLabels
                      ] ?? r.entrySource}
                    </Badge>
                  </div>

                  {/* GİRİŞ İSTASYONU — topun DOĞDUĞU istasyon. "Bulunduğu
                      İstasyon"dan (yukarıdaki teknik kart) FARKLIDIR: o, topun
                      ŞU AN nerede olduğunu söyler ve depodaki topta boştur.
                      Bu alan bir daha DEĞİŞMEZ. */}
                  <div className="text-xs text-muted-foreground">Giriş İstasyonu</div>
                  <div className="text-xs">
                    {detail?.entryStation?.name ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* DOKUMA İŞİ (Z2) — tezgahtan inen topta indirme → koşum → iş zincirinden
                      TÜRETİLİR; elle yazılmaz, salt-okunur. Dokuma kökenli olmayan topta çizilmez. */}
                  {(r.entrySource === "WEAVING" || detail?.weavingOrder) && (
                    <>
                      <div className="text-xs text-muted-foreground">Dokuma İşi</div>
                      <div className="text-xs" data-testid="roll-weaving-order">
                        {detail?.weavingOrder ? (
                          <span className="font-mono">{detail.weavingOrder.weavingOrderNumber}</span>
                        ) : (
                          <span className="text-muted-foreground">— (işsiz koşum)</span>
                        )}
                      </div>
                    </>
                  )}

                  <div className="text-xs text-muted-foreground">Ekleyen</div>
                  <div className="text-xs">
                    {detail?.createdBy?.fullName ?? detail?.createdBy?.username ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {detail?.createdMachine?.name ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {detail.createdMachine.name}
                      </span>
                    ) : null}
                  </div>

                  <div className="text-xs text-muted-foreground">Giriş Tarihi</div>
                  <div className="text-xs">{safeFormat(r.createdAt, "dd.MM.yyyy HH:mm")}</div>

                  {/* Sebep YALNIZ elle eklenen topta dolu — diğerlerinde satır
                      hiç çizilmez (boş "Ekleme Nedeni: —" gürültüdür). */}
                  {detail?.manualReason && (
                    <>
                      <div className="text-xs text-muted-foreground">Ekleme Nedeni</div>
                      <div className="text-xs">{detail.manualReason}</div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Sevkiyat rezervasyonu — top bir çuvalın içinde, serbest stok DEĞİL.
                WAREHOUSE statüsüyle görünse de başka işe ayrılamaz (planlı sevkiyat). */}
            {reservedShipment && (
              <Card className="border-amber-300 bg-amber-50/50">
                <CardContent className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-700">
                    <PackageOpen className="h-3.5 w-3.5" /> Sevkiyat Rezervasyonu
                    <Badge
                      variant="outline"
                      className="ml-auto border-amber-500 text-[10px] text-amber-600"
                    >
                      {shipmentScopeLabels[reservedShipment.status] ?? reservedShipment.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-amber-700/80">
                    Bu top bir çuvalın içinde ve bir sevkiyata bağlı — serbest depoda
                    değildir, başka işe (sevk/kartela/iş emri) ayrılamaz.
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div className="text-xs text-muted-foreground">Sevkiyat</div>
                    <div className="font-mono text-xs">{reservedShipment.shipmentNo}</div>
                    {reservedSack && (
                      <>
                        <div className="text-xs text-muted-foreground">Çuval</div>
                        <div className="font-mono text-xs">
                          {reservedSack.sackNo}
                          <span className="ml-1 text-muted-foreground">
                            (Çuval {reservedSack.seq})
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Fason bilgisi — top fason firmasında işlemde (AT_SUBCONTRACTOR). */}
            {r.status === "AT_SUBCONTRACTOR" && (
              <Card>
                <CardContent className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Send className="h-3.5 w-3.5" /> Fason Bilgisi
                  </div>
                  {detailQuery.isLoading && !activeDispatch ? (
                    <Skeleton className="h-10 w-full" />
                  ) : activeDispatch ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <div className="text-xs text-muted-foreground">Firma</div>
                      <div className="font-medium">
                        {activeDispatch.subcontractor.name}
                        {activeDispatch.subcontractor.code
                          ? ` (${activeDispatch.subcontractor.code})`
                          : ""}
                      </div>
                      {categoryOfDispatch(activeDispatch) && (
                        <>
                          <div className="text-xs text-muted-foreground">İşlem</div>
                          <div className="text-xs">
                            {categoryOfDispatch(activeDispatch)?.name}
                          </div>
                        </>
                      )}
                      <div className="text-xs text-muted-foreground">Sevk No</div>
                      <div className="font-mono text-xs">{activeDispatch.dispatchNo}</div>
                      <div className="text-xs text-muted-foreground">Gönderim</div>
                      <div className="text-xs">
                        {safeFormat(activeDispatch.dispatchedAt, "dd.MM.yyyy HH:mm")}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Aktif fason sevki bulunamadı.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Kartela fasonu — top kartela firmasında işlemde (AT_KARTELA). */}
            {r.status === "AT_KARTELA" && (
              <Card>
                <CardContent className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Palette className="h-3.5 w-3.5" /> Kartela Fasonu
                  </div>
                  {detailQuery.isLoading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : kartelaDispatch ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <div className="text-xs text-muted-foreground">Firma</div>
                      <div className="font-medium">
                        {kartelaDispatch.subcontractor.name}
                        {kartelaDispatch.subcontractor.code
                          ? ` (${kartelaDispatch.subcontractor.code})`
                          : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">Sevk No</div>
                      <div className="font-mono text-xs">{kartelaDispatch.dispatchNo}</div>
                      <div className="text-xs text-muted-foreground">Gönderim</div>
                      <div className="text-xs">
                        {safeFormat(kartelaDispatch.dispatchedAt, "dd.MM.yyyy HH:mm")}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Aktif kartela sevki bulunamadı.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* İade bilgisi — müşteriden dönmüş top. Not + neden burada; Tambur kesimden önce görür. */}
            {latestReturn && (
              <Card>
                <CardContent className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Undo2 className="h-3.5 w-3.5" /> İade Bilgisi
                    <span className="ml-auto text-[10px] normal-case text-muted-foreground">
                      {safeFormat(latestReturn.createdAt, "dd.MM.yyyy HH:mm")}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div className="text-xs text-muted-foreground">Neden</div>
                    <div>
                      {latestReturn.reason ? (
                        <Badge
                          variant="secondary"
                          style={
                            latestReturn.reason.color
                              ? {
                                  backgroundColor: `${latestReturn.reason.color}22`,
                                  color: latestReturn.reason.color,
                                }
                              : undefined
                          }
                        >
                          {latestReturn.reason.name}
                        </Badge>
                      ) : latestReturn.reasonText ? (
                        <span>{latestReturn.reasonText}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    {latestReturn.reason && latestReturn.reasonText && (
                      <>
                        <div className="text-xs text-muted-foreground">Açıklama</div>
                        <div className="text-xs">{latestReturn.reasonText}</div>
                      </>
                    )}
                    {latestReturn.note && (
                      <>
                        <div className="text-xs text-muted-foreground">Not</div>
                        <div className="text-xs">{latestReturn.note}</div>
                      </>
                    )}
                    <div className="text-xs text-muted-foreground">İade Metrajı</div>
                    <div className="tabular-nums">
                      {latestReturn.qty.toLocaleString("tr-TR", { useGrouping: false })} m
                    </div>
                    <div className="text-xs text-muted-foreground">Teslim Alan</div>
                    <div className="text-xs">{latestReturn.receivedBy?.fullName ?? "—"}</div>
                  </div>
                </CardContent>
              </Card>
            )}

            {(r.packageId || r.netWeightKg != null) && (
              <Card>
                <CardContent className="space-y-1 p-3 text-sm">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Paketleme
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {r.packageId && (
                      <>
                        <div className="text-xs text-muted-foreground">Paket ID</div>
                        <div className="font-mono text-xs">{r.packageId}</div>
                      </>
                    )}
                    {r.grossWeightKg != null && (
                      <>
                        <div className="text-xs text-muted-foreground">Brüt Ağırlık</div>
                        <div>{r.grossWeightKg.toLocaleString("tr-TR", { useGrouping: false })} kg</div>
                      </>
                    )}
                    {r.netWeightKg != null && (
                      <>
                        <div className="text-xs text-muted-foreground">Net Ağırlık</div>
                        <div>{r.netWeightKg.toLocaleString("tr-TR", { useGrouping: false })} kg</div>
                      </>
                    )}
                    {r.packagingDate && (
                      <>
                        <div className="text-xs text-muted-foreground">Paketleme Tarihi</div>
                        <div>{safeFormat(r.packagingDate, "dd.MM.yyyy HH:mm")}</div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* İŞLEM GEÇMİŞİ — 2026-08-05te KAYNAĞI DEĞİŞTİ.

                Eskiden `detail.operations` (RollOperation tablosu) okunuyordu ve
                panel operatörlerin en sık baktığı toplarda KALICI OLARAK BOŞTU.
                Sebep kablolama hatası değildi: RollOperation bir "yaşam döngüsü
                günlüğü" değil, İSTASYON İŞLEM LOG'udur — yalnız 5 olay tipi
                taşır (kurşun/QC2/Tambur/fason sevk-dönüş) ve her satırı bir iş
                emri adımı ZORUNLU kılar. Depo topu, ham stok topu, elle eklenen
                top ve Tambur kesim çocuğu tanım gereği hiç satır üretmez
                (ölçüm: 72 topun 45'inde hiç kayıt yok). Yani "Henüz işlem kaydı
                yok" cümlesi doğruydu ama YANILTICIYDI — geçmiş vardı, bu tablo
                onu tutmuyordu.

                Artık `/api/rolls/:id/history` okunuyor: movement + operation +
                fason sevk/kabul + doğum + kesim soyağacı BİRLEŞTİRİLMİŞ hâli.
                Bu uç zaten vardı ve mobil Depo ekranı onu kullanıyordu; Electron
                hiç çağırmıyordu. */}
            {canSeeHistory && (
              <Card>
                <CardContent className="p-3">
                  <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <History className="h-3.5 w-3.5" /> İşlem Geçmişi
                  </div>
                  {historyQuery.isLoading ? (
                    <div className="space-y-2">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-9 w-full" />
                      ))}
                    </div>
                  ) : historyQuery.isError ? (
                    <p className="text-xs text-destructive">Geçmiş yüklenemedi.</p>
                  ) : (historyQuery.data?.data?.events?.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">Henüz hareket kaydı yok.</p>
                  ) : (
                    <ol className="relative ml-1 space-y-3 border-l border-border pl-4">
                      {(historyQuery.data?.data?.events ?? []).map((ev, i) => (
                        <li key={`${ev.kind}-${ev.at}-${i}`} className="relative">
                          <span
                            className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background"
                            aria-hidden
                          />
                          <div className="text-sm font-medium leading-tight">{ev.title}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {[ev.stationName, ev.operatorName].filter(Boolean).join(" · ") || "—"}
                            {" · "}
                            {safeFormat(ev.at, "dd.MM.yyyy HH:mm")}
                          </div>
                          {/* details serbest bir sözlüktür (olay tipine göre
                              değişir); ham JSON basmak yerine yalnız METİN/SAYI
                              değerleri okunur — nesne/dizi alanlar atlanır ki
                              panelde "[object Object]" çıkmasın. */}
                          {(() => {
                            const bits = Object.entries(ev.details ?? {})
                              .filter(
                                ([, v]) =>
                                  (typeof v === "string" && v.trim()) ||
                                  typeof v === "number",
                              )
                              .slice(0, 4)
                              .map(([k, v]) => `${k}: ${v}`);
                            return bits.length ? (
                              <div className="mt-0.5 text-[11px] text-muted-foreground/80">
                                {bits.join(" · ")}
                              </div>
                            ) : null;
                          })()}
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="text-[11px] text-muted-foreground">
              Oluşturma: {safeFormat(r.createdAt, "dd.MM.yyyy HH:mm")} ·
              Son güncelleme: {safeFormat(r.updatedAt, "dd.MM.yyyy HH:mm")}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
