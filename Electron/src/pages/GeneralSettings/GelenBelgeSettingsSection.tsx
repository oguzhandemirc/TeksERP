// =============================================================================
// GENEL AYARLAR → GELEN BELGE (hizmet ekseni E3)
// =============================================================================
// İki ayar, tek uç (`PUT /api/gelen-belge/ayarlar`; ham ayar ucu bu anahtarları reddeder):
//   · varsayılan ürün — ürünü seçilmemiş satır onayda bu ürünle girer (boş = bugünkü: ürün seçilmeli)
//   · gözden geçirilmemiş hücre varken onay — Uyar (varsayılan, bugünkü) | Engelle
// Ürün seçici DOĞRUDAN modal açar (combobox yok); yalnız aktif kumaş listelenir, sunucu ikinci kapıdır.
// =============================================================================
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, PackageSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { apiErrorText } from "@/lib/api-error";
import { FieldLabel } from "./SettingRow";
import { EnumRadioOptions } from "./EnumRadioOptions";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { useRegisterSettingsDirty } from "./settings-dirty";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import {
  getIncomingDocumentSettings,
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY,
  updateIncomingDocumentSettings,
} from "@/pages/Operations/GelenBelgeler/service";
import type { UnreviewedApproval } from "@/pages/Operations/GelenBelgeler/types";

export const UNREVIEWED_APPROVAL_OPTIONS: ReadonlyArray<{ value: UnreviewedApproval; label: string; hint: string }> = [
  { value: "WARN", label: "Uyar, onaya izin ver", hint: "Gözden geçirilmemiş satır varken onay geçer; sonuçta uyarı gösterilir (bugünkü davranış)." },
  { value: "BLOCK", label: "Engelle", hint: "Gözden geçirilmemiş satır varken onay reddedilir; önce hücreler gözden geçirilir." },
];

type DraftItem = { id: string; label: string } | null;

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
  const [picking, setPicking] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setItem(serverItem); setMode(server?.unreviewedApproval ?? "WARN"); }, [server?.defaultItem?.id, server?.unreviewedApproval]);

  const itemDirty = (item?.id ?? null) !== (server?.defaultItem?.id ?? null);
  const modeDirty = mode !== (server?.unreviewedApproval ?? "WARN");
  useRegisterSettingsDirty(itemDirty || modeDirty);

  const mut = useMutation({
    mutationFn: () => updateIncomingDocumentSettings({ ...(itemDirty ? { defaultItemId: item?.id ?? null } : {}), ...(modeDirty ? { unreviewedApproval: mode } : {}) }),
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

        <div>
          <FieldLabel htmlFor="gb-unreviewed" label="Gözden geçirilmemiş hücre varken onay" desc="El yazısı ya da okunamayan hücreler 'Gözden geçir' işaretiyle gelir." />
          <div id="gb-unreviewed" className="mt-2">
            <EnumRadioOptions name="Gözden geçirilmemiş hücre varken onay" value={mode} options={UNREVIEWED_APPROVAL_OPTIONS} onChange={(v) => setMode(v as UnreviewedApproval)} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {UNREVIEWED_APPROVAL_OPTIONS.find((o) => o.value === server?.defaultUnreviewedApproval)?.label ?? "Uyar"}</p>
        </div>

        <SettingsSaveBar dirty={itemDirty || modeDirty} saving={mut.isPending} onSave={() => mut.mutate()} onReset={() => { setItem(serverItem); setMode(server?.unreviewedApproval ?? "WARN"); }} />
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
