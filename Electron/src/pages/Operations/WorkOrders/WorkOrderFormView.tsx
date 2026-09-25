import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookmarkPlus,
  ClipboardList,
  FlaskConical,
  Link2,
  Lock,
  Package,
  Workflow,
} from "lucide-react";
import { PageFooter } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FormField } from "@/components/forms/FormField";
import { FormSection } from "@/components/forms/FormSection";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { routeService } from "@/pages/Routes/service";
import type { ProductionRoute } from "@/pages/Routes/types";
import { workOrderService } from "./service";
import { LinkedOrderLinesField } from "./LinkedOrderLinesField";
import { WorkOrderLivePreview } from "./WorkOrderLivePreview";
import { CoveragePanel } from "./CoveragePanel";
import { OrderPickerDialog, type PickedOrderLine } from "./OrderPickerDialog";
import { productRecipeService } from "@/pages/ProductRecipes/service";
import type { ProductRecipe } from "@/pages/ProductRecipes/types";
import { useTargetQuantityEnabled } from "@/hooks/usePricingEnabled";
import { useNumberSourceState } from "@/lib/number-source";
import { RouteEditor } from "./RouteEditor";
import { TargetItemPicker } from "./TargetItemPicker";
import { useFoldValues } from "@/hooks/useFoldValues";
import { useDesignerSteps } from "./useDesignerSteps";
import type { FasonStepPlan } from "./FasonPlanningDialog";
import type { CustomRouteStep } from "./RouteDesignerDialog";
import { useLinkedLinesAutoFill } from "./useLinkedLinesAutoFill";
import {
  workOrderFormDefaults,
  workOrderFormSchema,
  type WorkOrderFormValues,
} from "./schema";
import {
  formValuesFromWorkOrder,
  pickedLinesFromWorkOrder,
  designerStepsFromWorkOrder,
  stepsToCustom,
  routeStepsToCreatePayload,
  type RouteStepTargetPlan,
} from "./workOrderPrefill";
import type { WorkOrder } from "./types";
import { LastBatchBadge } from "./LastBatchBadge";

/**
 * react-hook-form hata ağacından tüm mesajları toplar (toast özeti için). Her
 * alan hatasının `message`'ında durur — `ref` (DOM düğümü) gibi alanlara inmez.
 * Tekrarlanan mesajlar tekilleştirilir.
 */
function collectErrorMessages(errors: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (typeof n.message === "string" && n.message) {
      out.push(n.message);
      return;
    }
    for (const [key, val] of Object.entries(n)) {
      if (key === "ref") continue;
      walk(val);
    }
  };
  walk(errors);
  return [...new Set(out)];
}

interface Props {
  workOrder?: WorkOrder | null;
  /** Create modunda formu önceden seçili sipariş kalemleriyle açar ("siparişten WO"). */
  initialPickedLines?: PickedOrderLine[];
  /** Create modunda sipariş bağı olmadan hedef spec + miktar seed'i (Denge "stoğa üret"). */
  initialTarget?: {
    itemId: string;
    colorId: string | null;
    width: number | null;
    targetQuantity: number | null;
  };
  onSubmit: (
    values: WorkOrderFormValues,
    meta: { fasonPlans: FasonStepPlan[]; customSteps: CustomRouteStep[] },
  ) => Promise<void>;
  isSubmitting?: boolean;
  /** İptal / vazgeç — sayfayı kapatıp listeye (veya detaya) döner. */
  onCancel: () => void;
  /** Sayfa başlığı satırındaki sağ slot — "Şablon seç" butonu buraya portal'lanır (yalnız yeni kayıt). */
  headerSlot?: HTMLElement | null;
}

/**
 * İş emri formunun salt-görsel gövdesi (Dialog kabuğu yok). Tam sayfa
 * Oluştur/Düzenle ekranında (`WorkOrderFormPage`) içeriği doldurur: sol sipariş
 * paneli, orta form, sağ canlı önizleme + altta yapışkan aksiyon çubuğu. Reset,
 * `open` yerine mount + `workOrder.id` değişimine bağlıdır (her gezinme taze
 * sayfa mount eder).
 */
export function WorkOrderFormView({
  workOrder,
  initialPickedLines,
  initialTarget,
  onSubmit,
  isSubmitting,
  onCancel,
  headerSlot,
}: Props) {
  const isEdit = Boolean(workOrder);
  const targetQuantityEnabled = useTargetQuantityEnabled();
  // ⚠️ TEK KAYNAK: eski `partyCodeAuto` bayrağı artık `numberSource`tan TÜRETİLİYOR
  // (D3③) ve boolean olduğu için ÜÇÜNCÜ hâli (SYSTEM = elle giriş YASAK)
  // söyleyemez. Bu yüzden form modun kendisini okur; iki ayar bir soruyu
  // cevaplarken biri mutlaka bayatlar.
  const partyCodeHal = useNumberSourceState("workOrder");
  // Otomatik mod + yeni kayıt: parti kodunu elle gir (override) seçeneği.
  const [overrideParty, setOverrideParty] = useState(false);
  const partyCodeGizli = !isEdit && partyCodeHal === "hidden";
  // Parti kodu alanı düzenlenebilir + zorunlu mu? Otomatik modda yeni kayıtta
  // override kapalıysa alan kilitli ve boş kalır → backend otomatik üretir.
  // Düzenlemede kilitli: iş emri numarası doğuşta donar (backend farklısını 409'lar).
  const partyCodeEditable = !isEdit && (partyCodeHal === "required" || overrideParty);

  const form = useForm<WorkOrderFormValues>({
    resolver: zodResolver(workOrderFormSchema) as Resolver<WorkOrderFormValues>,
    defaultValues: workOrderFormDefaults,
  });

  /**
   * Parti kodu alanından çıkıldığında (blur) backend'e "bu kod daha önce
   * verilmiş mi" diye sorar; alınmışsa alanın altında anında uyarı gösterir.
   * Boş kod kontrol edilmez (otomatik üretilecek). Ağ hatasında sessiz geçer —
   * kaydetme anında backend zaten benzersizliği zorlar.
   */
  const checkBatchAvailability = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    try {
      const res = await workOrderService.checkBatchNumber(code, workOrder?.id);
      const available = res.data?.available ?? true;
      if (!available) {
        form.setError("batchNumber", {
          type: "manual",
          message: "Bu parti kodu zaten kullanılıyor — kaydetmeden değiştirin.",
        });
      } else if (form.getFieldState("batchNumber").error?.type === "manual") {
        form.clearErrors("batchNumber");
      }
    } catch {
      /* ağ hatası: sessiz — submit'te backend doğrular */
    }
  };

  const {
    pickedLines,
    setPickedLines,
    derived,
    handleLinesChange,
    handlePickerConfirm,
  } = useLinkedLinesAutoFill(form);
  // Create akışı: sipariş bağlama artık başlıktaki "Sipariş Bağla" butonundan
  // açılan picker'la yapılır (eski "Sipariş Bağlantısı" bölümü kaldırıldı).
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  const {
    steps: routeSteps,
    reset: resetRouteSteps,
    addStep,
    removeStep,
    moveStep,
    reorder: reorderSteps,
    updateStep,
    seedFromRoute,
    handleStationPick,
  } = useDesignerSteps([]);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  // "Rotayı Kaydet" tetiği başlıkta ("Rota Seç"in yanında); modal RouteEditor'da kalır.
  const [routeSaveOpen, setRouteSaveOpen] = useState(false);
  const [saveRecipeOpen, setSaveRecipeOpen] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [seedRouteId, setSeedRouteId] = useState<string | null>(null);
  const qc = useQueryClient();

  // Rota Tambur içeriyor mu — "Kat Tipi" seçeneği yalnız Tambur'lu rotalarda görünür
  // ve zorunlu olur (kat tipi Tambur operatörüne yönelik bir üretim spec'idir).
  const hasTambur = routeSteps.some((s) => s.stationKind === "TAMBUR");

  // Kat seçenekleri KATALOGDAN (2026-08-10) — eskiden ["2-KAT","4-KAT"] literaldi
  // ve fabrika 6-KAT ekleyemiyordu. Sorgu yalnız Tambur'lu rotada anlamlı ama
  // koşulsuz koşar: hook'u koşullu çağırmak React kuralını bozar, maliyet ise
  // 60 sn cache'li tek küçük istek.
  const { values: foldValues, isEmpty: foldNotConfigured } = useFoldValues();

  // Ön-seçim: yeni iş emrinde katalogun İLK değeri seçili gelsin (eski davranış
  // "2-KAT sabit ön-seçili" idi). Katalogdan okunduğu için 2-KAT'ı olmayan bir
  // fabrikada da geçerli bir değer seçilir. Kullanıcı bir kez dokunduysa
  // (`value` dolu) ya da düzenleme modundaysak KARIŞMAZ.
  useEffect(() => {
    const first = foldValues[0];
    if (isEdit || !hasTambur || !first) return;
    if (form.getValues("foldType")) return;
    form.setValue("foldType", first.code);
  }, [isEdit, hasTambur, foldValues, form]);

  // Mount + workOrder kimliği değişince formu tohumla. (Tam sayfa: her gezinme
  // taze mount → modal `open` bayrağına ihtiyaç yok.)
  useEffect(() => {
    if (workOrder) {
      const values = formValuesFromWorkOrder(workOrder);
      form.reset(values);
      setPickedLines(pickedLinesFromWorkOrder(workOrder));
      resetRouteSteps(designerStepsFromWorkOrder(workOrder));
    } else {
      form.reset(workOrderFormDefaults);
      if (initialPickedLines && initialPickedLines.length > 0) {
        // "Bu siparişten iş emri oluştur" — kalemleri + hedefleri seed et.
        handleLinesChange(initialPickedLines);
        handlePickerConfirm(initialPickedLines);
      } else {
        setPickedLines([]);
        if (initialTarget) {
          // Denge "stoğa üret": sipariş bağı yok, sadece hedef spec + miktar.
          // (Lines boş → buildPayload type'ı STOCK_PRODUCTION yapar.)
          form.setValue("targetItemId", initialTarget.itemId);
          form.setValue("targetColorId", initialTarget.colorId);
          form.setValue("width", initialTarget.width);
          if (initialTarget.targetQuantity != null) {
            form.setValue("targetQuantity", initialTarget.targetQuantity);
          }
        }
      }
      resetRouteSteps([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrder?.id]);

  // Rota şablonu olarak kaydet (inline — ayrı dialog yok).
  const saveTemplateMut = useMutation({
    mutationFn: (params: {
      name: string;
      forCustomer: boolean;
      stepTargets: Map<string, RouteStepTargetPlan>;
    }) => {
      const payload = {
        name: params.name,
        // Kod backend'de üretilir (ROT+GGAAYY+NNNN) — istemci göndermez.
        customerId: params.forCustomer ? pickedLines[0]?.customerId ?? null : null,
        isActive: true,
        isFavorite: false,
        // Fason planlamasını (kategori + firma) KORUR — bkz. routeStepsToCreatePayload.
        // Şablon hedefi (renk/özellik) RouteEditor'da türetilir (deriveStepTargets).
        steps: routeStepsToCreatePayload(routeSteps, params.stepTargets),
      };
      return routeService.create(payload as unknown as Partial<ProductionRoute>);
    },
    onSuccess: (_res, vars) => {
      toast.success(`Şablon kaydedildi: ${vars.name}`);
      void qc.invalidateQueries({ queryKey: ["routes"] });
    },
  });

  // Bu iş emrini şablon olarak kaydet: önce akıştan rota şablonu, sonra iş emri şablonu.
  const saveRecipeMut = useMutation({
    mutationFn: async (name: string) => {
      const v = form.getValues();
      const routeRes = await routeService.create({
        name: `${name} rotası`,
        // Kod backend'de üretilir (ROT+GGAAYY+NNNN) — istemci göndermez.
        isActive: true,
        isFavorite: false,
        // Fason planlamasını (kategori + firma) KORUR — bkz. routeStepsToCreatePayload.
        steps: routeStepsToCreatePayload(routeSteps),
      } as unknown as Partial<ProductionRoute>);
      const routeId = (routeRes.data as { id: string }).id;
      return productRecipeService.create({
        // Kod backend'de üretilir (REC+GGAAYY+NNNN) — istemci göndermez.
        name,
        itemId: v.targetItemId,
        colorId: v.targetColorId ?? null,
        width: typeof v.width === "number" ? v.width : null,
        foldType: hasTambur && v.foldType?.trim() ? v.foldType.trim() : null,
        routeId,
        properties: (v.targetPropertyIds ?? []).map((id) => ({ propertyId: id })),
      } as unknown as Partial<ProductRecipe>);
    },
    onSuccess: (_res, name) => {
      toast.success(`İş emri şablonu kaydedildi: ${name}`);
      void qc.invalidateQueries({ queryKey: ["routes"] });
      void qc.invalidateQueries({ queryKey: ["product-recipes"] });
      setSaveRecipeOpen(false);
      setRecipeName("");
    },
  });

  /**
   * Rota şablonunun HEDEFİNİ (renk + özellik) forma uygular. Sipariş bağlıysa
   * DOKUNMAZ: orada hedef sipariş kaleminden gelir (ve kilitli olabilir) —
   * şablon bir öneridir, siparişin dediğini ezemez.
   */
  const applyRouteTarget = (
    seeded: { colorId: string | null; propertyIds: string[] } | null,
  ) => {
    if (!seeded || pickedLines.length > 0) return;
    if (seeded.colorId) form.setValue("targetColorId", seeded.colorId);
    if (seeded.propertyIds.length > 0) {
      form.setValue("targetPropertyIds", seeded.propertyIds);
    }
  };

  // Şablondan tohumla (boş seçilirse akışı temizle).
  const handleSeedRoute = (routeId: string | null) => {
    if (routeId) void seedFromRoute(routeId).then(applyRouteTarget);
    else resetRouteSteps([]);
  };

  // Akış değişince rota validasyon hatasını temizle.
  useEffect(() => {
    setRouteError(null);
  }, [routeSteps]);

  // İş emri şablonundan doldur — seçilen şablonun hedef alanları + rotasını forma yazar.
  const applyRecipe = async (id: string | null) => {
    setRecipeId(id);
    if (!id) return;
    const res = await productRecipeService.getById(id);
    const r = res.data;
    if (!r) return;
    // Sipariş bağlıysa kumaş/renk/en/özellik siparişten gelir (kilitli) — şablondan
    // yalnız ROTA + kat tipi al. Stoğa üretimde hepsini doldur.
    const orderBound = pickedLines.length > 0;
    if (!orderBound) {
      form.setValue("targetItemId", r.itemId);
      form.setValue("targetColorId", r.colorId);
      form.setValue(
        "targetPropertyIds",
        (r.properties ?? []).map((p) => p.propertyId),
      );
      if (r.width != null) form.setValue("width", r.width);
    }
    if (r.routeId) void seedFromRoute(r.routeId);
    if (r.foldType) form.setValue("foldType", r.foldType);
  };

  // Tip artık seçilmez — sipariş kalemi bağlıysa siparişe özel, değilse stoğa
  // üretim. buildPayload submit'te type'ı bu kurala göre türetir.
  const isOrderProduction = pickedLines.length > 0;

  const orderWidth = derived?.width ?? null;
  const mixedWidths = derived !== null && derived.width == null;

  // Backend findById response'unda gelir; material commitment durumuna göre
  // hangi alanların değiştirilemediğini söyler.
  const locks = workOrder?.locks;
  // Sipariş eni artık SADECE öneri — KİLİTLİ DEĞİL. Kullanıcı bilinçli olarak
  // farklı en girebilir: boyahaneden (fason) dönen kumaşa WO eni damgalanır
  // (subcontractor.service receive → bornWidth, tambur.service finalize), ham
  // top en'siz girdiği için fason dönüşünün eni buradan belirlenir. Yalnız
  // backend hard lock'u (malzeme bağlandı / sevk yapıldı) alanı kilitler.
  const widthFullyLocked = Boolean(locks?.width);
  const widthTooltip = locks?.reasons.width ?? "";
  // Sipariş eninden farklı en girildi mi? (boyahane override uyarısı için)
  const watchedWidth = form.watch("width");
  const widthOverridden =
    orderWidth != null &&
    watchedWidth != null &&
    String(watchedWidth) !== "" &&
    Number(watchedWidth) !== Number(orderWidth);
  // targetQuantity ASLA kilitli değil — sipariş bağlıyken bile yalnız öneri
  // (bağlı kalemlerin açık toplamı) gelir; kullanıcı değiştirebilir (fazla →
  // Tambur stoğu, eksik → kalan için yeni iş emri).
  const quantityFullyLocked = false;
  const quantityTooltip = "Bağlı kalemlerden önerilir; değiştirebilirsin";

  // "Sevk edilen > yeni hedef" uyarısı için canlı izleme.
  const watchedQuantity = form.watch("targetQuantity");
  const dispatchedQty = workOrder?.dispatchedTotalQty ?? 0;
  const quantityShortfall =
    locks?.materialCommitted &&
    dispatchedQty > 0 &&
    watchedQuantity != null &&
    Number(watchedQuantity) > 0 &&
    Number(watchedQuantity) < dispatchedQty
      ? dispatchedQty - Number(watchedQuantity)
      : 0;

  // Stoğa üretimde hedef kumaş zorunlu + boşsa → picker'a nabız (dikkat çek).
  const targetItemMissing = !isOrderProduction && !form.watch("targetItemId");

  // "Şablon Kaydet" şablonun ihtiyaç duyduğu alanlar tamam olmadan pasiftir.
  // Hangi eksik yüzünden pasif kaldığını tooltip'te somut göster (disabled
  // buton native title göstermez → Radix Tooltip + span sarmalı kullanılır).
  const templateBlockReason = !form.watch("targetItemId")
    ? "Önce hedef kumaş belirlenmeli."
    : routeSteps.length === 0
      ? "Rotaya en az bir istasyon ekle."
      : routeSteps.some((s) => !s.stationId)
        ? "Her rota adımına istasyon seç."
        : null;

  return (
    <TooltipProvider delayDuration={150}>
      <form
        onSubmit={form.handleSubmit(
          async (v) => {
            // Zod geçti; zod kapsamayan manuel kurallar. Hepsini topla → tek toast
            // + satır içi işaretler (mevcut gösterim korunur). Toast özellikle uzun
            // formda gerekli: hata alttaki inputta kalınca operatör görmüyordu.
            const manualErrors: string[] = [];
            if (routeSteps.length === 0 || routeSteps.some((s) => !s.stationId)) {
              setRouteError("En az bir adım ekle ve her adıma istasyon seç.");
              manualErrors.push("Üretim akışı: en az bir adım ve her adıma istasyon seçilmeli.");
            }
            // Manuel mod / override / düzenlemede parti kodu zorunlu. Otomatik modda
            // (override kapalı) boş bırakılır → backend otomatik üretir.
            if (partyCodeEditable && !partyCodeGizli && !(v.batchNumber ?? "").trim()) {
              form.setError("batchNumber", { type: "manual", message: "Parti kodu zorunlu" });
              manualErrors.push("Parti kodu zorunlu.");
            }
            // Sipariş bağlı değil = stoğa üretim; backend hedef kumaş zorunlu kılar.
            if (pickedLines.length === 0 && !v.targetItemId) {
              form.setError("targetItemId", {
                type: "manual",
                message: "Sipariş bağlı değil — stoğa üretim için hedef kumaş seçilmeli.",
              });
              manualErrors.push("Stoğa üretim için hedef kumaş seçilmeli.");
            }
            // Kat tipi yeni iş emrinde zorunlu — boş bırakılamaz (varsayılan 2-KAT,
            // ama recipe/temizleme ile boşalmışsa burada yakalanır).
            if (!isEdit && hasTambur && !(v.foldType ?? "").trim()) {
              form.setError("foldType", {
                type: "manual",
                message: "Kat tipi seçilmeli (2-KAT veya 4-KAT).",
              });
              manualErrors.push("Kat tipi seçilmeli.");
            }
            if (manualErrors.length > 0) {
              toast.error("İş emri oluşturulamadı — eksik/hatalı alanlar var", {
                description: manualErrors.join(" · "),
                position: "top-center",
              });
              return;
            }
            await onSubmit(
              // Tambur yoksa kat tipi anlamsız — payload'a sızmasın.
              { ...v, foldType: hasTambur ? v.foldType : "" },
              { fasonPlans: [], customSteps: stepsToCustom(routeSteps) },
            );
          },
          (errors) => {
            // Zod doğrulama hataları: satır içi gösterim duruyor, üstüne özet toast.
            const messages = collectErrorMessages(errors);
            toast.error("İş emri oluşturulamadı — eksik/hatalı alanlar var", {
              description: messages.length
                ? messages.join(" · ")
                : "İşaretli alanları kontrol edin.",
              position: "top-center",
            });
          },
        )}
        className="flex min-h-0 flex-1 flex-col"
      >
        {locks?.materialCommitted && (
          <Callout
            tone="warning"
            className="mx-6 mt-3 shrink-0"
            title={locks.reasons.materialCommitted ?? "Fiziksel taahhüt var"}
          >
            Kumaş / en / hedef metraj sabit. Renk, üretim özellikleri ve kat tipi
            yalnızca ilgili istasyon adımı tamamlanmadıysa değiştirilebilir.
          </Callout>
        )}

        {/* Şablon seç — sayfa başlık satırının en sağına portal'lanır (yalnız yeni
            kayıt). Kompakt buton "İş Emri Şablonu Seç" modalını açar; seçilince hedef
            alanları + rota tek tıkla dolar (applyRecipe). */}
        {!isEdit &&
          headerSlot &&
          createPortal(
            <div className="flex flex-col items-stretch gap-1.5">
              <EntityPickerModal<ProductRecipe>
                value={recipeId}
                onChange={(id) => void applyRecipe(id)}
                service={productRecipeService}
                queryKey="product-recipes"
                getLabel={(r) => r.name}
                getSubLabel={(r) => r.code}
                nullable
                noneLabel="— Şablon kullanma"
                icon={FlaskConical}
                iconClassName="text-white"
                title="İş Emri Şablonu Seç"
                description="Hazır şablon — kumaş, renk, özellik, en ve rota tek tıkla dolar."
                placeholder="Şablon seç..."
                placeholderClassName="text-sm font-medium text-white/90"
                hideChevron
                triggerClassName="h-9 w-auto min-w-[190px] shrink-0 items-center gap-2 border-0 bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm shadow-violet-600/30 transition-colors hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-500"
                countLabel="şablon"
              />
              {/* Şablon Seç'in ALTINDA — sipariş bağlama artık tek buton. */}
              <Button
                type="button"
                onClick={() => setOrderPickerOpen(true)}
                className="h-9 min-w-[190px] shrink-0 justify-start gap-2 border-0 bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <Link2 className="h-4 w-4" />
                {pickedLines.length > 0
                  ? `Sipariş: ${pickedLines.length} kalem`
                  : "Sipariş Bağla"}
              </Button>
            </div>,
            headerSlot,
          )}

        {/* Sipariş picker — create'te "Sipariş Bağla" butonuyla açılır. */}
        {!isEdit && (
          <OrderPickerDialog
            open={orderPickerOpen}
            onOpenChange={setOrderPickerOpen}
            initialSelected={pickedLines}
            onConfirm={(next) => {
              handleLinesChange(next);
              handlePickerConfirm(next);
            }}
            excludeWorkOrderId={workOrder?.id}
          />
        )}

        <div className="flex min-h-0 flex-1">
          {/* Sol panel — yalnız EDIT modunda + sipariş bağlıyken. Create'te sipariş
              başlıktaki "Sipariş Bağla" butonundan bağlanır (panel yer kaplamaz). */}
          {isEdit && isOrderProduction && (
            <aside className="hidden w-[340px] shrink-0 flex-col border-r bg-muted/10 lg:flex">
              <LinkedOrderLinesField
                lines={pickedLines}
                onChange={handleLinesChange}
                onPickerConfirm={handlePickerConfirm}
                excludeWorkOrderId={workOrder?.id}
                requiredItemId={
                  locks?.materialCommitted ? workOrder?.targetItemId : null
                }
                requiredWidth={locks?.materialCommitted ? workOrder?.width : null}
              />
            </aside>
          )}

          {/* Orta panel — form içeriği */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/20 px-6 py-4">
            {/* Sipariş bağlantısı — YALNIZ edit modunda bölüm. Create'te başlıktaki
                "Sipariş Bağla" butonu + picker'dan bağlanır (bölüm kaldırıldı). */}
            {isEdit && (
            <FormSection
              step={1}
              title="Sipariş Bağlantısı"
              icon={Link2}
              tone="blue"
              optional={!isOrderProduction}
            >
              {isOrderProduction ? (
                <>
                  {/* lg altında inline kalemler; lg+ sol panelde gösterilir */}
                  <div className="rounded-md border bg-muted/10 lg:hidden">
                    <LinkedOrderLinesField
                      lines={pickedLines}
                      onChange={handleLinesChange}
                      onPickerConfirm={handlePickerConfirm}
                      excludeWorkOrderId={workOrder?.id}
                    />
                  </div>
                  {/* Üretim kapsama — "ne kadar üretmeliyim" (sevk/WO/stok kovaları) */}
                  <CoveragePanel
                    lineIds={pickedLines.map((l) => l.lineId)}
                    excludeWorkOrderId={workOrder?.id}
                  />
                </>
              ) : (
                <LinkedOrderLinesField
                  compact
                  lines={pickedLines}
                  onChange={handleLinesChange}
                  onPickerConfirm={handlePickerConfirm}
                  excludeWorkOrderId={workOrder?.id}
                />
              )}
            </FormSection>
            )}

            {/* 2 — Ne üretilecek? Hedef kumaş + ölçüler. */}
            <FormSection
              step={isEdit ? 2 : 1}
              title="Hedef Kumaş & Ölçüler"
              icon={Package}
              tone="indigo"
              required={!isOrderProduction}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  label="Hedef Kumaş"
                  required={!isOrderProduction}
                  error={form.formState.errors.targetItemId}
                >
                  <div className={targetItemMissing ? "attention-pulse rounded-md" : undefined}>
                    <TargetItemPicker
                      control={form.control}
                      onItemChange={() => {
                        form.setValue("targetColorId", null);
                        form.setValue("targetPropertyIds", []);
                      }}
                      disabled={Boolean(locks?.targetItem) || isOrderProduction}
                      lockedTooltip={
                        locks?.reasons.targetItem ??
                        "Sipariş kaleminden alındı — değiştirilemez"
                      }
                    />
                  </div>
                </FormField>
                <FormField
                  label="En (cm)"
                  htmlFor="width"
                  error={form.formState.errors.width}
                  hintTone="warning"
                  hint={
                    mixedWidths ? "Kalemlerin enleri farklı — manuel gir." : undefined
                  }
                >
                  <LockedInput
                    id="width"
                    type="number"
                    step="0.1"
                    min={0}
                    placeholder="150"
                    locked={widthFullyLocked}
                    lockedTooltip={widthTooltip}
                    {...form.register("width")}
                  />
                  {/* Boyahane (fason) uyarısı: sipariş eni öneri olarak geldi,
                      override edilebilir. Bu en boyahaneden dönen kumaşa
                      damgalanır (ham top en'siz girer). Farklı en girilirse
                      sonuç uyarısı gösterilir. */}
                  {orderWidth != null && !widthFullyLocked && widthOverridden && (
                    <Callout tone="warning" className="mt-1.5">
                      Bu en, boyahaneden (fason) dönen kumaşa damgalanır. Sipariş
                      eni <strong>{orderWidth} cm</strong> — sen farklı en girdin,
                      üretim ve sevk bu en ile işlenir.
                    </Callout>
                  )}
                </FormField>
                {targetQuantityEnabled && (
                  <FormField
                    label="Hedef Metraj"
                    htmlFor="targetQuantity"
                    error={form.formState.errors.targetQuantity}
                    hintTone="info"
                    hint={
                      locks?.materialCommitted && dispatchedQty > 0
                        ? `Sevk edilen: ${dispatchedQty.toLocaleString("tr-TR", { useGrouping: false })} m`
                        : isOrderProduction
                          ? "Bağlı kalemlerin açığından önerilir — değiştirebilirsin (fazlası stoğa)."
                          : undefined
                    }
                  >
                    <LockedInput
                      id="targetQuantity"
                      type="number"
                      step="0.1"
                      min={0}
                      placeholder="1000"
                      locked={quantityFullyLocked}
                      lockedTooltip={quantityTooltip}
                      {...form.register("targetQuantity")}
                    />
                    {quantityShortfall > 0 && (
                      <Callout tone="warning" className="mt-1.5">
                        Yeni hedef, sevk edilenden{" "}
                        <strong>{quantityShortfall.toLocaleString("tr-TR", { useGrouping: false })} m</strong>{" "}
                        düşük.
                      </Callout>
                    )}
                  </FormField>
                )}
                {targetQuantityEnabled && (
                  <FormField
                    label="Hedef Kg"
                    htmlFor="targetWeight"
                    error={form.formState.errors.targetWeight}
                    hint="Opsiyonel — tekstilde mt + kg planlanır."
                  >
                    <LockedInput
                      id="targetWeight"
                      type="number"
                      step="0.1"
                      min={0}
                      placeholder="—"
                      locked={false}
                      {...form.register("targetWeight")}
                    />
                  </FormField>
                )}
              </div>
            </FormSection>

            {/* 3 — Üretim rotası. En az bir istasyon zorunlu; renk/özellik burada. */}
            <FormSection
              step={isEdit ? 3 : 2}
              title="Üretim Rotası"
              icon={Workflow}
              tone="emerald"
              required
              aside={
                <div className="flex shrink-0 items-center gap-1.5">
                  <EntityPickerModal<ProductionRoute>
                    value={seedRouteId}
                    onChange={(id) => {
                      setSeedRouteId(id);
                      handleSeedRoute(id);
                    }}
                    service={routeService}
                    queryKey="routes"
                    getLabel={(r) => r.name}
                    getSubLabel={(r) => r.code}
                    nullable
                    noneLabel="— Boş başla"
                    icon={Workflow}
                    iconClassName="text-orange-600 dark:text-orange-400"
                    title="Rota Şablonu Seç"
                    description="Hazır rota — adımlar forma yüklenir. Yüzlerce şablonda ara."
                    placeholder="Kayıtlı rota seç..."
                    triggerClassName="h-8 w-auto min-w-[150px] shrink-0 gap-1.5 border-orange-300 bg-orange-50 px-3 text-xs font-medium text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300 dark:hover:bg-orange-900/40"
                    countLabel="rota"
                  />
                  {/* Bu rotayı kaydet — "Rota Seç"in sağında: akış seç→düzenle→kaydet
                      soldan sağa okunur; sağ uç zaten bu aksiyonun eski (flow satırı
                      sonu) yeriydi. Modal RouteEditor'da kalır (hideSaveTrigger). */}
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 gap-1.5 border-transparent bg-emerald-600 text-xs text-white shadow-sm shadow-emerald-600/30 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                    disabled={routeSteps.length === 0}
                    onClick={() => setRouteSaveOpen(true)}
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" /> Rotayı Kaydet
                  </Button>
                </div>
              }
            >
              <RouteEditor
                hideSeedPicker
                hideSaveTrigger
                saveModalOpen={routeSaveOpen}
                onSaveModalOpenChange={setRouteSaveOpen}
                steps={routeSteps}
                onAdd={addStep}
                onRemove={removeStep}
                onMove={moveStep}
                onReorder={reorderSteps}
                onPickStation={(clientId, id) => void handleStationPick(clientId, id)}
                onSetNotes={(clientId, notes) => updateStep(clientId, { notes })}
                onSetFirm={(clientId, patch) => updateStep(clientId, patch)}
                onSeed={handleSeedRoute}
                onSaveTemplate={(name, forCustomer, stepTargets) =>
                  saveTemplateMut.mutate({ name, forCustomer, stepTargets })
                }
                savePending={saveTemplateMut.isPending}
                customerId={pickedLines[0]?.customerId ?? null}
                target={{
                  colorId: form.watch("targetColorId") ?? null,
                  propertyIds: form.watch("targetPropertyIds") ?? [],
                  onColor: (id) => form.setValue("targetColorId", id),
                  onProperties: (ids) => form.setValue("targetPropertyIds", ids),
                  colorLocked: Boolean(locks?.targetColor),
                  lockedPropertyIds: locks?.lockedPropertyIds,
                  customerId: pickedLines[0]?.customerId ?? null,
                }}
                error={routeError ?? undefined}
              />

              {/* Kat Tipi — yalnız rotada Tambur varsa görünür (Tambur operatörüne
                  yönelik üretim spec'i). Zorunlu: yeni iş emrinde bir tanesi seçili
                  olmalı; aktif düğmeye tekrar basınca seçim kaldırılmaz. */}
              {hasTambur && (
                <FormField
                  label="Kat Tipi"
                  required={!isEdit}
                  error={form.formState.errors.foldType}
                  hint={locks?.foldType ? locks.reasons.foldType : undefined}
                >
                  <Controller
                    control={form.control}
                    name="foldType"
                    render={({ field }) => (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-2 sm:max-w-md">
                          {foldValues.map((opt) => {
                            const active = field.value === opt.code;
                            return (
                              <Button
                                key={opt.code}
                                type="button"
                                variant={active ? "default" : "outline"}
                                disabled={Boolean(locks?.foldType)}
                                title={
                                  locks?.foldType ? locks.reasons.foldType : undefined
                                }
                                onClick={() => field.onChange(opt.code)}
                              >
                                {opt.name}
                              </Button>
                            );
                          })}
                        </div>
                        {/* Katalog boşsa SESSİZ KALMA: tuş yokluğu "kat gerekmiyor"
                            gibi okunur, oysa alan zorunlu ve kaydet düşer. */}
                        {foldNotConfigured && (
                          <p className="text-xs text-warning">
                            Kat değeri tanımlı değil — Tanımlar → Kumaş Özellikleri →
                            "KAT" özelliğine değer ekleyin.
                          </p>
                        )}
                        {/* Kayıtlı ama katalogdan kaldırılmış değer: tuşu yok, ama
                            kaydın taşıdığı değer görünmeli (aksi halde form boş
                            görünür ve kullanıcı farkında olmadan üzerine yazar). */}
                        {field.value &&
                          !foldValues.some((v) => v.code === field.value) && (
                            <p className="text-xs text-muted-foreground">
                              Kayıtlı değer:{" "}
                              <span className="font-mono">{field.value}</span> (katalogda
                              aktif değil)
                            </p>
                          )}
                      </div>
                    )}
                  />
                </FormField>
              )}
            </FormSection>

            {/* 4 — Takip + planlama. Parti kodu izler; gelişmiş alanlar opsiyonel. */}
            <FormSection
              step={isEdit ? 4 : 3}
              title="Takip & Planlama"
              icon={ClipboardList}
              tone="slate"
            >
              {/* Parti Kodu — takip için. Otomatik modda KİLİTLİ görünür; tıklanınca
                  manuel girişe açılır. Boş bırakılıp alandan çıkılırsa (blur) otomatik
                  moda geri döner. Manuel modda açık + zorunlu; düzenlemede salt-okunur. */}
              {/* Rozet input'un ÜSTÜNDE (2026-08-17 talebi): altta kalınca
                  operatör yazmaya başladıktan sonra görüyordu. */}
              {!isEdit && !partyCodeGizli && <LastBatchBadge className="mb-1" />}
              {/* ⚠️ SYSTEM modunda alan HİÇ ÇİZİLMEZ: çizilseydi kullanıcı
                  doldurur, sunucu 400 verir ve hatayı kaydet'ten sonra görürdü. */}
              {!partyCodeGizli && (
              <FormField
                label="Parti Kodu"
                htmlFor="batchNumber"
                required={partyCodeEditable}
                error={form.formState.errors.batchNumber}
                hintTone="muted"
                hint={
                  partyCodeEditable
                    ? "Refakat kartına barkod olarak basılır: benzersiz, iş emri no biçiminde (Sistem → Numaralandırma), yalnız büyük harf ve rakam."
                    : isEdit
                      ? "İş emri numarası açılışta verilir, sonradan değiştirilemez."
                      : undefined
                }
              >
                <div className="relative">
                  <Input
                    id="batchNumber"
                    readOnly={!partyCodeEditable}
                    placeholder={
                      partyCodeEditable
                        ? "İş emri no biçiminde (Sistem → Numaralandırma)"
                        : "Otomatik oluşturulur — kendiniz girmek için tıklayın."
                    }
                    className={cn(!partyCodeEditable && "cursor-pointer bg-muted/40 pr-9")}
                    onFocus={() => {
                      if (partyCodeHal === "optional" && !isEdit && !overrideParty) setOverrideParty(true);
                    }}
                    {...form.register("batchNumber", {
                      onBlur: (e) => {
                        const val = e.target.value.trim();
                        if (partyCodeHal === "optional" && !isEdit && !val) {
                          setOverrideParty(false);
                          form.clearErrors("batchNumber");
                          return;
                        }
                        void checkBatchAvailability(val);
                      },
                    })}
                  />
                  {!partyCodeEditable && (
                    <Lock className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  )}
                </div>
              </FormField>
              )}

              {/* Planlama tarihleri — kendi başlarına, her zaman açık (accordion yok). */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Planlı Başlangıç">
                  <Controller
                    control={form.control}
                    name="plannedStartDate"
                    render={({ field }) => (
                      <DatePickerInput
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        placeholder="Boş bırakılırsa bugün"
                      />
                    )}
                  />
                </FormField>
                <FormField label="Planlı Bitiş">
                  <Controller
                    control={form.control}
                    name="plannedEndDate"
                    render={({ field }) => (
                      <DatePickerInput
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        placeholder="Boş bırakılırsa varsayılan N gün"
                      />
                    )}
                  />
                </FormField>
              </div>
            </FormSection>
          </div>

          {/* Sağ panel — canlı iş emri önizlemesi (sol sipariş paneliyle simetrik) */}
          <aside className="hidden w-[340px] shrink-0 flex-col border-l bg-muted/10 xl:flex">
            <WorkOrderLivePreview
              control={form.control}
              routeSteps={routeSteps}
              pickedLines={pickedLines}
              isOrderProduction={isOrderProduction}
              isEdit={isEdit}
              showQuantity={targetQuantityEnabled}
            />
          </aside>
        </div>

        <PageFooter className="justify-between">
          <Tooltip>
            <TooltipTrigger asChild>
              {/* span: disabled buton hover'ı yutmasın diye tooltip tetikleyici */}
              <span className="inline-flex">
                <Popover open={saveRecipeOpen} onOpenChange={setSaveRecipeOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(templateBlockReason)}
                      className="gap-1"
                      title={templateBlockReason ?? "Bu iş emrini şablon olarak kaydet"}
                    >
                      <FlaskConical className="h-3.5 w-3.5" /> Şablon Kaydet
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 space-y-2">
              <div className="text-xs font-medium">Bu iş emrini şablon olarak kaydet</div>
              <p className="text-[11px] text-muted-foreground">
                Kumaş + renk + özellik + en + akış tek isimle saklanır; sonraki iş
                emirlerinde "İş emri şablonundan doldur" ile gelir.
              </p>
              <Input
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                placeholder="Şablon adı (örn: Patos Gri 038)"
                className="h-8 text-xs"
                autoFocus
              />
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={saveRecipeMut.isPending || !recipeName.trim()}
                onClick={() => saveRecipeMut.mutate(recipeName.trim())}
              >
                {saveRecipeMut.isPending ? "Kaydediliyor..." : "Kaydet"}
              </Button>
                  </PopoverContent>
                </Popover>
              </span>
            </TooltipTrigger>
            {templateBlockReason && (
              <TooltipContent side="top" className="max-w-[220px]">
                {templateBlockReason}
              </TooltipContent>
            )}
          </Tooltip>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              İptal
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-emerald-600 text-white shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:bg-emerald-500 hover:shadow-md hover:shadow-emerald-500/40 active:translate-y-0"
            >
              {isSubmitting
                ? isEdit
                  ? "Güncelleniyor..."
                  : "Oluşturuluyor..."
                : isEdit
                  ? "Güncelle"
                  : "İş Emri Oluştur"}
            </Button>
          </div>
        </PageFooter>
      </form>
    </TooltipProvider>
  );
}

interface LockedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  locked?: boolean;
  lockedTooltip?: string;
}

const LockedInput = ({
  locked,
  lockedTooltip,
  className,
  ...rest
}: LockedInputProps) => (
  <div className="relative">
    <Input
      {...rest}
      disabled={locked || rest.disabled}
      className={`${locked ? "pr-9" : ""} ${className ?? ""}`.trim()}
    />
    {locked && (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="pointer-events-auto absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        {lockedTooltip && <TooltipContent side="top">{lockedTooltip}</TooltipContent>}
      </Tooltip>
    )}
  </div>
);
