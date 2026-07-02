import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService } from "@/services/featureFlagService";
import { formatRollName } from "@/lib/roll-name";

const DEFAULT_COPIES = 2;
const MAX_COPIES = 5;
const DEFAULT_TEMPLATE = "{item} {color} {width}";
const TOKEN_RE = /\{(item|color|width|quality)\}/;

/**
 * Saha #6: Etiket baskı ayarı — top etiketi bir baskıda kaç kopya çıksın.
 * Default 2 (etiket topun bir üstüne bir altına yapıştırılıyor). Tambur kesimi
 * ve tartı/paket/sevkiyat baskıları bu ayarı kullanır; tek seferlik istisna
 * gerektiğinde baskı ekranları ?copies= ile override edebilir.
 */
export function LabelSettingsSection() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const current = flagsQ.data?.data?.labelCopies ?? DEFAULT_COPIES;
  const currentTemplate = flagsQ.data?.data?.rollNameTemplate?.trim() || DEFAULT_TEMPLATE;

  const [copies, setCopies] = useState(String(current));
  const [template, setTemplate] = useState(currentTemplate);
  useEffect(() => {
    setCopies(String(current));
  }, [current]);
  useEffect(() => {
    setTemplate(currentTemplate);
  }, [currentTemplate]);

  const mut = useMutation({
    mutationFn: (payload: { labelCopies: number }) => featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Etiket ayarı kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const templateMut = useMutation({
    mutationFn: (payload: { rollNameTemplate: string }) => featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Top adı şablonu kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const nativeOn = flagsQ.data?.data?.nativeSendEnabled ?? false;
  const nativeMut = useMutation({
    mutationFn: (payload: { nativeSendEnabled: boolean }) => featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Doğrudan gönderim ayarı kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) return <Skeleton className="h-24 w-full" />;

  const num = Number(copies);
  const valid = Number.isInteger(num) && num >= 1 && num <= MAX_COPIES;
  const dirty = num !== current;

  const tplTrimmed = template.trim();
  const tplValid = tplTrimmed.length > 0 && tplTrimmed.length <= 100 && TOKEN_RE.test(tplTrimmed);
  const tplDirty = tplTrimmed !== currentTemplate;
  const tplPreview = formatRollName(tplTrimmed || DEFAULT_TEMPLATE, {
    item: "PATOS",
    color: "055-BEYAZ",
    width: 150,
    quality: "A",
  });

  return (
    <PermissionGate
      permission="admin:settings"
      fallback={
        <p className="text-sm">
          Etiket kopya adedi: <span className="rounded-md border px-2 py-0.5 text-xs">{current}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            (değiştirmek için <code>admin:settings</code> gerekir)
          </span>
        </p>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="label-copies" className="text-sm font-medium">
            Etiket kopya adedi
          </label>
          <p className="text-xs text-muted-foreground">
            Bir top etiketi baskısında kaç kopya çıkar. 2 = etiket topun bir üstüne, bir
            altına yapıştırılır (varsayılan). Tambur kesimi ve tartı/paket baskılarında
            geçerlidir.
          </p>
          <input
            id="label-copies"
            type="number"
            inputMode="numeric"
            value={copies}
            min={1}
            max={MAX_COPIES}
            step={1}
            onChange={(e) => setCopies(e.target.value)}
            className="mt-2 flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {!valid && (
            <p className="mt-1 text-xs text-destructive">1–{MAX_COPIES} arası bir sayı girin.</p>
          )}
        </div>
        <Button
          type="button"
          disabled={!dirty || !valid || mut.isPending}
          onClick={() => mut.mutate({ labelCopies: num })}
        >
          {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
        </Button>

        {/* Saha #20: top adı format şablonu */}
        <div className="border-t pt-4">
          <label htmlFor="roll-name-template" className="text-sm font-medium">
            Top adı format şablonu
          </label>
          <p className="text-xs text-muted-foreground">
            Listelerde ve aramalarda gösterilen birleşik ürün adının düzeni. Token'lar:{" "}
            <code>{"{item}"}</code> <code>{"{color}"}</code> <code>{"{width}"}</code>{" "}
            <code>{"{quality}"}</code>. Boş alanlar (renksiz vb.) otomatik atlanır.
          </p>
          <input
            id="roll-name-template"
            type="text"
            value={template}
            maxLength={100}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder={DEFAULT_TEMPLATE}
            className="mt-2 flex h-9 w-full max-w-md rounded-md border border-input bg-background px-3 py-1 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {!tplValid && (
            <p className="mt-1 text-xs text-destructive">
              En az bir token içermeli ve 100 karakteri aşmamalı.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Önizleme: <span className="font-medium text-foreground">{tplPreview || "—"}</span>
          </p>
          <Button
            type="button"
            className="mt-2"
            disabled={!tplDirty || !tplValid || templateMut.isPending}
            onClick={() => templateMut.mutate({ rollNameTemplate: tplTrimmed })}
          >
            {templateMut.isPending ? "Kaydediliyor…" : "Şablonu Kaydet"}
          </Button>
        </div>

        {/* Faz-2: doğrudan yazıcıya gönderim (opt-in) */}
        <div className="border-t pt-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={nativeOn}
              disabled={nativeMut.isPending}
              onChange={(e) => nativeMut.mutate({ nativeSendEnabled: e.target.checked })}
            />
            <span>
              <span className="font-medium">Doğrudan yazıcıya gönder (native)</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Açıkken etiket komutları (PPLA/ZPL) backend'den yazıcıya doğrudan (TCP 9100)
                gönderilir — OS yazıcı diyaloğu çıkmaz. <strong>Kapalıyken (varsayılan)</strong>{" "}
                simüle edilir; fiziksel baskı HTML + OS sürücüyle yapılır. Açmadan önce makinelerin
                <em> Yazıcı IP</em>'si tanımlı olmalı (Tanımlar → Donanım) ve bir test baskısıyla
                doğrulanmalı.
              </span>
            </span>
          </label>
        </div>
      </div>
    </PermissionGate>
  );
}
