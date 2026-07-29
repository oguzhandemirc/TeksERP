import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
  }, [
    currentName,
    currentHead.addressLine,
    currentHead.phone,
    currentHead.taxInfo,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    (currentHead.extraLines ?? []).join("\n"),
  ]);

  const mut = useMutation({
    mutationFn: (payload: { companyName: string; companyLetterhead: CompanyLetterhead }) =>
      featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Şirket bilgileri kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const trimmedName = name.trim();
  const cleanLines = (xs: string[] | undefined) =>
    (xs ?? []).map((x) => x.trim()).filter(Boolean).join("\n");
  const dirty =
    trimmedName !== currentName.trim() ||
    head.addressLine.trim() !== currentHead.addressLine.trim() ||
    head.phone.trim() !== currentHead.phone.trim() ||
    head.taxInfo.trim() !== currentHead.taxInfo.trim() ||
    cleanLines(head.extraLines) !== cleanLines(currentHead.extraLines);
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
            <div>
              <FieldLabel
                htmlFor="company-extra"
                label="Ek Künye Satırları"
                desc="Her satır belgede ayrı satır olarak basılır — IBAN, Mersis, e-posta, web vb. (en fazla 5 satır)."
              />
              <textarea
                id="company-extra"
                rows={3}
                value={(head.extraLines ?? []).join("\n")}
                onChange={(e) =>
                  setHead((h) => ({
                    ...h,
                    extraLines: e.target.value.split("\n").slice(0, 5).map((x) => x.slice(0, 120)),
                  }))
                }
                placeholder={"Örn. IBAN: TR12 0000 ...\nwww.ornek.com.tr"}
                className="mt-2 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
        </div>

        <LogoField />

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
                extraLines: (head.extraLines ?? []).map((x) => x.trim()).filter(Boolean),
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

/** Kabul edilen logo türleri + ~100KB dosya sınırı (backend LOGO_MAX_CHARS ile uyumlu). */
const LOGO_MIME = new Set(["image/png", "image/jpeg", "image/svg+xml"]);
const LOGO_MAX_FILE_BYTES = 110_000;

/**
 * Belge logosu — yükle/kaldır ANINDA kaydedilir (save bar'dan bağımsız; logo
 * kütüphanesi append-only olduğu için geri alma = eski görseli yeniden yüklemek).
 * Eski donmuş belgeler kendi logolarıyla basılmaya devam eder.
 */
function LogoField() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const logoQ = useQuery({
    queryKey: ["documents-logo"],
    queryFn: () => featureFlagService.getDocumentsLogo(),
  });
  const dataUrl = logoQ.data?.data?.dataUrl ?? null;

  const mut = useMutation({
    mutationFn: (next: string | null) => featureFlagService.setDocumentsLogo(next),
    onSuccess: (res) => {
      toast.success(res.message ?? "Logo güncellendi.");
      void qc.invalidateQueries({ queryKey: ["documents-logo"] });
    },
  });

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_MIME.has(file.type)) {
      toast.error("Logo PNG, JPEG veya SVG olmalı.");
      return;
    }
    if (file.size > LOGO_MAX_FILE_BYTES) {
      toast.error("Logo en fazla ~100KB olabilir — görseli küçültüp tekrar deneyin.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => mut.mutate(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="border-t pt-4">
      <div className="flex items-center gap-1.5">
        <div className="text-sm font-medium">Belge Logosu</div>
        <InfoPopover desc='Yazdırılan irsaliye/çeki listelerinin başlığına basılır. Belge başına "Logoyu bas" ve konum ayarı Belge Şablonları sekmesindedir. Yükleme anında kaydedilir; eski donmuş belgeler kendi logolarıyla basılmaya devam eder.' />
      </div>
      <div className="mt-3 flex items-center gap-4">
        <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-md border bg-white">
          {logoQ.isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : dataUrl ? (
            <img src={dataUrl} alt="Belge logosu" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="px-2 text-center text-[11px] text-muted-foreground">Logo yok</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              onPick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={mut.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> {dataUrl ? "Değiştir" : "Logo Yükle"}
          </Button>
          {dataUrl && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1 text-destructive hover:text-destructive"
              disabled={mut.isPending}
              onClick={() => mut.mutate(null)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Kaldır
            </Button>
          )}
        </div>
      </div>
    </div>
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
