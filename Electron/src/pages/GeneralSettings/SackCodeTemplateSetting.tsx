import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService } from "@/services/featureFlagService";
import { FieldLabel } from "./SettingRow";

const DEFAULT_TEMPLATE = "AMB{SIRA:5}";
const TOKEN_RE = /\{(SIRA|YYMMDD|MUSTERI)(?::(\d+))?\}/g;
/** Tarayıcı sınıflandırıcı prefix'leri (backend utils/sack-code-template ile senkron). */
const RESERVED_PREFIXES = ["TEKS", "RK", "SW", "CV", "SD", "SR", "KD", "KR", "SVK"];

/**
 * Hafif istemci-tarafı doğrulama + önizleme — TEK doğruluk kaynağı backend
 * (utils/sack-code-template.ts); bu yalnız anlık geri bildirim içindir.
 * Geçersizse Türkçe mesaj, geçerliyse null döner.
 */
function validateLight(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (!t) return null; // boş = varsayılana döner
  if (t.length > 40) return "En fazla 40 karakter olabilir.";
  const withoutTokens = t.replace(TOKEN_RE, "");
  if (/[{}]/.test(withoutTokens)) return "Hatalı token sözdizimi — örnek: AMB{SIRA:5}";
  if (!/^[A-Z0-9]*$/.test(withoutTokens))
    return "Yalnız A-Z ve 0-9 kullanılabilir (tire/boşluk/Türkçe karakter etikette taranamaz).";
  const siraMatches = [...t.matchAll(/\{SIRA(?::(\d+))?\}/g)];
  if (siraMatches.length !== 1) return "Tam olarak bir {SIRA:N} token'ı olmalı.";
  if (!/\{SIRA(?::\d+)?\}$/.test(t)) return "{SIRA:N} şablonun sonunda olmalı.";
  const n = siraMatches[0]![1] ? parseInt(siraMatches[0]![1]!, 10) : 5;
  if (n < 3 || n > 6) return "{SIRA:N} hane sayısı 3–6 aralığında olmalı.";
  const hit = RESERVED_PREFIXES.find((rp) => t.startsWith(rp));
  if (hit) return `"${hit}" ile başlayamaz — bu önek barkod tarayıcıda başka türe ayrılmış.`;
  return null;
}

/** Örnek üretim önizlemesi: bugünün tarihi, "ACME01" müşteri kodu, sıra 1. */
function preview(raw: string): string {
  const t = (raw.trim().toUpperCase() || DEFAULT_TEMPLATE).replace(
    TOKEN_RE,
    (_m, name: string, nRaw?: string) => {
      if (name === "SIRA") return "1".padStart(nRaw ? parseInt(nRaw, 10) : 5, "0");
      if (name === "YYMMDD") {
        const d = new Date();
        return (
          String(d.getFullYear()).slice(2) +
          String(d.getMonth() + 1).padStart(2, "0") +
          String(d.getDate()).padStart(2, "0")
        );
      }
      return "ACME01".slice(0, nRaw ? parseInt(nRaw, 10) : 3); // MUSTERI
    },
  );
  return t;
}

/**
 * Çuval kodu otomatik üretim şablonu (SACK_CODE_TEMPLATE). Operatör çuval
 * açarken kod girmezse backend bu şablondan üretir; operatör her zaman
 * override edebilir. Varsayılan AMB00001 düzenidir (eski davranışla birebir).
 */
export function SackCodeTemplateSetting() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const current = flagsQ.data?.data?.sackCodeTemplate?.trim() || DEFAULT_TEMPLATE;

  const [template, setTemplate] = useState(current);
  useEffect(() => {
    setTemplate(current);
  }, [current]);

  const mut = useMutation({
    mutationFn: (payload: { sackCodeTemplate: string }) => featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Çuval kodu şablonu kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const trimmed = template.trim().toUpperCase();
  const error = useMemo(() => validateLight(template), [template]);
  const dirty = (trimmed || DEFAULT_TEMPLATE) !== current;

  return (
    <PermissionGate
      permission="admin:settings"
      fallback={
        <p className="text-sm">
          Çuval kodu şablonu: <span className="rounded-md border px-2 py-0.5 font-mono text-xs">{current}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            (değiştirmek için <code>admin:settings</code> gerekir)
          </span>
        </p>
      }
    >
      <div>
        <FieldLabel
          htmlFor="sack-code-template"
          label="Çuval kodu şablonu (otomatik isimlendirme)"
          desc={
            <>
              Operatör çuval açarken kod girmezse sistem bu şablondan üretir; operatör kodu her
              zaman değiştirebilir. Token'lar: <code>{"{SIRA:N}"}</code> (sıra numarası — zorunlu,
              sonda), <code>{"{YYMMDD}"}</code> (tarih — kullanılırsa sıra her gün 1'den başlar),{" "}
              <code>{"{MUSTERI:N}"}</code> (müşteri kodunun ilk N harfi). Yalnız A-Z ve 0-9 —
              ileride çuval etiketi basılırsa kod barkod olarak taranabilir kalır.
            </>
          }
        />
        <input
          id="sack-code-template"
          type="text"
          value={template}
          maxLength={40}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder={DEFAULT_TEMPLATE}
          className="mt-2 flex h-9 w-full max-w-md rounded-md border border-input bg-background px-3 py-1 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          Örnek: <span className="font-mono font-medium text-foreground">{preview(template)}</span>
          <span className="ml-2">(boş bırak = varsayılan {DEFAULT_TEMPLATE})</span>
        </p>
        <Button
          type="button"
          className="mt-2"
          disabled={!dirty || !!error || mut.isPending}
          onClick={() => mut.mutate({ sackCodeTemplate: trimmed || DEFAULT_TEMPLATE })}
        >
          {mut.isPending ? "Kaydediliyor…" : "Şablonu Kaydet"}
        </Button>
      </div>
    </PermissionGate>
  );
}
