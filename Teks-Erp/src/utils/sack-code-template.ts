// =============================================================================
// Çuval kodu şablonu — SACK_CODE_TEMPLATE ("sack.codeTemplate" ayarı)
// =============================================================================
// Operatör çuval açarken kod girmezse backend bu şablondan otomatik üretir
// (override her zaman serbest). Varsayılan "AMB{SIRA:5}" eski sabit AMB%05d
// davranışıyla birebir aynıdır.
//
// Token'lar:
//   {SIRA:N}    — sıra numarası, N hane zero-pad (3..6, ":N" yoksa 5). ZORUNLU
//                 ve şablonun SONUNDA olmalı — sabit-genişlik numerik kuyruk,
//                 collation-güvenli kapalı-aralık taramasının (gte/lte) önşartı.
//   {YYMMDD}    — üretim günü (yıl2+ay+gün). Kullanılırsa sıra her gün doğal
//                 olarak baştan başlar (prefix değişir).
//   {MUSTERI:N} — sevkiyat müşteri kodunun ilk N harfi (1..6, ":N" yoksa 3);
//                 A-Z0-9 dışı karakterler ayıklanır, müşteri kodu yoksa boş.
//
// Kısıtlar (etiket kapısı açık kalsın — kod bir gün BARKOD olarak basılabilir):
//   • Literal karakterler yalnız A-Z ve 0-9 — tire/boşluk/Türkçe karakter YOK
//     (el tarayıcı TR klavyede '-' → '*' bastığından taranan kodlar ayraçsız).
//   • Literal başlangıç tarayıcı sınıflandırıcısının rezerve prefix'leriyle
//     çakışamaz (TEKS=top, RK=refakat, SW=kartela, CV=çuval sackNo, SD/SR/KD/KR=
//     belge, SVK=sevk no) — yoksa okutulan çuval kodu yanlış türe sınıflanır.
// =============================================================================

import { AppError } from "./app-error";

export const DEFAULT_SACK_CODE_TEMPLATE = "AMB{SIRA:5}";
export const SACK_CODE_TEMPLATE_MAX_LEN = 40;

/** Tarayıcı sınıflandırıcısının prefix'leri (Electron barcode-kind.ts ile senkron). */
const RESERVED_PREFIXES = ["TEKS", "RK", "SW", "CV", "SD", "SR", "KD", "KR", "SVK"] as const;

const TOKEN_RE = /\{([A-Z]+)(?::(\d+))?\}/g;

interface TemplatePart {
  kind: "literal" | "SIRA" | "YYMMDD" | "MUSTERI";
  value: string; // literal metni; token'larda ham token
  n?: number;
}

function parse(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let idx = 0;
  for (const m of template.matchAll(TOKEN_RE)) {
    if (m.index > idx) parts.push({ kind: "literal", value: template.slice(idx, m.index) });
    const name = m[1]!;
    const n = m[2] ? parseInt(m[2], 10) : undefined;
    if (name !== "SIRA" && name !== "YYMMDD" && name !== "MUSTERI") {
      throw AppError.badRequest(
        `Bilinmeyen token: {${name}} — geçerli token'lar: {SIRA:N} {YYMMDD} {MUSTERI:N}`
      );
    }
    parts.push({ kind: name, value: m[0], n });
    idx = m.index + m[0].length;
  }
  if (idx < template.length) parts.push({ kind: "literal", value: template.slice(idx) });
  return parts;
}

/**
 * Şablonu doğrula ve kanonik (trim + uppercase) haline çevir. Geçersizse
 * Türkçe mesajlı AppError.badRequest fırlatır.
 */
export function normalizeSackCodeTemplate(raw: string): string {
  const template = raw.trim().toUpperCase();
  if (!template) return DEFAULT_SACK_CODE_TEMPLATE;
  if (template.length > SACK_CODE_TEMPLATE_MAX_LEN) {
    throw AppError.badRequest(
      `Çuval kodu şablonu en fazla ${SACK_CODE_TEMPLATE_MAX_LEN} karakter olabilir`
    );
  }
  // Süslü parantez dengesi kabaca: token regex'inin yakalamadığı '{'/'}' kalmamalı.
  const withoutTokens = template.replace(TOKEN_RE, "");
  if (/[{}]/.test(withoutTokens)) {
    throw AppError.badRequest("Şablonda hatalı token sözdizimi var — örnek: AMB{SIRA:5}");
  }

  const parts = parse(template);

  const siraParts = parts.filter((p) => p.kind === "SIRA");
  if (siraParts.length !== 1) {
    throw AppError.badRequest("Şablon tam olarak BİR {SIRA:N} token'ı içermeli — örnek: AMB{SIRA:5}");
  }
  if (parts[parts.length - 1]!.kind !== "SIRA") {
    throw AppError.badRequest(
      "{SIRA:N} şablonun SONUNDA olmalı (sıra numarası koddan sonra gelemez) — örnek: AMB{YYMMDD}{SIRA:3}"
    );
  }
  const siraN = siraParts[0]!.n ?? 5;
  if (siraN < 3 || siraN > 6) {
    throw AppError.badRequest("{SIRA:N} hane sayısı 3–6 aralığında olmalı");
  }
  for (const p of parts) {
    if (p.kind === "MUSTERI" && p.n !== undefined && (p.n < 1 || p.n > 6)) {
      throw AppError.badRequest("{MUSTERI:N} harf sayısı 1–6 aralığında olmalı");
    }
    if (p.kind === "YYMMDD" && p.n !== undefined) {
      throw AppError.badRequest("{YYMMDD} token'ı hane parametresi almaz");
    }
    if (p.kind === "literal" && !/^[A-Z0-9]*$/.test(p.value)) {
      throw AppError.badRequest(
        "Şablonda yalnız A-Z ve 0-9 kullanılabilir — tire/boşluk/Türkçe karakter etikette taranamaz"
      );
    }
  }

  const first = parts[0]!;
  if (first.kind === "literal") {
    const hit = RESERVED_PREFIXES.find((rp) => first.value.startsWith(rp));
    if (hit) {
      throw AppError.badRequest(
        `Şablon "${hit}" ile başlayamaz — bu önek barkod tarayıcıda başka bir türe ayrılmış (top/refakat/kartela/belge)`
      );
    }
  }

  return template;
}

/**
 * Şablonu bağlamla çöz: sıra numarası HARİÇ sabit prefix + hane sayısı döner.
 * Çağıran, prefix üstünde sabit-genişlik kapalı-aralık taramasıyla (gte
 * prefix+"0"*N, lte prefix+"9"*N) son numarayı bulup +1 üretir — glibc
 * collation'da güvenli tek desen (sentinel YASAK, bkz. shipping.service).
 */
export function resolveSackCodePrefix(
  template: string,
  ctx: { now: Date; customerCode?: string | null }
): { prefix: string; digits: number } {
  const parts = parse(template.trim().toUpperCase());
  let prefix = "";
  let digits = 5;
  for (const p of parts) {
    if (p.kind === "literal") prefix += p.value;
    else if (p.kind === "YYMMDD") {
      // shipping.service datePrefix ile aynı: sunucu yerel günü.
      prefix +=
        String(ctx.now.getFullYear()).slice(2) +
        String(ctx.now.getMonth() + 1).padStart(2, "0") +
        String(ctx.now.getDate()).padStart(2, "0");
    } else if (p.kind === "MUSTERI") {
      const n = p.n ?? 3;
      const clean = (ctx.customerCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      prefix += clean.slice(0, n); // müşteri kodu yoksa/kısaysa olduğu kadar
    } else {
      digits = p.n ?? 5; // SIRA — normalize() sonda olduğunu garantiler
    }
  }
  return { prefix, digits };
}
