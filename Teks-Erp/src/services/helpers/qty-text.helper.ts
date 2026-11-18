// Kullanıcıya dönen uyarı/hata/mesaj METNİNDEKİ ölçü sayılarının (kg, metre, yüzde) tek biçimi:
// ondalık virgül, ayırıcısız, sondaki sıfır atılır ("25000,5 kg") — `genel.md` sayı kuralı,
// sunucuda `anlati/sayi-bicim`. Devere ve dokuma (levent) aynı kaynağı kullanır.
// Yalnız insan metni içindir; DTO ve `details` alanları kendi makine biçiminde kalır.
import type { Prisma } from "@prisma/client";
import { sayiMetni } from "../reports/anlati/sayi-bicim";

/** kg / metre: en çok 3 hane ("12,345", "25000,5", "40"); kaba gösterimde `max` daraltılır. */
export const qtyText = (v: Prisma.Decimal.Value, max = 3): string => sayiMetni(Number(v), max);

/** Yüzde değeri (işaretsiz gövde): en çok 2 hane ("3,25", "5"); `%` çağıranın metnindedir; `max` daraltır. */
export const pctText = (v: Prisma.Decimal.Value, max = 2): string => sayiMetni(Number(v), max);
