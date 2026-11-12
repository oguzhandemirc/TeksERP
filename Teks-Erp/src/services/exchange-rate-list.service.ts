import type { Request } from "express";
import type { Currency, ExchangeRateSource } from "@prisma/client";
import { BaseService } from "./base.service";
import { matchingEnumValues, readListSearch } from "../utils/list-search";

/** Kur listesinde metin kolonu yok: arama para birimi kodu/adı ve kaynak etiketiyle eşleşir (ekranda görünenler). */
const CURRENCY_LABELS: Record<Currency, readonly string[]> = {
  TRY: ["TL", "Türk lirası"],
  USD: ["Dolar"],
  EUR: ["Euro", "Avro"],
  GBP: ["Sterlin"],
  RUB: ["Ruble"],
};
const SOURCE_LABELS: Record<ExchangeRateSource, readonly string[]> = {
  MANUAL: ["Elle girildi"],
  TCMB: ["TCMB"],
};

/** `?search=` → `currency IN … OR source IN …`; eşleşen değer yoksa boş küme (sonuç yok). */
export function exchangeRateSearchWhere(search: string | undefined): Record<string, unknown> | undefined {
  if (!search) return undefined;
  const currencies = matchingEnumValues(search, CURRENCY_LABELS);
  const sources = matchingEnumValues(search, SOURCE_LABELS);
  return { OR: [{ currency: { in: currencies } }, { source: { in: sources } }] };
}

/** Kur listesi — BaseService + enum araması (liste ve sayaç `buildListWhere`ten, aynı where). */
export class ExchangeRateListService extends BaseService {
  protected override extraWhere(req: Request): Record<string, unknown> | undefined {
    return exchangeRateSearchWhere(readListSearch(req.query.search));
  }
}
