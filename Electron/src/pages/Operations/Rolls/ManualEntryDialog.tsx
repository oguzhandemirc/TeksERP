import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { entryWarnings } from "./entry-warnings";
import { AlertTriangle, Printer } from "lucide-react";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { PropertyPickerModal } from "@/components/forms/PropertyPickerModal";
import { itemService } from "@/pages/Items/service";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { customerService } from "@/pages/Customers/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import { useEmanetEnabled, useKk1WeightEntryEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import type { Item } from "@/pages/Items/types";
import type { Customer } from "@/pages/Customers/types";
import type { LabelCustomerContext } from "@/services/labelService";
import { rollService, type InitialEntryPayload } from "./service";

// Radix Select boş string value kabul etmez → "Belirsiz" için sentinel.
const QUALITY_NONE = "__none__";

/**
 * Backend mükerrer tuzağının 409'unu tanır → var olan topun barkodu (yoksa null).
 *
 * Tuzak `kk1.duplicateGuardEnabled` ile açılır (varsayılan KAPALI): 90 sn içinde
 * aynı elden birebir aynı ürün/metraj/en girilirse sunucu bunu "az önce basılan
 * tuşun tekrarı olabilir" diye işaretler. ENGELLEME DEĞİL ONAYLATMA — tekstilde
 * arka arkaya birebir aynı top gerçekten gelir, o yüzden çıkış yolu açık kalır.
 * `readSessionConflict` (lib/session-auth) ile aynı okuma deseni.
 */
function readDuplicateConflict(error: unknown): string | null {
  const resp = (
    error as {
      response?: { status?: number; data?: { details?: { code?: string; barcode?: string } } };
    }
  )?.response;
  if (!resp || resp.status !== 409) return null;
  const details = resp.data?.details;
  if (details?.code !== "POSSIBLE_DUPLICATE") return null;
  return details.barcode ?? "—";
}

const schema = z.object({
  itemId: z.string().uuid("Kumaş seçilmeli"),
  colorId: z.string().uuid().nullable(),
  initialQty: z.number().positive("Miktar pozitif olmalı"),
  weightKg: z.number().positive("Ağırlık pozitif olmalı").nullable(),
  width: z.number().positive("En pozitif olmalı").nullable(),
  // Kalite opsiyonel — kaliteye bakılmamış manuel girişte "Belirsiz" (boş) kalır.
  qualityGrade: z.string(),
  propertyIds: z.array(z.string().uuid()).default([]),
  // Yalnız "Ekle ve Etiket Bas" akışında etiketin müşterisi. Topun kendisine
  // BAĞLANMAZ (gevşek model: top→müşteri bağı yok); create payload'ına gitmez.
  customerId: z.string().uuid().nullable(),
  /** G3 emanet: sahip müşteri — yalnız modül açıkken sorulur; etiket müşterisi DEĞİL, topa bağlanır. */
  ownerCustomerId: z.string().uuid().nullable(),
});

type FormValues = z.infer<typeof schema>;

const defaults: FormValues = {
  itemId: "",
  colorId: null,
  initialQty: 0,
  weightKg: null,
  width: null,
  qualityGrade: "",
  propertyIds: [],
  customerId: null,
  ownerCustomerId: null,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Hangi sekmeden açıldı — hedef statüyü belirler. Backend `createInitialEntry`
   * `colorId != null → WAREHOUSE`, `null → STOCK` kuralıyla yönlendirir:
   * - "FINISHED_STOCK" (Bitmiş Depo): renk ZORUNLU → top WAREHOUSE (depo) doğar.
   * - "SEMI_FINISHED" (Yarı Mamul): renk ZORUNLU, `semiFinished` bayrağı sezgiyi
   *   bypass eder → top renkli olmasına rağmen STOCK'ta kalır.
   * - "RAW_STOCK" (default, Ham Stok): renk opsiyonel; renksiz → STOCK.
   */
  target?: "RAW_STOCK" | "SEMI_FINISHED" | "FINISHED_STOCK";
  /**
   * "Ekle ve Etiket Bas" ile çağrılır: yeni topun id'si + (varsa) etiket müşteri
   * bağlamı. Üst sayfa RollLabelDialog'u bu topla açar (önizleme + Bas).
   */
  onCreatedForPrint?: (rollId: string, printContext?: LabelCustomerContext) => void;
}

export function ManualEntryDialog({ open, onOpenChange, target = "RAW_STOCK", onCreatedForPrint }: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canPrint = hasPermission("label:print");
  const isWarehouse = target === "FINISHED_STOCK";
  const isSemiTarget = target === "SEMI_FINISHED";
  /**
   * Dışarıdan alınan YARI MAMUL (2026-08-17, madde 9): boyalı/işlenmiş gelir ama
   * bitmiş DEĞİLDİR — fabrikada kurşun + tambur görecek.
   *
   * Renk zorunlu (tanımı gereği renkli), ama top HAM STOĞA düşer. Backend'de
   * `semiFinished` bayrağı statü sezgisini (`renk varsa WAREHOUSE`) bypass eder;
   * bayrak gönderilmezse mal doğrudan Bitmiş Depo'ya düşer ve üretime hiç girmez.
   */
  // 2026-08-17: AYRI BİR MODAL DEĞİL, aynı modalda bir kutu. İki buton
  // koymuştuk ama ikisi de aynı ucu (`/rolls/initial-entry`) ve aynı formu
  // kullanıyordu — fark yalnız bir ön ayardı. Kutu yalnız Ham Stok sekmesinde
  // anlamlı (Bitmiş Depo girişi zaten bitmiş maldır).
  const [isSemiFinished, setIsSemiFinished] = useState(isSemiTarget);
  // Diyalog Yarı Mamul sekmesinden açıldıysa kutu ön-işaretli gelir. GÖRÜNÜR ve
  // kaldırılabilir kalır: operatör yanılıp ham mal giriyorsa vazgeçebilmeli.
  useEffect(() => {
    if (open) setIsSemiFinished(isSemiTarget);
  }, [open, isSemiTarget]);
  const colorRequired = isWarehouse || isSemiFinished;
  // KK1 ağırlık girişi admin ayarıyla kapatılabilir (default kapalı). Kapalıyken
  // alan gizlenir ve payload'a weightKg konmaz — aksi halde backend guard'ı
  // (createInitialEntry) ağırlıklı girişi 400 ile reddeder.
  const weightEntryEnabled = useKk1WeightEntryEnabled();
  const emanetEnabled = useEmanetEnabled();

  const gradesQ = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: defaults,
  });

  // İdempotency anahtarı — dialog açılışı bir form-oturumudur. Timeout sonrası
  // tekrar basış aynı token'ı gönderir → backend cached top döner (hayalet stok
  // önlenir). Dialog her açılışta + başarıda yenilenir (yeni oturum).
  const [clientToken, setClientToken] = useState(() => crypto.randomUUID());
  // Mükerrer tuzağı 409 verdiyse var olan topun barkodu — satır-içi onay yolunu
  // açar. Dialog her açılışta temizlenir (yeni form oturumu = temiz sayfa).
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setClientToken(crypto.randomUUID());
      setDupWarn(null);
    }
  }, [open]);

  const grades = useMemo(() => gradesQ.data?.data ?? [], [gradesQ.data?.data]);

  /**
   * SESSİZ TUZAK — renk seçilmiş ama yarı mamul kutusu işaretsiz.
   *
   * Backend sezgisi "renk varsa bitmiş mal" der (`createInitialEntry`): Ham Stok
   * sekmesinde renk girip kutuyu işaretlemeyen operatörün topu **Bitmiş Depo'ya**
   * düşer ve o topu Ham Stok'ta arar — hata yok, uyarı yok. Engellemiyoruz
   * (renkli bitmiş mal girmek meşru bir iş), sonucu söylüyoruz.
   */
  const watchedColorId = form.watch("colorId");
  const colorWithoutSemi = !isWarehouse && !isSemiFinished && Boolean(watchedColorId);

  // printAfter + printCtx mutation değişkenlerinde taşınır → onSuccess (data, vars)
  // ile güvenilir okunur (ref/stale-closure yok); UI için mutation.variables.
  const mutation = useMutation({
    mutationFn: (args: {
      payload: InitialEntryPayload;
      printAfter: boolean;
      printCtx?: LabelCustomerContext;
    }) => rollService.createInitialEntry(args.payload),
    onSuccess: (res, vars) => {
      const roll = res.data;
      setDupWarn(null);
      toast.success(`Top oluşturuldu: ${roll?.barcode ?? "-"}`);
      // Devere Faz 4: sunucu uyarıları (levent tüketimi: take-up yok · kalan yetmedi · bağlı levent yoktu) — metin aynen.
      for (const w of entryWarnings(res)) toast.warning(w, { duration: 10000 });
      // Y1 fix: ["rolls:STOCK"] ölü key'di (STOCK sekmesi RAW/FINISHED'a bölündü)
      // — liste hiç tazelenmiyordu. ["rolls"] tüm sekme tablolarını + stats'ı kapsar.
      qc.invalidateQueries({ queryKey: ["rolls"] });
      form.reset(defaults);
      setClientToken(crypto.randomUUID()); // yeni giriş → yeni token
      onOpenChange(false);
      if (vars.printAfter && roll?.id) onCreatedForPrint?.(roll.id, vars.printCtx);
    },
    // Toast YOK (proje kuralı — interceptor backend mesajını zaten gösterir).
    // Burada yalnız mükerrer tuzağının 409'unu tanıyıp satır-içi onay yolunu
    // açarız: kullanıcı çıkışsız kalmasın, ama "yine de kaydet" AÇIK bir eylem olsun.
    onError: (err) => {
      setDupWarn(readDuplicateConflict(err));
    },
  });

  /** `confirmDuplicate` yalnız kullanıcı "Yine de Kaydet"e bastığında true olur —
   *  normal kaydetme yolunda tuzak hep devrededir. */
  const doSubmit = (printAfter: boolean, confirmDuplicate = false) =>
    form.handleSubmit((v) => {
      // Bitmiş Depo hedefi WAREHOUSE ister → backend bunu yalnız colorId ile üretir.
      // Renksiz gönderim STOCK'a düşer (Ham Stok'ta çıkar, kullanıcı depoda arar) →
      // erken engelle, net hata göster.
      if (colorRequired && !v.colorId) {
        form.setError("colorId", {
          message: isSemiFinished
            ? "Yarı mamul girişinde renk zorunlu — mal boyalı geliyor"
            : "Bitmiş depo girişi için renk zorunlu",
        });
        return;
      }
      mutation.mutate({
        payload: {
          itemId: v.itemId,
          colorId: v.colorId,
          initialQty: v.initialQty,
          weightKg: weightEntryEnabled ? v.weightKg ?? undefined : undefined,
          width: v.width,
          // Boş = Belirsiz → payload'dan düş (backend null yazar).
          qualityGrade: v.qualityGrade || undefined,
          propertyIds: v.propertyIds,
          ...(isSemiFinished ? { semiFinished: true } : {}),
          // G3 emanet: yalnız modül açıkken gövdeye girer (kapalıda alan yok — bayt bayt eski gövde).
          ...(emanetEnabled && v.ownerCustomerId ? { ownerCustomerId: v.ownerCustomerId } : {}),
          clientToken,
          ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
        },
        printAfter,
        // Müşteri seçildiyse serbest müşteri (orderLineId yok → master alias cascade);
        // seçilmezse undefined → taze topta snapshot yok → stok (müşterisiz) etiket.
        printCtx: v.customerId ? { customerId: v.customerId, orderLineId: null } : undefined,
      });
    });

  const pendingAdd = mutation.isPending && !mutation.variables?.printAfter;
  const pendingAddPrint = mutation.isPending && mutation.variables?.printAfter === true;

  const watchedItemId = form.watch("itemId");

  const numberOrNull = (raw: string): number | null =>
    raw.trim() === "" ? null : Number(raw);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) form.reset(defaults);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isWarehouse
              ? "Depoya Manuel Top Ekle"
              : isSemiTarget
                ? "Yarı Mamul Girişi"
                : "Manuel Top Ekle"}
          </DialogTitle>
          <DialogDescription>
            {isWarehouse
              ? "Bitmiş (renkli) stok girişi — renk zorunlu; top Bitmiş Depo (WAREHOUSE) statüsünde eklenir, barkodu otomatik atanır."
              : isSemiTarget
                ? "Dışarıdan alınan boyalı/işlenmiş kumaş — renk zorunlu; top Yarı Mamul olarak eklenir ve kurşun/tambur görmek üzere üretime alınmayı bekler."
                : "Dışarıdan/geçmiş ham stok girişi — top Ham Stok (STOCK) statüsünde eklenir, barkodu otomatik atanır."}
          </DialogDescription>
        </DialogHeader>

        {/* Yarı mamul = dışarıdan alınan, boyalı ama BİTMEMİŞ kumaş. İşaretlenince
            renk zorunlu olur ve top Yarı Mamul sekmesine düşer (kurşun/tambur
            görecek). Bayraksız gönderilirse renkli top doğrudan Bitmiş Depo'ya
            düşerdi — aşağıdaki uyarı tam olarak bunu söyler. */}
        {!isWarehouse && (
          <label className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={isSemiFinished}
              onChange={(e) => setIsSemiFinished(e.target.checked)}
            />
            <span>
              <strong>Dışarıdan yarı mamul</strong> — boyalı geldi, kurşun/tambur görecek.
              Renk zorunlu olur, top Yarı Mamul sekmesinde durur.
            </span>
          </label>
        )}

        {colorWithoutSemi && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Renk seçtiniz ama yukarıdaki kutu işaretli değil — bu top{" "}
              <strong>Bitmiş Depo'ya</strong> düşer. Mal boyalı gelip fabrikada
              kurşun/tambur görecekse kutuyu işaretleyin.
            </span>
          </div>
        )}

        <form onSubmit={doSubmit(false)} className="space-y-3">
          <FormField label="Kumaş" error={form.formState.errors.itemId} required>
            <Controller
              control={form.control}
              name="itemId"
              render={({ field }) => (
                <ReferenceSelect<Item>
                  value={field.value || null}
                  onChange={(v) => field.onChange(v ?? "")}
                  service={itemService}
                  queryKey="items"
                  getLabel={(it) => `${it.code} — ${it.name}`}
                  placeholder="Kumaş ara..."
                />
              )}
            />
          </FormField>

          {/* Renk + Özellikler yan yana — ikisi de tıklayınca modal açar. */}
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label={colorRequired ? "Renk" : "Renk (opsiyonel)"}
              required={colorRequired}
              error={form.formState.errors.colorId}
              hint={
                isSemiFinished
                  ? "Yarı mamul boyalı gelir — zorunlu."
                  : isWarehouse
                    ? "Bitmiş depo topu renklidir — zorunlu."
                    : "Ham mal genelde boş."
              }
            >
              <Controller
                control={form.control}
                name="colorId"
                render={({ field }) => (
                  <ColorPickerModal
                    value={field.value}
                    onChange={field.onChange}
                    allowNone={!colorRequired}
                    placeholder="Renk seç..."
                  />
                )}
              />
            </FormField>

            <FormField label="Özellikler (opsiyonel)" hint="Tıkla → modaldan seç.">
              <Controller
                control={form.control}
                name="propertyIds"
                render={({ field }) => (
                  <PropertyPickerModal
                    itemId={watchedItemId}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </FormField>
          </div>

          <div className={weightEntryEnabled ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-3"}>
            <FormField label="Metraj (mt)" htmlFor="initialQty" error={form.formState.errors.initialQty} required>
              <Input
                id="initialQty"
                type="number"
                step="0.01"
                min="0"
                {...form.register("initialQty", { valueAsNumber: true })}
              />
            </FormField>
            {weightEntryEnabled && (
              <FormField label="Ağırlık (kg)" htmlFor="weightKg" error={form.formState.errors.weightKg}>
                <Input
                  id="weightKg"
                  type="number"
                  step="0.01"
                  min="0"
                  onChange={(e) => form.setValue("weightKg", numberOrNull(e.target.value))}
                />
              </FormField>
            )}
            <FormField label="En (cm)" htmlFor="width" error={form.formState.errors.width}>
              <Input
                id="width"
                type="number"
                step="0.1"
                min="0"
                onChange={(e) => form.setValue("width", numberOrNull(e.target.value))}
              />
            </FormField>
          </div>

          <FormField
            label="Kalite Sınıfı (opsiyonel)"
            error={form.formState.errors.qualityGrade}
            hint="Kaliteye bakılmadıysa boş bırak — top 'Belirsiz' kaydedilir, kalite istasyonunda belirlenir."
          >
            <Controller
              control={form.control}
              name="qualityGrade"
              render={({ field }) => (
                <Select
                  value={field.value || QUALITY_NONE}
                  onValueChange={(v) => field.onChange(v === QUALITY_NONE ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kalite seç..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={QUALITY_NONE}>Belirsiz (kalite yok)</SelectItem>
                    {grades.map((g) => (
                      <SelectItem key={g.id} value={g.code}>
                        {g.name} ({g.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          {emanetEnabled && (
            <FormField
              label="Sahibi (emanet mal ise müşteri)"
              hint="Müşterinin işlenmek üzere bıraktığı kumaş: top o müşterinin malı olur, yalnız ona sevk edilir. Boş = bizim mal."
            >
              <Controller
                control={form.control}
                name="ownerCustomerId"
                render={({ field }) => (
                  <EntityPickerModal<Customer>
                    value={field.value}
                    onChange={field.onChange}
                    service={customerService}
                    queryKey="customers"
                    getLabel={(c) => `${c.code} — ${c.name}`}
                    nullable
                  />
                )}
              />
            </FormField>
          )}

          {canPrint && (
            <FormField
              label="Etiket müşterisi (opsiyonel)"
              hint="Yalnız 'Ekle ve Etiket Bas' kullanır — seçilmezse stok (müşterisiz) etiket. Topun kendisi müşteriye bağlanmaz."
            >
              <Controller
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <EntityPickerModal<Customer>
                    value={field.value}
                    onChange={field.onChange}
                    service={customerService}
                    queryKey="customers"
                    getLabel={(c) => `${c.code} — ${c.name}`}
                    nullable
                  />
                )}
              />
            </FormField>
          )}

          {/* Mükerrer tuzağı: sunucu "bu top az önce girilmiş olabilir" dedi.
              Engel DEĞİL — arka arkaya birebir aynı top gerçekten gelir; çıkış
              yolu açık ama AÇIK bir eylem olarak duruyor. */}
          {dupWarn && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Bu top az önce girilmiş olabilir — barkod {dupWarn}
              </p>
              <p className="mt-1 text-amber-800 dark:text-amber-300">
                Aynı kumaş, metraj ve en, kısa süre önce sizin tarafınızdan
                kaydedilmiş. Gerçekten ayrı bir topsa onaylayın.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={mutation.isPending}
                onClick={doSubmit(false, true)}
              >
                Evet, ayrı bir top — yine de kaydet
              </Button>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="destructive" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-600/90"
            >
              {pendingAdd ? "Ekleniyor..." : "Ekle"}
            </Button>
            {canPrint && (
              <Button type="button" disabled={mutation.isPending} onClick={doSubmit(true)} className="gap-1.5">
                <Printer className="h-4 w-4" />
                {pendingAddPrint ? "Ekleniyor..." : "Ekle ve Etiket Bas"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
