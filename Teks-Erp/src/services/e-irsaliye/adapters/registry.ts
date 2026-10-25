// =============================================================================
// Bağdaştırıcı kayıt defteri — `constants/e-irsaliye.ts` `EIRSALIYE_ACTIVE_ADAPTERS`
// ile TEK KAYNAK: anahtar kümesi tipte o kümeye bağlı (eksik/fazla kod derlenmez),
// boot'ta da eşitlik ölçülür. Tanınmayan kod 400 (fail-closed).
// =============================================================================
import { EIRSALIYE_ACTIVE_ADAPTERS, type EIrsaliyeAdapter as AdapterCode } from "../../../constants/e-irsaliye";
import { AppError } from "../../../utils/app-error";
import type { EIrsaliyeAdapter } from "./adapter.types";
import { disaAktarAdapter } from "./disa-aktar.adapter";
import { simulasyonAdapter } from "./simulasyon.adapter";

type ActiveCode = Exclude<AdapterCode, "yok">;

const REGISTRY: Readonly<Record<ActiveCode, EIrsaliyeAdapter>> = {
  disaAktar: disaAktarAdapter,
  simulasyon: simulasyonAdapter,
};

// Sabit küme ile defter ayrışırsa hazırlık "HAZIR" der ama motor 400 verir — yüklemede düş.
const regKeys = Object.keys(REGISTRY).sort().join(",");
const setKeys = [...EIRSALIYE_ACTIVE_ADAPTERS].sort().join(",");
if (regKeys !== setKeys) throw new Error(`e-İrsaliye bağdaştırıcı defteri ayrıştı: ${regKeys} ≠ ${setKeys}`);

export function resolveAdapter(kod: string): EIrsaliyeAdapter {
  const a = (REGISTRY as Record<string, EIrsaliyeAdapter | undefined>)[kod];
  if (!a || !Object.prototype.hasOwnProperty.call(REGISTRY, kod)) {
    throw AppError.badRequest("e-İrsaliye gönderim yöntemi tanınmıyor.", { code: "EIRSALIYE_ADAPTER_UNKNOWN", adapter: kod });
  }
  return a;
}

export function isSimulationAdapter(kod: string): boolean {
  return kod === simulasyonAdapter.kod;
}
