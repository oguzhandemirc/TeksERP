import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Keyboard, Layers, Loader2, Lock, MoreVertical, PackageOpen, PackagePlus, RefreshCw, Scale, Tag, Trash2, Truck, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";
import { sackHubService } from "./service";
import { invalidateSackHub, useSackContents } from "./useSackData";
import { EditorScanBar } from "./EditorScanBar";
import { WeighSackDialog } from "./WeighSackDialog";
import { AddKartelaDialog } from "./AddKartelaDialog";
import { DeleteSackDialog } from "./DeleteSackDialog";
import { DistributeSackDialog } from "./DistributeSackDialog";
import { ReassignCustomerDialog } from "./ReassignCustomerDialog";
import { AssignPackingGroupDialog } from "./AssignPackingGroupDialog";
import { CreateShipmentDialog, type ShipmentDialogSack } from "./CreateShipmentDialog";
import { SackContentsTable } from "./SackContentsTable";
import { SackContentDumpMenu } from "./SackContentDumpMenu";
import { fromDumpRows } from "./sackDump";
import { SackNoteDialog } from "./SackNoteDialog";
import { PackageNoDialog } from "./PackageNoDialog";
import { useSackWeighAction } from "./useSackWeighAction";
import { StaleLabelsBanner } from "./StaleLabelsBanner";
import { ContentMismatchBanner } from "./ContentMismatchBanner";
import { SackIdentityStrip, SackNoBox } from "./SackIdentityStrip";
import { SackLabelDialog } from "@/components/labels/SackLabelDialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { usePackingGroupMode, usePackingGroupsEnabled, useShippingManualWeightRestrictedEnabled } from "@/hooks/usePricingEnabled";
import type { EditorTarget } from "./types";

/** Editör hedefine geri yazılan yama — müşteri/şube (ReassignCustomerDialog) ya da parti/ambalaj no. */
export type EditorPatch = Partial<
  Pick<EditorTarget, "customerId" | "customerName" | "branchId" | "branchName" | "branchCode" | "packingGroupId" | "packingGroupName" | "packageNo">
>;


/**
 * Tek çuval editörü (Çuval Depo modeli) — mühür YOK, depodaki çuval her zaman
 * düzenlenebilir. Okut (ekle/taşı) · tart · kartela ekle · içeriği seç → depoya
 * çıkar / başka çuvala aktar (SackContentsTable) · çuvalı dağıt · sil.
 */
export function SackEditorView({
  target,
  onExit,
  onReassigned,
  onSwitchSack,
}: {
  target: EditorTarget;
  onExit: () => void;
  onReassigned: (patch: EditorPatch) => void;
  /** "Yeni Çuval" — editörü YENİ açılan çuvala geçirir (liste ekranına dönmeden). */
  onSwitchSack: (target: EditorTarget) => void;
}) {
  const qc = useQueryClient();
  // ELLE TARTI KISITI — bayrak açıkken yalnız `shipping:write` taşıyan kimlik
  // elle kg girebilir (yeni izin kodu YOK; ayrım mevcut yetkilerle kurulur).
  // ⚠️ Otorite SUNUCUDA: burada yapılan yalnız yolu göstermemek.
  const { hasPermission } = useRoleAccess();
  const manualWeightRestricted = useShippingManualWeightRestrictedEnabled();
  const canEnterManualWeight = !manualWeightRestricted || hasPermission("shipping:write");
  const contentsQ = useSackContents(target.sackId);
  const data = contentsQ.data?.data;
  const rolls = data?.rolls ?? [];
  const swatches = data?.swatches ?? [];
  const locked = !!data?.shipment; // sevkiyata atanmışsa içerik kilitli
  const totalQty = rolls.reduce((a, r) => a + Number(r.currentQty), 0);
  const hasContents = rolls.length > 0 || swatches.length > 0;

  const [weighOpen, setWeighOpen] = useState(false);
  const [kartelaOpen, setKartelaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [packageNoOpen, setPackageNoOpen] = useState(false);
  // Tartı: tek dokunuş (oku → doğrudan kaydet). Elle giriş ⌄ menüsünde.
  const sackWeigh = useSackWeighAction();
  const groupsEnabled = usePackingGroupsEnabled();
  const lotMode = usePackingGroupMode() === "sevk-partisi";
  // Parti rozeti ve "Yeni Çuvala Geç" hedefi `target`tan okunur; "Partiye Al" sonrası
  // sunucudaki parti/ambalaj no içerik yanıtıyla gelir → hedefe geri yazılır.
  useEffect(() => {
    if (!data || data.packingGroupId === undefined) return;
    const gid = data.packingGroupId ?? null;
    const no = data.packageNo ?? null;
    if (gid === (target.packingGroupId ?? null) && no === (target.packageNo ?? null)) return;
    onReassigned({ packingGroupId: gid, packingGroupName: data.packingGroup?.name ?? null, packageNo: no });
  }, [data, target.packingGroupId, target.packageNo, onReassigned]);

  // ── "Yeni Çuval" — aynı cariye ARDIŞIK çuval açma (2026-09-04 saha isteği) ──
  // *"bir çuval açtın, içini doldurdun; hemen yeni çuval açmak için tuş koy, bu
  // yeni çuval önceki çuvalın carisine açılsın."* Yeni uç GEREKMEDİ: `openSack`
  // zaten `customerId`/`branchId` alıyor (ölçüldü) — eksik olan tek şey çıkıştı;
  // bugüne kadar operatör "Listeye Dön → Yeni Çuval → cariyi tekrar seç"
  // yapmak zorundaydı ve müşteri seçimini unutmak müşterisiz çuval üretiyordu.
  //
  // ⚠️ ŞUBE DE DEVREDİLİR: yalnız müşteriyi taşımak, şubeli (ihracat kodlu)
  // carilerde ikinci çuvalı şubesiz doğururdu — sevk belgesinde "İhracat Kodu"
  // satırı sessizce düşerdi.
  //
  // ⚠️ İdempotency (A4): token DENEME başına sabit — başarıda yenilenir, kesin
  // 4xx'te de yenilenir (orada hiçbir şey yazılmadığı kesin), ağ/5xx'te YAPIŞIR
  // (timeout "yazılmadı" demek DEĞİLDİR → aynı token replay'e düşer).
  const nextSackToken = useRef(crypto.randomUUID());
  // Sevk partisi (2026-09-21): çuval bir partideyse "Yeni Çuval" AYNI partiye açılır ve
  // sıradaki ambalaj numarasını alır ("yeni çuvala geç" — K6 senaryosu). Cari partiden.
  const newSackMut = useMutation({
    mutationFn: () =>
      sackHubService.openSack({
        customerId: target.packingGroupId ? null : target.customerId,
        branchId: target.packingGroupId ? null : target.branchId,
        clientToken: nextSackToken.current,
        packingGroupId: target.packingGroupId ?? null,
      }),
    onSuccess: (res) => {
      nextSackToken.current = crypto.randomUUID();
      invalidateSackHub(qc);
      toast.success(
        res.data.packageNo != null && res.data.packingGroupName
          ? `Çuval açıldı: ${res.data.sackNo} · ${res.data.packingGroupName} · Ambalaj No ${res.data.packageNo}`
          : `Çuval açıldı: ${res.data.sackNo}` +
              (res.data.customerName ? ` · ${res.data.customerName}` : " · müşterisiz (genel stok)"),
      );
      onSwitchSack({
        sackId: res.data.id,
        sackNo: res.data.sackNo,
        customerId: res.data.customerId,
        customerName: res.data.customerName,
        branchId: res.data.branchId,
        branchName: res.data.branchName,
        branchCode: res.data.branchCode,
        isNew: true,
        packingGroupId: res.data.packingGroupId ?? null,
        packingGroupName: res.data.packingGroupName ?? null,
        packageNo: res.data.packageNo ?? null,
      });
    },
    onError: (e: unknown) => {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status && status >= 400 && status < 500) nextSackToken.current = crypto.randomUUID();
    },
  });

  const removeSwatchMut = useMutation({
    mutationFn: (swatchId: string) => sackHubService.removeSwatchFromSack(swatchId),
    onSuccess: () => invalidateSackHub(qc),
  });

  return (
    <PageShell>
      {/* Başlık — diğer sayfalarla AYNI `PageHeader` (ok · dikey çizgi · tonlu zemin);
          başlık yanında kutulu kimlik şeridi (top · m · kg · cari · parti · ambalaj no;
          cari ve parti hücreleri tıklanınca ilgili pencereyi açar). Sağda AKIŞ (sıradaki
          çuval · sevk · ⋮), altta DOLDUR ve ÇIKTI grupları. Saha 2026-09-22. */}
      <PageHeader
        title={<SackNoBox sackNo={target.sackNo} />}
        parent={null}
        actionsAlign="center"
        onBack={onExit}
        titleExtra={
          <SackIdentityStrip
            target={target}
            stats={{ rolls: rolls.length, meters: totalQty, kg: data?.weightKg ?? null, swatches: swatches.length }}
            note={data ? data.notes : undefined}
            // Not kilitli çuvalda DA düzenlenir (annotation; içerik/ölçüm değil).
            onNote={data ? () => setNoteOpen(true) : undefined}
            onPackageNo={locked ? undefined : () => setPackageNoOpen(true)}
            onCustomer={locked ? undefined : () => setReassignOpen(true)}
            // Parti — çuval carisiz ise önce Müşteri (parti cariye özel; diyalog sebebini söyler).
            onLot={locked || !groupsEnabled ? undefined : () => setAssignOpen(true)}
            lotMode={lotMode}
          />
        }
        actions={
          <>
            {/* Sıradaki çuval — kilitli çuvalda DA açılabilir: bu bir OKUMA değil,
                yeni bir kayıt yaratma yolu; mevcut çuvalın sevkiyata atanmış olması
                aynı cariye yeni çuval açmayı engellemez. */}
            <Button
              variant="secondary"
              size="sm"
              className="gap-1"
              disabled={newSackMut.isPending}
              title={
                target.packingGroupName
                  ? `${target.packingGroupName} partisinde sıradaki çuvalı aç (yeni ambalaj no) ve doldurmaya devam et`
                  : target.customerName
                    ? `Aynı cariye (${target.customerName}) yeni çuval aç ve doldurmaya devam et`
                    : "Müşterisiz (genel stok) yeni çuval aç ve doldurmaya devam et"
              }
              onClick={() => newSackMut.mutate()}
            >
              <PackagePlus className="h-4 w-4" />
              {newSackMut.isPending ? "Açılıyor…" : target.packingGroupName ? "Yeni Çuvala Geç" : "Yeni Çuval"}
            </Button>
            {/* ── TEK ÇUVAL SEVKİ (2026-09-04 saha isteği) ────────────────
                *"bir çuvalın içindeyken onu direkt sevk edebilirim, bazen tek
                çuval sevkiyatı yapılır; şu an çuvallar ekranına geri dönüp
                çuvalı seçip sevk et demem gerekiyor, bu pratik değil."*

                ⚠️ KISAYOL, BYPASS DEĞİL: listedeki "Sevkiyat Kur" ile AYNI
                `CreateShipmentDialog` açılır — yani müşteri/şube çözümü,
                sipariş seçimi, `shipping.orderRequirement` (`warn`/`block`)
                kapısı, tartı kuralı, içerik-uyuşmazlığı uyarısı, idempotency
                token'ı ve `shipping.confirmationEnabled` rejimi (PLANNED mı
                doğrudan sevk mi) HEPSİ aynı yerden gelir. Burada YAZILAN tek
                şey yok; defter (`SackAllocation`) yine sunucudaki tek yoldan
                yazılır. İkinci bir "hızlı sevk" ucu açmak, o kapıların
                ayrışacağı ilk yer olurdu.

                ⚠️ İZİN: ayrı bir yüklem YOK ve bilinçli — liste ekranındaki
                ikizi de izin sormaz, otorite sunucudadır (`POST /shipments`
                → `shipping:write`). Burada kapı koymak iki yüzeyi ayrıştırır.

                ⚠️ MÜŞTERİSİZ ÇUVAL — buton yine ÇİZİLİR. Karar: `Sack.customerId`
                opsiyoneldir ama SEVKİYAT müşterisizdir OLAMAZ (irsaliye ve
                `SackAllocation` cari ister). Diyalog bu durumda müşteri
                kilidini bulamaz ve aramalı cari seçicisini açar; "Sevk Et"
                cari seçilene kadar pasiftir (`canCreate`). Yani tek tık sevk
                ETMEZ, sevkiyatı KURAR — müşterisiz çuvalda butonu hiç
                göstermemek ise operatöre "bu çuval sevk edilemez" yalanını
                söylerdi (edilebilir; cari sevk anında atanır — çuval havuzu
                tasarımının kendi kuralı).

                ⚠️ Kilitli (sevkiyata atanmış) çuvalda ÇİZİLMEZ: `!locked`
                bloğunun içinde — mal zaten bir sevkiyatta. Boş çuvalda pasif:
                backend "Boş çuval sevk edilemez" ile 400 verir, kullanıcıyı
                oraya kadar götürmeyiz. */}
            {!locked && (
              <Button
                size="sm"
                className="gap-1"
                disabled={!data || !hasContents}
                title={
                  hasContents
                    ? "Bu çuvaldan sevkiyat kur (listeye dönmeden)"
                    : "Boş çuval sevk edilemez — önce içine top okutun"
                }
                onClick={() => setShipOpen(true)}
              >
                <Truck className="h-4 w-4" /> Sevk Et
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="px-2" aria-label="Diğer işlemler">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void contentsQ.refetch()} disabled={contentsQ.isFetching}>
                  <RefreshCw className={cn("mr-2 h-4 w-4", contentsQ.isFetching && "animate-spin")} /> Yenile
                </DropdownMenuItem>
                {!locked && (
                  <>
                    <DropdownMenuSeparator />
                    {hasContents && (
                      <DropdownMenuItem onSelect={() => setDistributeOpen(true)}>
                        <PackageOpen className="mr-2 h-4 w-4" /> Dağıt (içerik depoya)
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteOpen(true)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Çuvalı Sil
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
          {!locked && (
            <div className="flex items-center gap-1">
              {/* TEK DOKUNUŞ tartı: kantardan oku → doğrudan kaydet (diyalog YOK).
                  Elle giriş yanındaki ⌄ menüsünde — kantar bozuksa kaçış yolu. */}
              <div className="flex">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-r-none border-r-0"
                  disabled={sackWeigh.busy}
                  title={
                    sackWeigh.hasScale
                      ? "Kantardan oku ve kaydet"
                      : "Kantar tanımlı değil — ⌄ menüsünden elle girin"
                  }
                  onClick={() => data && void sackWeigh.weigh({ id: data.id, sackNo: data.sackNo })}
                >
                  <Scale className={cn("mr-1 h-4 w-4", sackWeigh.busy && "animate-pulse")} />
                  {sackWeigh.busy ? "Tartılıyor…" : "Tart"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-l-none px-1.5"
                      aria-label="Tartı seçenekleri"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {/* ⚠️ GRİ BUTON DEĞİL, ÇİZİLMEZ: olmayan bir yolu vaat etmek
                        (belge tasarım izni dersi). Sunucu zaten 403 verir —
                        burada yapılan iş yalnız kullanıcıyı oraya kadar
                        götürmemek. Yüklem izne VE bayrağa birlikte bakar. */}
                    {canEnterManualWeight ? (
                      <DropdownMenuItem onClick={() => setWeighOpen(true)}>
                        <Keyboard className="mr-2 h-4 w-4" /> Elle kg gir
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem disabled>
                        <Keyboard className="mr-2 h-4 w-4" /> Elle giriş kapalı — kantardan tartın
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button variant="outline" size="sm" onClick={() => setKartelaOpen(true)}>
                <Layers className="mr-1 h-4 w-4" /> Kartela Ekle
              </Button>
            </div>
          )}

          {/* ÇIKTI grubu — kilitli çuvalda DA açık: baskı/not içeriği değiştirmez;
              sevkteki çuvalın etiketi yırtılırsa yenisi gerekir. */}
          <div className={cn("flex items-center gap-1", !locked && "border-l pl-2")}>
            {/* ÇUVALIN KENDİ etiketi bayatsa (müşteri değişti + müşteriye özel çuval
                şablonu farklı) tuş uyarı rengine döner: üstteki `StaleLabelsBanner`
                TOPLARIN etiketini anlatır, bu ayrı bir nesnedir. Baskıda temizlenir
                (`recordSackPrintEvent`). */}
            <Button
              variant={data?.labelDirty ? "default" : "outline"}
              size="sm"
              onClick={() => setLabelOpen(true)}
              title={
                data?.labelDirty
                  ? "Bu çuvalın etiketi bayat — müşteri değişti ve yeni müşterinin çuval şablonu farklı. Yeniden basın."
                  : undefined
              }
            >
              <Tag className="mr-1 h-4 w-4" />
              {data?.labelDirty ? "Etiket Bas (yenilenmeli)" : "Etiket Bas"}
            </Button>
            {/* İçerik dökümü — SEÇİM GEREKMEZ, çuvalın tamamını alır. Bellekteki
                `contentsQ` verisi DEĞİL, liste ekranıyla AYNI uç kullanılır:
                (a) "top fiziksel olarak çuvalda mı" kararı tek yerde (backend
                `SACK_ABSENT_STATUSES`) kalır — editör tablosu hayalet topu bilerek
                GÖSTERİR, belge ise saymaz; istemcide statü listesi kopyalamayız.
                (b) baskı her seferinde TAZE veriyle çıkar (bayat kg/içerik kağıda gitmesin). */}
            <SackContentDumpMenu
              label="Döküm"
              disabled={!data || !hasContents}
              hasNotes={!!data?.notes}
              load={async () => fromDumpRows((await sackHubService.contentDump([target.sackId])).data)}
            />
          </div>

      </div>

      {/* Etiketi bayatlayan toplar VARSA uyarı + tek tuşla yeniden bas. Yoksa
          bileşen null döner, hiç yer kaplamaz. */}
      <StaleLabelsBanner
        rolls={rolls}
        customerId={target.customerId}
        customerName={target.customerName}
      />

      {/* İçerik uyuşmazlığı (2026-08-09) — StaleLabels ile FARKLI soru: o
          "müşteri değişti, etiket bayatladı" der, bu "içerideki toplar bu
          müşteriye uyuyor mu" der. İkisi aynı çuvalda birden çıkabilir. */}
      <ContentMismatchBanner sackId={data?.id ?? null} rollCount={rolls.length} />

      {locked ? (
        <div className="px-6 py-3">
          <Callout tone="warning" icon={Lock} title="Bu çuval bir sevkiyata atanmış">
            İçeriği kilitli. Düzenlemek için önce çuvalı sevkiyattan ayırın: Sevkiyatlar'dan
            sevkiyatı iptal edin (çuvallar depoya döner) ya da — sevk onayı açıksa — Sevk
            Kapısı'nda çuvalı çıkarın. (Yorum yine düzenlenebilir.)
          </Callout>
        </div>
      ) : (
        <EditorScanBar sackId={target.sackId} />
      )}

      {/* İçerik — liste ekranlarıyla aynı: DataTable alanı TAM kaplar (p-6/çerçeve yok). */}
      <div className="flex min-h-0 flex-1 flex-col">
        {contentsQ.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        ) : (
          <>
            <SackContentsTable
              sackId={target.sackId}
              rolls={rolls}
              locked={locked}
              sourceCustomerId={target.customerId}
              sourceCustomerName={target.customerName}
            />

            {swatches.length > 0 && (
              <div className="border-t">
                <div className="bg-muted/40 px-6 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Kartelalar · {swatches.length}
                </div>
                <ul className="max-h-48 divide-y overflow-y-auto text-sm">
                  {swatches.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 px-6 py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs">{s.barcode ?? "Kartela"}</span>
                        <span className="text-muted-foreground">
                          {s.item.name}
                          {s.color ? ` · ${s.color.name}` : ""}
                        </span>
                      </span>
                      {!locked && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title="Kartelayı çıkar"
                          disabled={removeSwatchMut.isPending}
                          onClick={() => removeSwatchMut.mutate(s.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <WeighSackDialog
        sack={weighOpen && data ? { id: data.id, sackNo: data.sackNo, weightKg: data.weightKg } : null}
        onOpenChange={setWeighOpen}
      />
      <SackLabelDialog
        sack={labelOpen && data ? { id: data.id, sackNo: data.sackNo } : null}
        onOpenChange={setLabelOpen}
      />
      <SackNoteDialog
        sack={noteOpen && data ? { id: data.id, sackNo: data.sackNo, notes: data.notes } : null}
        onOpenChange={setNoteOpen}
      />
      <PackageNoDialog
        sack={packageNoOpen ? { id: target.sackId, sackNo: target.sackNo, packageNo: target.packageNo ?? null, lotName: target.packingGroupName ?? null } : null}
        onOpenChange={setPackageNoOpen}
        onSaved={(packageNo) => onReassigned({ packageNo })}
      />
      <AddKartelaDialog sackId={kartelaOpen ? target.sackId : null} onOpenChange={setKartelaOpen} />
      <DeleteSackDialog
        sack={deleteOpen && data ? { id: data.id, sackNo: data.sackNo, rolls, swatches } : null}
        onOpenChange={setDeleteOpen}
        onDeleted={onExit}
      />
      <DistributeSackDialog
        sack={distributeOpen && data ? { id: data.id, sackNo: data.sackNo, rollCount: rolls.length, swatchCount: swatches.length } : null}
        onOpenChange={setDistributeOpen}
        onDistributed={(deleted) => {
          if (deleted) onExit();
        }}
      />
      <AssignPackingGroupDialog
        sacks={assignOpen ? [{ id: target.sackId, customer: target.customerId ? { id: target.customerId, name: target.customerName ?? "" } : null }] : null}
        onOpenChange={setAssignOpen}
        onDone={() => void contentsQ.refetch()}
        lot={lotMode}
      />
      <ReassignCustomerDialog
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        sackId={target.sackId}
        initialCustomerId={target.customerId}
        initialBranchId={target.branchId}
        onReassigned={onReassigned}
      />
      {/* Liste ekranıyla AYNI diyalog, tek elemanlı seçimle. Satır `target`ten
          kurulur çünkü `SackContents` (içerik ucu) sevke girmemiş çuvalda
          müşteri/şube DÖNDÜRMEZ; `target` ise "Müşteri" düzenlemesinden sonra
          `onReassigned` ile yamalandığı için TAZEdir.
          ⚠️ `notePreview` 80 karaktere kırpılır — liste ucunun sözleşmesinin
          aynası (types.ts); tam metni geçmek diyaloğun not şeridini listedekiyle
          farklı uzunlukta basardı. */}
      <CreateShipmentDialog
        sacks={
          shipOpen && data
            ? [
                {
                  id: data.id,
                  sackNo: data.sackNo,
                  weightKg: data.weightKg,
                  customer: target.customerId
                    ? { id: target.customerId, name: target.customerName ?? "" }
                    : null,
                  branch: target.branchId
                    ? { id: target.branchId, name: target.branchName ?? "", code: target.branchCode }
                    : null,
                  hasNote: !!data.notes,
                  notePreview: data.notes ? data.notes.slice(0, 80) : null,
                } satisfies ShipmentDialogSack,
              ]
            : null
        }
        onOpenChange={(o) => !o && setShipOpen(false)}
        // Diyalog kapanır, editörde KALINIR: içerik sorgusu tazelenince çuval
        // "sevkiyata atanmış" kilidine düşer ve üstteki şerit bunu yazar —
        // operatör ne olduğunu görür. Listeye zorla döndürmek, tek çuval sevki
        // yapıp aynı cariye devam etmek isteyen akışı bozardı.
        onCreated={() => setShipOpen(false)}
      />
    </PageShell>
  );
}
