import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "./SettingRow";
import { InfoPopover } from "./SettingHint";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService } from "@/services/featureFlagService";
import {
  DEFAULT_COMPANY_LEGAL_IDENTITY,
  LEGAL_IDENTITY_LIMITS,
  taxIdHint,
  type CompanyLegalIdentity,
} from "@/services/eIrsaliyeSettings";

type TextKey = keyof typeof LEGAL_IDENTITY_LIMITS;

/** Form alanları — sıra ve etiketler; `zorunlu` e-İrsaliye hazırlığının istediği alanlar. */
const FIELDS: { key: TextKey; label: string; placeholder?: string; zorunlu?: boolean; yalnizTckn?: boolean }[] = [
  { key: "unvan", label: "Ticari unvan", placeholder: "Örn. Örnek Tekstil Sanayi ve Ticaret A.Ş.", zorunlu: true },
  { key: "kisiAd", label: "Kişi adı", zorunlu: true, yalnizTckn: true },
  { key: "kisiSoyad", label: "Kişi soyadı", zorunlu: true, yalnizTckn: true },
  { key: "vergiDairesi", label: "Vergi dairesi", placeholder: "Örn. Nilüfer", zorunlu: true },
  { key: "cadde", label: "Cadde / sokak", placeholder: "Örn. OSB 5. Cadde" },
  { key: "binaNo", label: "Bina no" },
  { key: "ilce", label: "İlçe", zorunlu: true },
  { key: "il", label: "İl", zorunlu: true },
  { key: "postaKodu", label: "Posta kodu" },
  { key: "mersisNo", label: "MERSİS no" },
  { key: "ticaretSicilNo", label: "Ticaret sicil no" },
  { key: "telefon", label: "Telefon" },
  { key: "eposta", label: "E-posta" },
  { key: "web", label: "Web" },
];

const same = (a: CompanyLegalIdentity, b: CompanyLegalIdentity) =>
  (Object.keys(a) as (keyof CompanyLegalIdentity)[]).every((k) => String(a[k]).trim() === String(b[k]).trim());

/**
 * Firma RESMİ künyesi (e-belge kimliği) — serbest metin "Belge Künyesi"nden ayrı soru:
 * o kâğıda basılan süs, bu e-İrsaliye'nin gönderici kimliği. Kendi Kaydet'i vardır;
 * kirlilik üst bölüme `onDirtyChange` ile bildirilir (sayfada tek kirlilik kaydı olur).
 */
export function CompanyLegalIdentityCard({
  onDirtyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const companyName = flagsQ.data?.data?.companyName ?? "";
  const current = flagsQ.data?.data?.companyLegalIdentity ?? DEFAULT_COMPANY_LEGAL_IDENTITY;
  const currentKey = JSON.stringify(current);
  const [draft, setDraft] = useState<CompanyLegalIdentity>(current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(current), [currentKey]);

  const dirty = !same(draft, current);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const mut = useMutation({
    mutationFn: (payload: CompanyLegalIdentity) => featureFlagService.update({ companyLegalIdentity: payload }),
    onSuccess: (res) => {
      // Taslak SUNUCU cevabından kurulur: temizlenmiş değer (rakam süzme, kırpma) ekranda görünsün.
      const saved = res.data?.companyLegalIdentity;
      if (saved) setDraft(saved);
      toast.success("Resmi künye kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const hint = useMemo(() => taxIdHint(draft.kimlikTuru, draft.kimlikNo), [draft.kimlikTuru, draft.kimlikNo]);
  const set = (k: keyof CompanyLegalIdentity, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const tckn = draft.kimlikTuru === "TCKN";

  return (
    <div className="border-t pt-4" data-testid="legal-identity-card">
      <div className="flex items-center gap-1.5">
        <div className="text-sm font-medium">Resmi künye (e-belge)</div>
        <InfoPopover desc="e-İrsaliye'de gönderici olarak yazılan resmi kimlik. Yukarıdaki Belge Künyesi kâğıda basılan serbest metindir; bu alanlar ondan bağımsızdır. Yıldızlı alanlar e-İrsaliye için zorunludur." />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <KimlikFields draft={draft} hint={hint} set={set} />
        {FIELDS.filter((f) => !f.yalnizTckn || tckn).map((f) => (
          <div key={f.key}>
            <FieldLabel htmlFor={`legal-${f.key}`} label={`${f.label}${f.zorunlu ? " *" : ""}`} />
            <input
              id={`legal-${f.key}`}
              value={draft[f.key]}
              maxLength={LEGAL_IDENTITY_LIMITS[f.key] + (f.key === "postaKodu" || f.key === "mersisNo" ? 8 : 0)}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)}
              className={INPUT_CLS}
            />
            {f.key === "unvan" && !draft.unvan.trim() && companyName && (
              <button
                type="button"
                className="mt-1 text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => set("unvan", companyName)}
              >
                Firma adını kullan: {companyName}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4">
        <SettingsSaveBar
          dirty={dirty}
          saving={mut.isPending}
          onSave={() => mut.mutate(draft)}
          onReset={() => setDraft(current)}
          note="Kimlik numarasının doğruluğu kayıtta değil, e-İrsaliye hazırlık denetiminde ölçülür (Şirket & Güvenlik → e-İrsaliye)."
        />
      </div>
    </div>
  );
}

const INPUT_CLS =
  "mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Kimlik türü seçimi + numara; sağlama ipucu yalnız bilgi (esas karar sunucuda). */
function KimlikFields({
  draft,
  hint,
  set,
}: {
  draft: CompanyLegalIdentity;
  hint: string | null;
  set: (k: keyof CompanyLegalIdentity, v: string) => void;
}) {
  return (
    <>
        <div>
          <FieldLabel htmlFor="legal-kind" label="Kimlik türü *" />
          <div id="legal-kind" className="mt-2 flex gap-2" role="radiogroup" aria-label="Kimlik türü">
            {(["VKN", "TCKN"] as const).map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                role="radio"
                aria-checked={draft.kimlikTuru === k}
                variant={draft.kimlikTuru === k ? "default" : "outline"}
                onClick={() => set("kimlikTuru", k)}
              >
                {k === "VKN" ? "VKN (şirket)" : "TCKN (şahıs firması)"}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <FieldLabel htmlFor="legal-kimlikNo" label={`${draft.kimlikTuru} *`} />
          <input
            id="legal-kimlikNo"
            inputMode="numeric"
            value={draft.kimlikNo}
            maxLength={LEGAL_IDENTITY_LIMITS.kimlikNo + 8}
            onChange={(e) => set("kimlikNo", e.target.value)}
            className={INPUT_CLS}
          />
          {hint && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{hint}</p>}
        </div>
    </>
  );
}
