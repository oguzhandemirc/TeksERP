// =============================================================================
// DESEN KARTI KAPILARI — tahar türü (K1) + firma mekanizma ayarı (K10), 2026-11-25
// =============================================================================
// `weave-design.service` yazım yolunun iki ek kapısı (servis dosyası boyut tavanında olduğu için ayrı).
// Mekanizma kapısı yalnız YENİ seçimi ölçer: kayıtlı mekanizmayı olduğu gibi bırakan güncelleme serbesttir
// (kapatılan mekanizmalı eski kart okunur ve düzenlenir, sessizce değişmez).
// =============================================================================
import { AppError } from "../../utils/app-error";
import { SHED_MECHANISM_LABEL, type WeaveShedMechanismValue } from "../../constants/weave-classification";
import { mechanismUsesFrames, WEAVE_DRAWING_IN_TYPES, type WeaveDrawingInTypeValue } from "../../constants/weave-drawing-in";
import { readEnabledShedMechanisms } from "../system-setting/weave-settings";
import { settingScreenPath } from "../../constants/panel-ayar-yolu";

/** Tahar türü: undefined = dokunma, null = bilinmiyor; liste dışı 400. */
export function parseDrawingInType(raw: unknown): WeaveDrawingInTypeValue | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (!(WEAVE_DRAWING_IN_TYPES as readonly unknown[]).includes(raw)) {
    throw AppError.badRequest("Tahar türü Düz/Sivri/Atlamalı/Özel (STRAIGHT/POINTED/SKIP/CUSTOM) ya da boş olmalı.", { code: "WEAVE_DESIGN_DRAWING_IN_INVALID" });
  }
  return raw as WeaveDrawingInTypeValue;
}

/** Tahar türü yalnız çerçeveli mekanizmada (Eksantrik/Armür) yazılır; Jakar'da çerçeve yok → 400 (saklı değer silinmez). */
export function assertDrawingInMechanism(type: WeaveDrawingInTypeValue | null | undefined, mechanism: WeaveShedMechanismValue): void {
  if (type != null && !mechanismUsesFrames(mechanism)) {
    throw AppError.badRequest("Tahar türü yalnız Eksantrik ya da Armür mekanizmalı desende seçilir.", { code: "WEAVE_DESIGN_DRAWING_IN_FRAMES_ONLY" });
  }
}

/**
 * Firma ayarında kapalı mekanizma YENİ seçimde 400 (`WEAVE_DESIGN_MECHANISM_DISABLED`). `before` = kayıtlı
 * mekanizma (yeni kartta null); aynı değeri taşıyan güncelleme ayara bakılmadan geçer.
 */
export async function assertMechanismEnabled(next: WeaveShedMechanismValue | undefined, before: WeaveShedMechanismValue | null): Promise<void> {
  if (!next || next === before) return;
  const enabled = await readEnabledShedMechanisms();
  if (!enabled.has(next)) {
    throw AppError.badRequest(
      `${SHED_MECHANISM_LABEL[next]} mekanizması bu firmada kullanılmıyor; ${settingScreenPath("dokuma")} altından açılabilir.`,
      { code: "WEAVE_DESIGN_MECHANISM_DISABLED", mechanism: next },
    );
  }
}
