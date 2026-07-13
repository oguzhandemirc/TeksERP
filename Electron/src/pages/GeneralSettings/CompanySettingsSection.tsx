import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { FieldLabel } from "./SettingRow";
import { InfoPopover } from "./SettingHint";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { useRegisterSettingsDirty } from "./settings-dirty";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import {
  featureFlagService,
  DEFAULT_COMPANY_NAME,
  DEFAULT_COMPANY_LETTERHEAD,
  type CompanyLetterhead,
} from "@/services/featureFlagService";

/**
 * Şirket bilgileri paneli — firma adı + belge künyesi (adres/telefon/vergi).
 * Firma adı sidebar marka başlığında ve uygulama genelinde gösterilir; künye ise
 * yazdırılan belgelerin (irsaliye/çeki) üst bloğunda firma adının altına basılır
 * (ilgili belgede "Firma künyesini bas" açıksa — Belge Şablonları sekmesi).
 * Refakat kartının kendi firma adından/künyesinden bağımsızdır (kart snapshot'ı ayrı).
 */
export function CompanySettingsSection() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const currentName = flagsQ.data?.data?.companyName ?? DEFAULT_COMPANY_NAME;
  const currentHead = flagsQ.data?.data?.companyLetterhead ?? DEFAULT_COMPANY_LETTERHEAD;

  const [name, setName] = useState(currentName);
  const [head, setHead] = useState<CompanyLetterhead>(currentHead);
  useEffect(() => {
    // Sunucudan gelen değer değişince formu eşitle.
    setName(currentName);
    setHead(currentHead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentName, currentHead.addressLine, currentHead.phone, currentHead.taxInfo]);

  const mut = useMutation({
    mutationFn: (payload: { companyName: string; companyLetterhead: CompanyLetterhead }) =>
      featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Şirket bilgileri kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const trimmedName = name.trim();
  const dirty =
    trimmedName !== currentName.trim() ||
    head.addressLine.trim() !== currentHead.addressLine.trim() ||
    head.phone.trim() !== currentHead.phone.trim() ||
    head.taxInfo.trim() !== currentHead.taxInfo.trim();
  useRegisterSettingsDirty(dirty);
  const reset = () => {
    setName(currentName);
    setHead(currentHead);
  };

  if (flagsQ.isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <PermissionGate
      permission="admin:settings"
      fallback={
        <div className="text-sm text-muted-foreground">
          Bu ayarı değiştirmek için yetkin yok.
        </div>
      }
    >
      <div className="space-y-5">
        <Field
          id="company-name"
          label="Firma Adı"
          desc="Sol menü başlığında ve uygulama genelinde gösterilir."
          value={name}
          maxLength={120}
          placeholder={DEFAULT_COMPANY_NAME}
          onChange={setName}
        />

        <div className="border-t pt-4">
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-medium">Belge Künyesi</div>
            <InfoPopover desc='Yazdırılan irsaliye/çeki listelerinin üst bloğunda firma adının altına basılır (ilgili belgede "Firma künyesini bas" açıksa). Boş alanlar basılmaz.' />
          </div>
          <div className="mt-3 space-y-4">
            <Field
              id="company-address"
              label="Adres"
              value={head.addressLine}
              maxLength={200}
              placeholder="Örn. Organize Sanayi Bölgesi 5. Cadde No:12, Bursa"
              onChange={(v) => setHead((h) => ({ ...h, addressLine: v }))}
            />
            <Field
              id="company-phone"
              label="Telefon"
              value={head.phone}
              maxLength={60}
              placeholder="Örn. 0224 123 45 67"
              onChange={(v) => setHead((h) => ({ ...h, phone: v }))}
            />
            <Field
              id="company-tax"
              label="Vergi Dairesi / No"
              value={head.taxInfo}
              maxLength={120}
              placeholder="Örn. Nilüfer V.D. 1234567890"
              onChange={(v) => setHead((h) => ({ ...h, taxInfo: v }))}
            />
          </div>
        </div>

        <SettingsSaveBar
          dirty={dirty}
          saving={mut.isPending}
          canSave={Boolean(trimmedName)}
          onSave={() =>
            mut.mutate({
              companyName: trimmedName,
              companyLetterhead: {
                addressLine: head.addressLine.trim(),
                phone: head.phone.trim(),
                taxInfo: head.taxInfo.trim(),
              },
            })
          }
          onReset={reset}
          note={`Firma adı boş bırakılırsa varsayılan (${DEFAULT_COMPANY_NAME}) kullanılır. Refakat kartının firma adı/künyesi ayrı yönetilir (Refakat Kartı sekmesi).`}
        />
      </div>
    </PermissionGate>
  );
}

function Field({
  id,
  label,
  desc,
  value,
  maxLength,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  desc?: string;
  value: string;
  maxLength: number;
  placeholder?: string;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} desc={desc} />
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}
