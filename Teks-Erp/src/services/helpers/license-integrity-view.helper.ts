// Lisans ayrıntısının `butunluk` bölümü (Faz 2e-S): çekirdek kaynağı, son denetim sonucu, imzalı paket
// künyesi ve sayılar. Salt-okunur; karar vermez, yalnız ekrana taşır.
import { msToIso } from "../../lib/license/protocol";
import { getLicenseCoreStatus } from "../../lib/license/native";
import { getIntegrityOutcome, integrityStatusForState } from "../../lib/license/integrity-state";
import type { LicenseSnapshot } from "../../lib/license/runtime";
import { BUILD_WATERMARK } from "../../lib/license/watermark";
import type { LicenseDetail } from "../license-view.service";

export function integritySection(snap: LicenseSnapshot): LicenseDetail["butunluk"] {
  const core = getLicenseCoreStatus();
  const o = getIntegrityOutcome();
  const r = o?.rapor ?? null;
  return {
    cekirdek: core.kaynak,
    cekirdekNeden: core.kaynak === "native" ? null : core.neden,
    zorunlu: core.zorunlu,
    durum: integrityStatusForState(),
    kod: o?.kod ?? null,
    denetlendi: o?.denetlendi ?? null,
    paketId: r?.paket?.paketId ?? BUILD_WATERMARK?.paketId ?? null,
    paketSurumu: r?.paket?.surum ?? null,
    derlemeTarihi: r?.paket?.derlemeTarihi ?? null,
    anahtar: o?.kid ?? null,
    sayilar: r
      ? { dosya: r.dosyaSayisi, eksik: r.eksikSayisi, degisik: r.degisikSayisi, fazla: Math.max(r.fazlaSayisi, o?.fazlaSayisi ?? 0), okunamayan: r.okunamayanSayisi }
      : null,
    ilkUyusmazlik: snap.integrityFirstMismatchMs === null ? null : msToIso(snap.integrityFirstMismatchMs),
    sertifika: o?.sertifika ? { kid: o.sertifika.kid, sertifikaId: o.sertifika.sertifikaId, bitis: o.sertifika.bitis, iptal: o.sertifika.iptal } : null,
    uyari: o?.uyari ?? null,
  };
}
