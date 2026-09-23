import { Prisma } from "@prisma/client";

/**
 * P2002 (unique violation) hatasının HANGİ constraint'ten geldiğini ayırt etme
 * yardımcıları. Prisma v6/v7 + @prisma/adapter-pg kombinasyonunda constraint adı
 * üç farklı meta kaynağında gelebilir (F61 deseni, workorder.service create'ten
 * çıkarıldı): `meta.target`, `meta.driverAdapterError.cause.constraint`,
 * `...cause.originalMessage`. Üçü birleştirilip regex ile test edilir.
 */
export function p2002Mentions(err: unknown, re: RegExp): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
    return false;
  }
  const meta = (err.meta ?? {}) as { driverAdapterError?: { cause?: { originalMessage?: unknown } } };
  const orig = meta.driverAdapterError?.cause?.originalMessage;
  return re.test(p2002MetaTargetParts(err.meta).join(" ") + (typeof orig === "string" ? orig : ""));
}

/**
 * P2002 hedefinin parçaları — `meta.target`i OKUYAN TEK YER (`test_p2002_hedef_tek_kaynak` ölçer).
 * ⚠️ pg sürücü adaptörü (Prisma 7) `meta.target` VERMEZ; hedef `meta.driverAdapterError.cause`
 * altında: `constraint.fields` (kolon adları), `constraint.index` ya da `originalMessage`taki kısıt
 * adı. Yalnız `target`e bakan yüklem adaptör altında HİÇ eşleşmez (ölçüldü 2026-09-23: çeki listesi
 * yarışı beş kez retry edilip 409'la bitti).
 * Sıra: `target` varsa yalnız o (v6 motoru); yoksa kolon adları, sonra kısıt adı.
 */
export function p2002MetaTargetParts(meta: unknown): string[] {
  const m = (meta ?? {}) as { target?: unknown; driverAdapterError?: { cause?: { constraint?: unknown; originalMessage?: unknown } } };
  if (Array.isArray(m.target)) return m.target.map(String);
  if (typeof m.target === "string" && m.target) return [m.target];
  const cause = m.driverAdapterError?.cause;
  const parts: string[] = [];
  const c = cause?.constraint as { fields?: unknown; index?: unknown } | string | undefined;
  if (typeof c === "string") parts.push(c);
  else if (c && Array.isArray(c.fields)) parts.push(...c.fields.map((f) => String(f).replace(/"/g, "")));
  else if (c && typeof c.index === "string") parts.push(c.index);
  const ad = typeof cause?.originalMessage === "string" ? /constraint "([^"]+)"/.exec(cause.originalMessage) : null;
  if (ad) parts.push(ad[1]!);
  return parts;
}

/**
 * Kullanıcı mesajı için TEK kolon: v6 `target` → ilk kolon; pg adaptörü → kısıt adından ("items_code_key"
 * → "code"; composite'te son kolon — mesaj haritası bugün buna göre), kısıt adı yoksa ilk kolon adı.
 */
export function p2002UniqueColumn(meta: unknown): string | null {
  const m = (meta ?? {}) as { target?: unknown };
  const parts = p2002MetaTargetParts(meta);
  if (Array.isArray(m.target) || typeof m.target === "string") return parts[0] ?? null;
  for (const raw of parts) {
    const k = raw.match(/_([a-zA-Z][a-zA-Z0-9]*)_key/);
    if (k) return k[1]!;
  }
  return parts.find((p) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(p)) ?? null;
}

/** P2002'nin hedef parçaları (P2002 değilse boş). */
export function p2002TargetParts(err: unknown): string[] {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return [];
  return p2002MetaTargetParts(err.meta);
}

/**
 * P2002 bu KOLONUN tekilliğinden mi? Kolon adı birebir (target / constraint.fields) ya da kısıt
 * adında `_<kolon>_` / `_<kolon>_key` olarak. Hedef bilinmiyorsa `false` (varsayım yok).
 */
export function p2002OnField(err: unknown, field: string): boolean {
  const f = field.toLowerCase();
  return p2002TargetParts(err).some((p) => {
    const q = p.toLowerCase();
    return q === f || q.includes(`_${f}_`) || q.endsWith(`_${f}_key`);
  });
}

/**
 * P2002 clientToken unique'inden mi geldi? (orders/work_orders/swatch_stock_reductions
 * — constraint adlarının tümü "clientToken" içerir.)
 *
 * withBarcodeRetry ile etkileşim kuralı: clientToken P2002'si RETRY EDİLMEZ —
 * retry her denemede aynı token'ı yazacağından 5 tur boşa döner ve yanıltıcı
 * "Barkod üretimi 5 denemede başarısız" hatası üretirdi. Predicate'lerde
 * `!isClientTokenP2002(err)` ile dışarı propagate edilir; dış catch cached
 * (idempotent retry) yanıtına çevirir.
 */
export function isClientTokenP2002(err: unknown): boolean {
  return p2002Mentions(err, /clientToken/i);
}
