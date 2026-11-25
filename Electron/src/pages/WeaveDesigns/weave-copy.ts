// Desen kartını kopyala (Seyitoğlu, 2026-11-25): yeni kart TEK `POST /api/weave-designs` ile doğar
// (ızgara + döner çerçeveler aynı istekte; yarım kopya kalmaz). Kopya etkin görünümü izler: Armür dışında
// saklı ızgara, Jakar dışında kanca/rapor eni taşınmaz. Tezgâh dosya adı boş başlar; görsel ve kumaşlar gelmez.
import type { WeaveDesign, WeaveDesignInput } from "./types";
import { resolveWeaveClass } from "./weave-class";

const decimalText = (v: string | number | null | undefined): string | null => (v == null || v === "" ? null : String(v));

export function buildCopyPayload(src: WeaveDesign, ids: { code: string; name: string }): WeaveDesignInput {
  const cls = resolveWeaveClass(src);
  const isJacquard = cls.shedMechanism === "JACQUARD";
  const body: WeaveDesignInput = {
    code: ids.code.trim(),
    name: ids.name.trim(),
    shedMechanism: cls.shedMechanism,
    weaveStructure: cls.weaveStructure,
    familyLabel: src.familyLabel,
    frameCount: src.frameCount,
    repeatCm: decimalText(src.repeatCm),
    lenoSetup: src.lenoSetup,
    lenoFrames: [...(src.lenoFrames ?? [])],
    drawingInNote: src.drawingInNote ?? null,
    notes: src.notes,
  };
  if (isJacquard) {
    body.hookCount = src.hookCount ?? null;
    body.repeatWidthCm = decimalText(src.repeatWidthCm);
  }
  if (cls.shedMechanism === "DOBBY" && src.liftPlan && src.liftPlan.length > 0) body.liftPlan = src.liftPlan.map((row) => [...row]);
  // Kenar çerçeveleri yalnız Armür'de anlamlı (sunucu başka mekanizmada 400 verir); eski sunucu alanı göndermez.
  if (cls.shedMechanism === "DOBBY" && src.selvedgeFrames && src.selvedgeFrames.length > 0) body.selvedgeFrames = [...src.selvedgeFrames];
  return body;
}
