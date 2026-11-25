import { useEffect, useId, useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TabbedDialogContent, TabbedDialogFooter, TabbedDialogHeader } from "@/components/ui/tabbed-dialog";
import { Button } from "@/components/ui/button";
import { ItemType, unitForItemType, type ProductItemType } from "@/types/enums";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { decimalToFormText } from "@/lib/decimal-form-text";
import { RecordInfoButton } from "@/components/RecordInfoButton";
import { InfoPopover } from "@/components/ui/info-popover";
import { useDevereEnabled, useDokumaEnabled, useKaliteGuvenceEnabled, useMaliyetEnabled } from "@/hooks/usePricingEnabled";
import type { Item, ItemCreatePayload } from "./types";
import { itemFormDefaults, makeItemFormSchema, type ItemFormValues } from "./schema";
import { fabricDetailToFormText, itemCarriesAllowedLists } from "./itemPayload.helper";
import { ItemCardTabs, INSTANT_SAVE_TABS, type ItemExtraTab } from "./ItemCardTabs";
import { useConstructionPickersVisible } from "./ItemConstructionPickers";
import { ItemCostLink } from "./ItemCostLink";
import { ItemGeneralFields } from "./ItemGeneralFields";
import { scopeItemType } from "./itemTypeScope";
import { AllowedListDialogs } from "./ItemFormParts";
import { useItemWeftDraft } from "./construction/useItemWeftDraft";
import { useItemFormSave } from "./construction/useItemFormSave";
import { CopyFromFabricButton } from "./construction/CopyFromFabricButton";
import { ItemWarpSection } from "./construction/ItemWarpSection";
import { ItemWeftSection } from "./construction/ItemWeftSection";
import { ItemWeaveSection } from "./construction/ItemWeaveSection";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Item | null;
  draft?: Item | null; // Örnek al taslağı (kimliksiz, kod boş) — YENİ kayıt
  onSubmit: (payload: ItemCreatePayload) => void | Promise<void>;
  isSubmitting?: boolean;
  allowedTypes?: readonly ItemType[]; // seçicinin tip kapsamı — yeni kayıtta Tip bununla sınırlanır
}

function toFormValues(initial: Item): ItemFormValues {
  return {
    code: initial.code,
    name: initial.name,
    // Hizmet kartı bu tabloda yaşamaz (`items_no_service_ck`); tip daraltması yalnız derleyici içindir.
    itemType: initial.itemType as ProductItemType,
    unit: initial.unit,
    linearDensityDen: decimalToFormText(initial.linearDensityDen),
    yarnWastePct: fabricDetailToFormText(initial.yarnWastePct),
    yarnPurchaseUnit: initial.yarnPurchaseUnit ?? "KG",
    yarnPiecesPerM: fabricDetailToFormText(initial.yarnPiecesPerM),
    widthCm: initial.widthCm == null ? "" : String(Number(initial.widthCm)).replace(".", ","),
    rawWidthCm: fabricDetailToFormText(initial.rawWidthCm),
    rawGsm: fabricDetailToFormText(initial.rawGsm),
    finishedGsm: fabricDetailToFormText(initial.finishedGsm),
    warpSpecId: initial.warpSpecId ?? "",
    weftSpecId: initial.weftSpecId ?? "",
    weaveDesignId: initial.weaveDesignId ?? "",
    allowedColorIds: initial.allowedColors?.map((c) => c.colorId) ?? [],
    allowedPropertyIds: initial.allowedProperties?.map((p) => p.propertyId) ?? [],
  };
}

/** Ürün penceresi: Genel · Çözgü · Atkı · Desen (B19 tek pencere; veri yapısı aynı, birleşme yalnız ekranda). */
export function ItemFormDialog({ open, onOpenChange, initial, draft, onSubmit, isSubmitting, allowedTypes }: Props) {
  const isEdit = Boolean(initial), formId = useId();
  const [colorsOpen, setColorsOpen] = useState(false), [propsOpen, setPropsOpen] = useState(false);
  const typeScope = isEdit ? undefined : allowedTypes;
  /** Stok kodunu elle yazma modu — varsayılan KAPALI, kutu hiç çizilmez. */
  const [manualCode, setManualCode] = useState(false);
  const [tab, setTab] = useState("info");
  const defaults = useMemo(() => (initial ? toFormValues(initial) : scopeItemType(draft ? { ...toFormValues(draft), code: "" } : itemFormDefaults, typeScope)), [initial, draft, typeScope]);
  const schema = useMemo(() => makeItemFormSchema(isEdit), [isEdit]);
  const form = useForm<ItemFormValues>({ resolver: zodResolver(schema) as Resolver<ItemFormValues>, defaultValues: defaults });

  useEffect(() => {
    if (open) {
      form.reset(defaults);
      setManualCode(false);
      setTab("info");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, draft]);

  const itemType = form.watch("itemType");
  const { hasPermission } = useRoleAccess();
  const devereEnabled = useDevereEnabled();
  const widthVisible = [useKaliteGuvenceEnabled(), useDokumaEnabled()].some(Boolean); // mamul en: Kalite Güvence ya da dokuma (iki kanca da koşar)
  const yarnWasteVisible = useMaliyetEnabled() && itemType === ItemType.YARN;
  const constructionVisible = useConstructionPickersVisible(itemType);
  const warpVisible = itemType === ItemType.FABRIC && devereEnabled;
  const canWriteSpecs = hasPermission("warpspec:write");
  const derivedUnit = unitForItemType[itemType] ?? "MT";
  const weft = useItemWeftDraft(open, initial?.weftSpecId ?? draft?.weftSpecId ?? null);

  useEffect(() => { form.setValue("unit", derivedUnit, { shouldDirty: true }); }, [derivedUnit, form]);

  // İzinli renk/özellik YALNIZ kumaşta: tür iplik/sarfa çevrilince (create) değerler boşalır;
  // düzenlemede tür kilitli, eski iplik kartında kalmış liste NOTLA gösterilir, kaydedince payload `[]` ile kaldırır.
  const carriesLists = itemCarriesAllowedLists(itemType);
  useEffect(() => {
    if (carriesLists) return;
    if (form.getValues("allowedColorIds").length) form.setValue("allowedColorIds", [], { shouldDirty: true });
    if (form.getValues("allowedPropertyIds").length) form.setValue("allowedPropertyIds", [], { shouldDirty: true });
  }, [carriesLists, form]);
  const staleLists = isEdit && !carriesLists && ((initial?.allowedColors?.length ?? 0) > 0 || (initial?.allowedProperties?.length ?? 0) > 0);

  const { handleSubmit, saving, shareQuestion } = useItemFormSave({
    open, form, initial, weft, onSubmit,
    visible: { construction: constructionVisible, yarnWaste: yarnWasteVisible, kaliteGuvence: widthVisible },
    onInvalidWeft: () => setTab("weft"),
  });

  const extraTabs: ItemExtraTab[] = [];
  if (warpVisible) extraTabs.push({ value: "warp", label: "Çözgü", content: <ItemWarpSection form={form} canWrite={canWriteSpecs} itemId={initial?.id ?? null} /> });
  if (constructionVisible) extraTabs.push({ value: "weft", label: "Atkı", content: <ItemWeftSection draft={weft} canWrite={canWriteSpecs} /> },
    { value: "weave", label: "Desen", content: <ItemWeaveSection form={form} canWrite={canWriteSpecs} /> });
  const busy = isSubmitting || saving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Sabit çerçeve (tabbed-dialog): kumaş kartında sekme değişince boyut zıplamaz; alt düğmeler yapışkan. */}
      <TabbedDialogContent className="w-[calc(100%-2rem)] max-w-6xl" data-form-size="wide">
        <TabbedDialogHeader>
          <div className="flex items-center gap-1.5">
            <DialogTitle>{isEdit ? "Ürünü Düzenle" : draft ? "Yeni Ürün (örnekten)" : "Yeni Ürün"}</DialogTitle>
            {/* ⓘ — kim oluşturdu / en son kim değiştirdi; kaynak kaydın KENDİ künye kolonları (audit arşivlenir). */}
            {isEdit && initial && <RecordInfoButton table="ITEM" id={initial.id} createdAt={initial.createdAt} updatedAt={initial.updatedAt} />}
            {/* B11: stok kodu başlıkta rozet; maliyet bağlantısı aynı satırın sağında. */}
            {isEdit && initial?.code && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                Kod: <span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-foreground">{initial.code}</span>
                <InfoPopover label="Stok kodu" desc="Stok kodu oluşturulduktan sonra değiştirilemez." />
              </span>
            )}
            {isEdit && initial && <span className="ml-auto"><ItemCostLink itemId={initial.id} itemType={initial.itemType} /></span>}
            {!isEdit && constructionVisible && <span className="ml-auto"><CopyFromFabricButton form={form} weft={weft} warpVisible={warpVisible} /></span>}
          </div>
          <DialogDescription>
            {extraTabs.length > 0 ? "Kumaşın genel bilgileri, çözgüsü, atkısı ve deseni tek pencerede. Birim, seçilen tipe göre otomatik atanır." : "Ürün tanımı (kumaş · iplik · sarf). Birim, seçilen tipe göre otomatik atanır."}
          </DialogDescription>
        </TabbedDialogHeader>

        {initial?.pendingReview && (
          <div className="mx-6 mb-3 flex shrink-0 items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Bu desen sahada (ham giriş) oluşturuldu ve onay bekliyor. Bilgileri gözden geçirip <strong>Güncelle</strong>'ye bastığınızda onaylanmış sayılır.
            </span>
          </div>
        )}

        {/* Alt çubuk sekmelerin DIŞINDA (B18/4): her sekmede görünür, Kaydet `form={formId}` ile Genel formunu gönderir. */}
        <ItemCardTabs
          item={initial}
          extraTabs={extraTabs}
          tab={tab}
          onTabChange={setTab}
          footer={(t) => (
            <TabbedDialogFooter>
              {INSTANT_SAVE_TABS.has(t) && (
                <span className="mr-auto hidden text-xs text-muted-foreground sm:block">
                  Bu sekmedeki eklemeler anında kaydedilir; {isEdit ? "Güncelle" : "Oluştur"}, öteki sekmeleri kaydeder.
                </span>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
              <Button type="submit" form={formId} disabled={busy}>
                {busy ? "Kaydediliyor..." : isEdit ? "Güncelle" : "Oluştur"}
              </Button>
            </TabbedDialogFooter>
          )}
        >
          <form id={formId} onSubmit={handleSubmit} className="space-y-4">
            <ItemGeneralFields
              form={form}
              open={open}
              initial={initial} allowedTypes={typeScope}
              derivedUnit={derivedUnit}
              widthVisible={widthVisible}
              yarnWasteVisible={yarnWasteVisible}
              carriesLists={carriesLists}
              staleLists={staleLists}
              hasSavedWeavingValues={Boolean(defaults.rawWidthCm || defaults.rawGsm || defaults.finishedGsm)}
              manualCode={manualCode}
              onManualCodeChange={(next) => {
                setManualCode(next);
                // Otomatiğe dönerken alanı TEMİZLE — yarım yazılmış kod görünmez halde payload'a gidip 409 üretirdi.
                if (!next) form.setValue("code", "", { shouldValidate: true });
              }}
              onOpenColors={() => setColorsOpen(true)}
              onOpenProps={() => setPropsOpen(true)}
            />
          </form>
        </ItemCardTabs>

        <AllowedListDialogs form={form} colorsOpen={colorsOpen} setColorsOpen={setColorsOpen} propsOpen={propsOpen} setPropsOpen={setPropsOpen} />
        {shareQuestion}
      </TabbedDialogContent>
    </Dialog>
  );
}
