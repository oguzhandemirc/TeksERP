// =============================================================================
// GENEL AYARLAR → GELEN BELGE (hizmet ekseni E3)
// =============================================================================
// Üç ayar, tek uç (`PUT /api/gelen-belge/ayarlar`; ham ayar ucu bu anahtarları reddeder):
//   · varsayılan ürün — ürünü seçilmemiş satır onayda bu ürünle girer (boş = bugünkü: ürün seçilmeli)
//   · gözden geçirilmemiş hücre varken onay — Uyar (varsayılan, bugünkü) | Engelle
//   · onaydan sonra otomatik iş emri — kapalı (varsayılan, bugünkü: iş emri plan ekranından elle)
//   · fabrika varsayılan rotası + rota önerisi önceliği — boş / "önce müşteri geçmişi" (varsayılan, bugünkü)
//   · el yazısı şüpheli değer oranı K — 4 (varsayılan; alt sınır bugünkü %25, üst sınır yeni, yalnız uyarı)
// Ürün seçici DOĞRUDAN modal açar (combobox yok); yalnız aktif kumaş listelenir, sunucu ikinci kapıdır.
// =============================================================================
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, PackageSearch, Route as RouteIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { routeService } from "@/pages/Routes/service";
import type { ProductionRoute } from "@/pages/Routes/types";
import { apiErrorText } from "@/lib/api-error";
import { TERIM } from "@/lib/terim";
import { FieldLabel, FlagToggle } from "./SettingRow";
import { EnumRadioOptions } from "./EnumRadioOptions";
import { OutlierFactorField, useOutlierDraft } from "./GelenBelgeOutlierField";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { useRegisterSettingsDirty } from "./settings-dirty";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import {
  getIncomingDocumentSettings,
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY,
  updateIncomingDocumentSettings,
} from "@/pages/Operations/GelenBelgeler/service";
import type { IncomingDocumentSettings, RouteSuggestionPriority, UnreviewedApproval } from "@/pages/Operations/GelenBelgeler/types";

export const UNREVIEWED_APPROVAL_OPTIONS: ReadonlyArray<{ value: UnreviewedApproval; label: string; hint: string }> = [
  { value: "WARN", label: "Uyar, onaya izin ver", hint: "Gözden geçirilmemiş satır varken onay geçer; sonuçta uyarı gösterilir (bugünkü davranış)." },
  { value: "BLOCK", label: "Engelle", hint: "Gözden geçirilmemiş satır varken onay reddedilir; önce hücreler gözden geçirilir." },
];

const IE = TERIM.terbiyeIsEmri;
const AUTO_WORK_ORDER_DESC = `Onaylanan belgenin topları desen/gramaj ve kumaşa göre gruplanır; işlem değeri net çözülen her grup için ${IE.tekilKucuk}, aşağıdaki rota önerisiyle açılır (plan ekranındaki '${IE.tekilKucuk} aç' ile aynı işlem). Deseni çözülemeyen gruplar, rota önerisi olmayan müşteri ve ${IE.tekilKucuk} açma yetkisi olmayan onaylayan için ${IE.tekilKucuk} açılmaz; onay sonucu hangi grubun elle açılması gerektiğini yazar. Onay bundan etkilenmez. Kapalı (varsayılan) = bugünkü davranış: ${IE.cogulKucuk} plan ekranından elle açılır.`;

function AutoWorkOrderToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div data-testid="gb-auto-work-order">
      <FlagToggle
        title={`Onaydan sonra ${IE.cekimKucuk.belirtme} otomatik aç`}
        summary={`Belge onaylanınca deseni/gramajı belli her grup için ${IE.tekilKucuk} kendiliğinden açılır.`}
        desc={AUTO_WORK_ORDER_DESC}
        defaultOn={false}
        checked={checked}
        onChange={onChange}
      />
    </div>
  );
}

export const ROUTE_PRIORITY_OPTIONS: ReadonlyArray<{ value: RouteSuggestionPriority; label: string; hint: string }> = [
  { value: "CUSTOMER_FIRST", label: "Önce müşteri geçmişi", hint: `Önce müşterinin son ${IE.cekimKucuk.bulunma}ki rota, sonra müşteriye tanımlı tek rota şablonu, en son fabrika varsayılanı (bugünkü davranış).` },
  { value: "FACTORY_FIRST", label: "Her zaman fabrika varsayılanı", hint: "Fabrika varsayılan rotası seçiliyse hep o önerilir; boşsa müşteri geçmişine bakılır." },
];

type RouteFieldsProps = {
  routeId: string | null;
  onRouteChange: (id: string | null) => void;
  priority: RouteSuggestionPriority;
  onPriorityChange: (v: RouteSuggestionPriority) => void;
  saved: IncomingDocumentSettings | undefined;
  routeDirty: boolean;
};

/** Fabrika varsayılan rotası + öneri önceliği — backend `suggestRoute` zincirinin iki ayarı. */
function RouteSuggestionFields({ routeId, onRouteChange, priority, onPriorityChange, saved, routeDirty }: RouteFieldsProps) {
  const savedRoute = saved?.defaultRoute;
  const defaultPriority = saved?.defaultRouteSuggestionPriority ?? "CUSTOMER_FIRST";
  return (
    <>
      <div data-testid="gb-default-route">
        <FieldLabel
          htmlFor="gb-default-route-picker"
          label="Fabrika varsayılan rotası"
          desc={`Belgeden ${IE.tekilKucuk} açarken müşteri için rota bulunamazsa önerilen rota şablonu; otomatik ${IE.tekilKucuk} ve plan ekranındaki ön seçim aynı öneriyi kullanır. Boş (varsayılan) = bugünkü davranış: rota yalnız müşteri kaynaklarından önerilir.`}
        />
        <div id="gb-default-route-picker" className="mt-2">
          <EntityPickerModal<ProductionRoute>
            value={routeId}
            onChange={onRouteChange}
            service={routeService}
            queryKey="routes"
            getLabel={(r) => r.name}
            getSubLabel={(r) => r.code}
            sortBy="name"
            nullable
            noneLabel="— Boş (yalnız müşteri kaynakları)"
            icon={RouteIcon}
            placeholder="Rota şablonu seç (boş)"
            title="Fabrika varsayılan rotası"
            countLabel="rota"
          />
        </div>
        {savedRoute?.problem && !routeDirty && (
          <div role="alert" className="mt-2 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Kayıtlı rota şu an kullanılamıyor ({savedRoute.name}): {savedRoute.problem}. Bu durumda rota önerilmez; başka rota seçin ya da temizleyin.</span>
          </div>
        )}
      </div>
      <div>
        <FieldLabel htmlFor="gb-route-priority" label="Rota önerisi önceliği" desc={`Belgeden ${IE.tekilKucuk} açarken önerilen rotanın hangi kaynaktan önce alınacağı.`} />
        <div id="gb-route-priority" className="mt-2">
          <EnumRadioOptions name="Rota önerisi önceliği" value={priority} options={ROUTE_PRIORITY_OPTIONS} onChange={(v) => onPriorityChange(v as RouteSuggestionPriority)} />
        </div>
        {priority === "FACTORY_FIRST" && !routeId && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Fabrika varsayılan rotası boş; bu seçenek rota seçilene dek müşteri geçmişiyle aynı çalışır.</p>}
        <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {ROUTE_PRIORITY_OPTIONS.find((o) => o.value === defaultPriority)?.label}</p>
      </div>
    </>
  );
}

/** Rota ayarlarının taslağı; eski backend alanları göndermez → boş rota + müşteri önceliği (bugünkü davranış). */
function useRouteDraft(server: IncomingDocumentSettings | undefined) {
  const serverRouteId = server?.defaultRoute?.id ?? null;
  const serverPriority: RouteSuggestionPriority = server?.routeSuggestionPriority ?? "CUSTOMER_FIRST";
  const [routeId, setRouteId] = useState<string | null>(serverRouteId);
  const [priority, setPriority] = useState<RouteSuggestionPriority>(serverPriority);
  const routeDirty = routeId !== serverRouteId;
  const priorityDirty = priority !== serverPriority;
  const body = { ...(routeDirty ? { defaultRouteTemplateId: routeId } : {}), ...(priorityDirty ? { routeSuggestionPriority: priority } : {}) };
  const reset = () => { setRouteId(serverRouteId); setPriority(serverPriority); };
  return { serverRouteId, serverPriority, routeId, setRouteId, priority, setPriority, routeDirty, priorityDirty, body, reset };
}

type DraftItem = { id: string; label: string } | null;

/** Gözden geçirilmemiş hücre varken onay — Uyar | Engelle. */
function UnreviewedApprovalField({ value, onChange, defaultValue }: { value: UnreviewedApproval; onChange: (v: UnreviewedApproval) => void; defaultValue?: UnreviewedApproval }) {
  return (
    <div>
      <FieldLabel htmlFor="gb-unreviewed" label="Gözden geçirilmemiş hücre varken onay" desc="El yazısı ya da okunamayan hücreler 'Gözden geçir' işaretiyle gelir." />
      <div id="gb-unreviewed" className="mt-2">
        <EnumRadioOptions name="Gözden geçirilmemiş hücre varken onay" value={value} options={UNREVIEWED_APPROVAL_OPTIONS} onChange={(v) => onChange(v as UnreviewedApproval)} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {UNREVIEWED_APPROVAL_OPTIONS.find((o) => o.value === defaultValue)?.label ?? "Uyar"}</p>
    </div>
  );
}

export function IncomingDocumentSettingsSection({ writePermissions = [SETTINGS_ADMIN_PERMISSION] }: { writePermissions?: string[] }) {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  // Modül kapalıyken uçlar 403 MODULE_DISABLED verir — sorgu hiç atılmaz, sebep yazılır.
  const moduleOn = flagsQ.data?.data?.gelenBelgeEnabled === true;
  const q = useQuery({ queryKey: INCOMING_DOCUMENT_SETTINGS_QUERY_KEY, queryFn: getIncomingDocumentSettings, enabled: moduleOn });
  const server = q.data;
  const serverItem: DraftItem = server?.defaultItem ? { id: server.defaultItem.id, label: `${server.defaultItem.name} — ${server.defaultItem.code}` } : null;
  const [item, setItem] = useState<DraftItem>(serverItem);
  const [mode, setMode] = useState<UnreviewedApproval>(server?.unreviewedApproval ?? "WARN");
  // Eski backend alanı göndermez → false (bugünkü davranış).
  const serverAuto = server?.autoWorkOrder === true;
  const [auto, setAuto] = useState(serverAuto);
  const rd = useRouteDraft(server);
  const od = useOutlierDraft(server);
  const [picking, setPicking] = useState(false);
  const resetAll = () => { setItem(serverItem); setMode(server?.unreviewedApproval ?? "WARN"); setAuto(serverAuto); rd.reset(); od.reset(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(resetAll, [server?.defaultItem?.id, server?.unreviewedApproval, serverAuto, rd.serverRouteId, rd.serverPriority, od.serverValue]);

  const itemDirty = (item?.id ?? null) !== (server?.defaultItem?.id ?? null);
  const modeDirty = mode !== (server?.unreviewedApproval ?? "WARN");
  const autoDirty = auto !== serverAuto;
  const dirty = itemDirty || modeDirty || autoDirty || rd.routeDirty || rd.priorityDirty || od.dirty;
  useRegisterSettingsDirty(dirty);

  const body = { ...(itemDirty ? { defaultItemId: item?.id ?? null } : {}), ...(modeDirty ? { unreviewedApproval: mode } : {}), ...(autoDirty ? { autoWorkOrder: auto } : {}), ...rd.body, ...od.body };
  const mut = useMutation({
    mutationFn: () => updateIncomingDocumentSettings(body),
    onSuccess: (saved) => {
      qc.setQueryData(INCOMING_DOCUMENT_SETTINGS_QUERY_KEY, saved);
      toast.success("Gelen belge ayarları kaydedildi.");
    },
  });

  if (flagsQ.isLoading || (moduleOn && q.isLoading)) return <Skeleton className="h-48 w-full" />;
  if (!moduleOn) return <div className="text-sm text-muted-foreground" data-testid="gelen-belge-settings-off">Gelen belge modülü kapalı. Bu ayarlar modül açıkken kullanılır (Sistem → Modüller).</div>;
  if (q.isError) return <div className="text-sm text-destructive">Ayarlar okunamadı: {apiErrorText(q.error, "bilinmeyen hata")}</div>;

  return (
    <PermissionGate anyOf={writePermissions} fallback={<div className="text-sm text-muted-foreground">Bu ayarı değiştirmek için yetkin yok.</div>}>
      <div className="space-y-6" data-testid="gelen-belge-settings">
        <div>
          <FieldLabel
            htmlFor="gb-default-item"
            label="Varsayılan ürün"
            desc="Gelen belgede kumaşı seçilmemiş satır onayda bu ürünle top olur; müşterinin kumaş adı ve rengi satırda kalır, etikete basılabilir. Boş (varsayılan) = bugünkü davranış: her satırda kumaş seçilmeden onaylanamaz."
          />
          <div id="gb-default-item" className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="max-w-full justify-start truncate" onClick={() => setPicking(true)} data-testid="gb-default-item-button">
              <PackageSearch className="mr-1.5 h-4 w-4 shrink-0" />
              {item?.label ?? "Ürün seç (boş)"}
            </Button>
            {item && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setItem(null)} aria-label="Varsayılan ürünü temizle">
                <X className="mr-1 h-3.5 w-3.5" /> Temizle
              </Button>
            )}
          </div>
          {server?.defaultItem?.problem && !itemDirty && (
            <div role="alert" className="mt-2 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Kayıtlı ürün şu an kullanılamıyor: {server.defaultItem.problem} Bu durumda kumaşı seçilmemiş satırlı belge onaylanamaz.</span>
            </div>
          )}
        </div>

        <UnreviewedApprovalField value={mode} onChange={setMode} defaultValue={server?.defaultUnreviewedApproval} />

        <AutoWorkOrderToggle checked={auto} onChange={setAuto} />
        <RouteSuggestionFields routeId={rd.routeId} onRouteChange={rd.setRouteId} priority={rd.priority} onPriorityChange={rd.setPriority} saved={server} routeDirty={rd.routeDirty} />
        <OutlierFactorField draft={od} defaultValue={server?.defaultHandwritingOutlierFactor} />

        <SettingsSaveBar dirty={dirty} saving={mut.isPending} onSave={() => mut.mutate()} onReset={resetAll} />
        <ItemPickerModal
          open={picking}
          onOpenChange={setPicking}
          allowedTypes={["FABRIC"]}
          lifecycle="ACTIVE"
          onPick={(row) => { setItem({ id: row.id, label: `${row.name} — ${row.code}` }); setPicking(false); }}
        />
      </div>
    </PermissionGate>
  );
}
