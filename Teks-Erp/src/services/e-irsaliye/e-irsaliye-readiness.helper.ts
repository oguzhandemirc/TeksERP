// =============================================================================
// e-İrsaliye HAZIRLIK — "özellik kullanılabilir mi?" sorusunun TEK cevabı (E3-AYAR)
// =============================================================================
// Modül anahtarı yok (plan §0.3 P1): özellik dört koşul sağlanınca HAZIR olur —
// künye geçerli · `eIrsaliye` serisi GİB biçiminde · bağdaştırıcı tanınıyor · yürürlük
// tarihi dolu. Her e-İrsaliye yazma ucu (E5) ve panel rozeti BU fonksiyonu sorar;
// YAPILANDIRILMAMIS'ta uç 409 `EIRSALIYE_NOT_CONFIGURED`. İkinci bir hazırlık yüklemi
// yazmak yasak — `test_e_irsaliye_readiness` §AST tarar.
// ⚠ doğrulanacak (V1): gönderici vergi dairesinin zorunluluğu GİB kılavuzuyla teyit edilmedi;
//   eksik vergi dairesi GİB'de reddedilen belge riski olduğu için burada zorunlu sayılır.
// =============================================================================
import type { PrismaClient } from "@prisma/client";
import prisma from "../../lib/prisma";
import { EIRSALIYE_ACTIVE_ADAPTERS } from "../../constants/e-irsaliye";
import { settingScreenPath } from "../../constants/panel-ayar-yolu";
import { ekranYolu } from "../../constants/panel-ekran-yolu";
import { assertFixedShapeFormat } from "../helpers/series-fixed-shape.helper";
import { readCompanyLegalIdentity, readEIrsaliyeConfig } from "../system-setting.service";
import { E_IRSALIYE_SERIES_KEY } from "./e-irsaliye-number";
import type { CompanyLegalIdentity } from "./e-irsaliye-settings";
import { isValidTckn, isValidVkn } from "./tax-id";

export type EIrsaliyeReadinessState = "YAPILANDIRILMAMIS" | "HAZIR";

export interface EIrsaliyeReadiness {
  durum: EIrsaliyeReadinessState;
  /** Kullanıcıya dönük, yol tarifli Türkçe cümleler; HAZIR'da boş. */
  eksikler: string[];
}

type ReadinessDb = Pick<PrismaClient, "systemSetting" | "numberSeries">;

/** Künyede eksik/bozuk alanların okunur adları (sırası formdaki sırayla aynı). */
export function legalIdentityGaps(k: CompanyLegalIdentity): string[] {
  const gaps: string[] = [];
  const idOk = k.kimlikTuru === "TCKN" ? isValidTckn(k.kimlikNo) : isValidVkn(k.kimlikNo);
  if (!idOk) gaps.push(k.kimlikNo ? `${k.kimlikTuru} geçersiz (sağlama tutmuyor)` : `${k.kimlikTuru} boş`);
  if (!k.unvan) gaps.push("unvan");
  if (k.kimlikTuru === "TCKN" && (!k.kisiAd || !k.kisiSoyad)) gaps.push("kişi adı/soyadı (TCKN'li gönderici)");
  if (!k.vergiDairesi) gaps.push("vergi dairesi");
  if (!k.il) gaps.push("il");
  if (!k.ilce) gaps.push("ilçe");
  if (!k.ulke) gaps.push("ülke");
  return gaps;
}

async function seriesGap(db: ReadinessDb): Promise<string | null> {
  const row = await db.numberSeries.findUnique({
    where: { key: E_IRSALIYE_SERIES_KEY },
    select: { prefix: true, dateSegment: true, digits: true, separator: true, separator2: true },
  });
  const where = ekranYolu("numaralandirma");
  if (!row) return `e-İrsaliye numara serisi tanımlı değil — ${where} ekranında "e-İrsaliye" serisi oluşturulmalı.`;
  try {
    assertFixedShapeFormat(E_IRSALIYE_SERIES_KEY, row);
    return null;
  } catch {
    return `e-İrsaliye numara serisi GİB biçiminde değil (3 harf/rakam + yıl + 9 hane) — ${where} ekranından düzeltin.`;
  }
}

/** Tek hazırlık sorusu. `db` verilmezse kök istemci; tx içinden çağıran kendi tx'ini geçer. */
export async function resolveEIrsaliyeReadiness(db: ReadinessDb = prisma): Promise<EIrsaliyeReadiness> {
  const eksikler: string[] = [];
  const [kunye, cfg] = [await readCompanyLegalIdentity(db), await readEIrsaliyeConfig(db)];

  const gaps = legalIdentityGaps(kunye);
  if (gaps.length > 0) {
    eksikler.push(`Firma resmi künyesi eksik: ${gaps.join(", ")} — ${settingScreenPath("company")} ekranında "Resmi künye" bölümünden girin.`);
  }
  const series = await seriesGap(db);
  if (series) eksikler.push(series);
  if (!EIRSALIYE_ACTIVE_ADAPTERS.has(cfg.adapter)) {
    eksikler.push(`e-İrsaliye gönderim yöntemi seçilmemiş — ${settingScreenPath("e-irsaliye")} ekranında "Dışa aktar" ya da "Simülasyon" seçin.`);
  }
  if (!cfg.yururlukTarihi) {
    eksikler.push(`e-İrsaliye yürürlük tarihi girilmemiş — ${settingScreenPath("e-irsaliye")} ekranından girin.`);
  }
  return { durum: eksikler.length === 0 ? "HAZIR" : "YAPILANDIRILMAMIS", eksikler };
}
