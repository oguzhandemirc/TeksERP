// =============================================================================
// Zod global locale — Türkçe varsayılan hata mesajları
// =============================================================================
// Zod 4 ile gelen `tr` locale'ini global config'e bağlar. Tüm Zod hata
// mesajları (`Invalid input: expected string, received undefined` → "geçersiz
// giriş: string bekleniyordu, undefined alındı" gibi) otomatik Türkçeleşir.
//
// Side-effect import: server.ts / app.ts'in EN ÜST satırında çağrılmalı,
// herhangi bir Zod schema instantiate edilmeden önce.
//
// Alan-bazlı override hala mümkün:
//   z.string({ message: "Ürün kodu zorunlu" })
// Bu, locale default'unu özel bir mesajla değiştirir.
// =============================================================================

import { config } from "zod";
import { tr } from "zod/v4/locales";

config({ localeError: tr().localeError });
