// GEÇİCİ AÇILIŞ KODU — iki uygulamanın ortak parçası: fabrikanın istek kodu girişi (TI-…), gün aralığı ve üretilen kodun
// (TG-… 23 grup) kopyalanabilir gösterimi. Biçim denetimi yalnız yazım yardımıdır; sağlamayı ve imzayı sunucu denetler.
// Sabitler sunucu protokolünün aynasıdır (satici/sunucu src/lisans-protokol/gecici-kod.ts; bekçi mirrors.test.ts).
import { useState } from "react";
import type { TempCodeRequest } from "./types";
import { Button } from "./ui";

export const TEMP_CODE_DAYS = { varsayilan: 30, enAz: 7, enCok: 90 } as const;
export const TEMP_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TEMP_REQUEST_PREFIX = "TI";
export const TEMP_REQUEST_LENGTH = 24;
const REQUEST_GROUP = 4;

export const TEMP_REQUEST_STATUS_LABEL: Record<TempCodeRequest["durum"], string> = { BEKLIYOR: "Bekliyor", URETILDI: "Üretildi", REDDEDILDI: "Reddedildi" };

/** Sunucunun `normalizeTempText` aynası: ön ek, tire, boşluk atılır; büyük harf; O→0, I/L→1. */
export function normalizeRequestCode(raw: string): string {
  let t = raw.toUpperCase().replace(/[\s\-_.]/g, "");
  if (t.startsWith(TEMP_REQUEST_PREFIX)) t = t.slice(TEMP_REQUEST_PREFIX.length);
  return t.replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Yazılanı `TI-XXXX-…` gruplarına böler (yapıştırılan biçimsiz metin de). */
export function formatRequestCode(raw: string): string {
  const t = normalizeRequestCode(raw).slice(0, TEMP_REQUEST_LENGTH + 4);
  const groups = t.match(new RegExp(`.{1,${REQUEST_GROUP}}`, "g")) ?? [];
  return groups.length ? [TEMP_REQUEST_PREFIX, ...groups].join("-") : "";
}

/** Boşsa null; biçim hatasında Türkçe ileti; geçerliyse tiresiz gövde. */
export function checkRequestCode(raw: string): { readonly ok: true; readonly body: string } | { readonly ok: false; readonly message: string | null } {
  const t = normalizeRequestCode(raw);
  if (!t) return { ok: false, message: null };
  for (let i = 0; i < t.length; i++) {
    if (!TEMP_ALPHABET.includes(t[i]!)) return { ok: false, message: `${Math.floor(i / REQUEST_GROUP) + 1}. grupta geçersiz karakter: “${t[i]}”` };
  }
  if (t.length !== TEMP_REQUEST_LENGTH) return { ok: false, message: `İstek kodu ${TEMP_REQUEST_LENGTH} karakter (6 grup × 4) olmalı; ${t.length} karakter yazıldı.` };
  return { ok: true, body: t };
}

export function daysValid(days: number): boolean {
  return Number.isInteger(days) && days >= TEMP_CODE_DAYS.enAz && days <= TEMP_CODE_DAYS.enCok;
}

/** İstek kodu alanı: yazarken/yapıştırırken gruplar; hata altında yazılır. */
export function RequestCodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const check = checkRequestCode(value);
  return (
    <label className="field">
      <span className="field-label">İstek kodu (fabrikanın lisans ekranından)</span>
      <input
        value={value}
        aria-label="İstek kodu"
        autoComplete="off"
        spellCheck={false}
        placeholder="TI-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        onChange={(e) => onChange(formatRequestCode(e.target.value))}
      />
      {!check.ok && check.message ? <span className="error small">{check.message}</span> : <span className="field-hint">Telefonda okunurken O/0 ve I/1 karışması düzeltilir.</span>}
    </label>
  );
}

export function DaysInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="field-label">Geçerlilik (gün)</span>
      <input type="number" aria-label="Gün" min={TEMP_CODE_DAYS.enAz} max={TEMP_CODE_DAYS.enCok} value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="field-hint">
        {TEMP_CODE_DAYS.enAz}–{TEMP_CODE_DAYS.enCok} gün; süre bitince fabrika uyarı ve ek süreye düşer, tam etkinleştirme ayrıca gerekir.
      </span>
    </label>
  );
}

/** Üretilen açılış kodu: gruplar satır satır, tek tıkla panoya. */
export function TempCodeView({ code }: { code: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const groups = code.split("-");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div>
      <p className="secret temp-code" data-testid="temp-code">
        {groups.map((g, i) => (
          <code key={i}>{g}</code>
        ))}
      </p>
      <Button onClick={() => void copy()}>Kopyala</Button>
      {copied === true ? <span className="muted small"> Panoya kopyalandı.</span> : null}
      {copied === false ? <span className="error small"> Tarayıcı panoya yazamadı: kodu seçip elle kopyalayın.</span> : null}
    </div>
  );
}
