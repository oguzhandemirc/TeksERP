// =============================================================================
// ÇEK OLAYI → KASA/BANKA ETKİSİ — bakiyenin ÜÇÜNCÜ YAZARININ tek kaynağı
// =============================================================================
// Kasa/banka bakiyesini Payment · CashTransaction · ChequeEvent birlikte yazar.
// Çek dalını okuyan her yüzey (kasa defteri raporu, kasa dönem kapanışı,
// mutabakat bekçileri) hangi olayın para oynattığını BURADAN alır; elle yazılmış
// `e.type IN (...)` kopyası yeni storno geldiğinde sessiz drift üretir.
// =============================================================================
import { ChequeEventType } from "@prisma/client";

type CashEffect = { sign: -1 | 0 | 1; reversal: boolean };

/**
 * Tam `Record` bilinçli: enum'a değer eklenince derleme bu tabloda karar ister.
 * DEPOSIT 0'dır — tahsile verilen çek henüz para değildir.
 */
export const CHEQUE_EVENT_CASH_EFFECT = {
  RECEIVE: { sign: 0, reversal: false },
  ISSUE: { sign: 0, reversal: false },
  DEPOSIT: { sign: 0, reversal: false },
  COLLECT: { sign: 1, reversal: false },
  ENDORSE: { sign: 0, reversal: false },
  BOUNCE: { sign: 0, reversal: false },
  RETURN: { sign: 0, reversal: false },
  PAY: { sign: -1, reversal: false },
  CANCEL: { sign: 0, reversal: false },
  COLLECT_CANCEL: { sign: -1, reversal: true },
  ENDORSE_CANCEL: { sign: 0, reversal: true },
  BOUNCE_CANCEL: { sign: 0, reversal: true },
  RETURN_CANCEL: { sign: 0, reversal: true },
  PAY_CANCEL: { sign: 1, reversal: true },
} as const satisfies Record<ChequeEventType, CashEffect>;

const ALL_TYPES = Object.keys(CHEQUE_EVENT_CASH_EFFECT) as ChequeEventType[];

export const CHEQUE_CASH_EVENT_TYPES: readonly ChequeEventType[] = ALL_TYPES.filter(
  (t) => CHEQUE_EVENT_CASH_EFFECT[t].sign !== 0,
);

/** SQL listesi — değerler enum adıdır; yine de biçim doğrulanır (ham metne girer). */
function sqlList(types: readonly ChequeEventType[]): string {
  for (const t of types) {
    if (!/^[A-Z_]+$/.test(t)) throw new Error(`Beklenmeyen çek olay tipi: ${t}`);
  }
  return types.map((t) => `'${t}'`).join(", ");
}

function sqlAlias(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error(`Geçersiz SQL takma adı: ${alias}`);
  return alias;
}

/** `'COLLECT', 'PAY', …` — para oynatan olay tipleri. */
export function chequeCashEventTypesSql(): string {
  return sqlList(CHEQUE_CASH_EVENT_TYPES);
}

/** Olayın para GİRİŞİ mi (true) — `CASE WHEN <bu> THEN +amount ELSE -amount END`. */
export function chequeCashInflowSql(eventAlias: string): string {
  const inflow = CHEQUE_CASH_EVENT_TYPES.filter((t) => CHEQUE_EVENT_CASH_EFFECT[t].sign === 1);
  return `${sqlAlias(eventAlias)}.type IN (${sqlList(inflow)})`;
}

/** Para oynatan olaylardan storno olanlar — kasa defterinde iptal işareti. */
export function chequeCashReversalSql(eventAlias: string): string {
  const reversals = CHEQUE_CASH_EVENT_TYPES.filter((t) => CHEQUE_EVENT_CASH_EFFECT[t].reversal);
  return `${sqlAlias(eventAlias)}.type IN (${sqlList(reversals)})`;
}
