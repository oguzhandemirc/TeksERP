// Gelen belge → iş emri tek formu (Gülkesim K30; tek yazar `PUT /api/gelen-belge/ayarlar`): okunan desen/renk yazısının
//   ele alınışı + tablet iş emri girişi + tanıtılan belgeye güven (K30-B). Hüküm sunucuda; eski backend alanı göndermez → alan çizilmez, gövdeye girmez.
import { useState } from "react";
import { TERIM } from "@/lib/terim";
import { FieldLabel } from "./SettingRow";
import { EnumRadioOptions } from "./EnumRadioOptions";
import type { IncomingDocumentSettings } from "@/pages/Operations/GelenBelgeler/types";
import type { DesenRenkEslesmeMode, TabletIeGirisiMode, TanitimGuveniMode } from "@/pages/Operations/GelenBelgeler/ieFormTypes";

export const desenRenkEslesmeOptions = (): ReadonlyArray<{ value: DesenRenkEslesmeMode; label: string; hint: string }> => [
  { value: "KAPALI", label: "Kullanma", hint: `Belgeden okunan desen ve renk yazısı ${TERIM.terbiyeIsEmri.tekilKucuk} formuna taşınmaz (bugünkü davranış).` },
  { value: "ONER", label: "Kayıt öner", hint: "Adı ya da kodu birebir tutan kumaş ve renk kaydı formda önerilir; görevli kontrol edip onaylar. Tutan kayıt yoksa alan boş kalır." },
  { value: "NOT", label: "Nota ekle", hint: `Okunan desen ve renk yazısı ${TERIM.terbiyeIsEmri.tekilKucuk} notunun sonuna eklenir; kumaş ve renk elle seçilir.` },
];

export const tabletIeGirisiOptions = (): ReadonlyArray<{ value: TabletIeGirisiMode; label: string; hint: string }> => [
  { value: "IKISI", label: "Belge ve top okutma", hint: `Tablette ${TERIM.terbiyeIsEmri.tekilKucuk} hem belge okutarak hem top okutarak açılır (bugünkü davranış).` },
  { value: "BELGE", label: "Yalnız belge okutma", hint: `Fason çalışan fabrika için: ${TERIM.terbiyeIsEmri.tekilKucuk} yalnız gelen belge okutularak açılır; top okutma gizlenir.` },
  { value: "TOP", label: "Yalnız top okutma", hint: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} yalnız top okutularak açılır; belge okutma gizlenir.` },
];

export const TANITIM_GUVENI_OPTIONS: ReadonlyArray<{ value: TanitimGuveniMode; label: string; hint: string }> = [
  { value: "SOR", label: "Okunanları onaylat (bugünkü)", hint: "Belgeden okunan müşteri, parti no ve kurşun metresi öneri olarak gelir; görevli seçer ya da doğrular." },
  { value: "SORMA", label: "Tanıtılan belgeyi sormadan doldur", hint: "Daha önce tanıtılmış belgede okunan müşteri, parti no ve kurşun metresi forma doğrudan yazılır. Tanıtılmamış belgede tahmin yapılmaz; alanlar boş gelir." },
];

/** Taslak; sunucu alanı yoksa (eski backend) gövdeye girmez. */
export function useIeFormDraft(server: IncomingDocumentSettings | undefined) {
  const serverDesen = server?.desenRenkEslesme;
  const serverGiris = server?.tabletIeGirisi;
  const [desen, setDesen] = useState<DesenRenkEslesmeMode | undefined>(serverDesen);
  const [giris, setGiris] = useState<TabletIeGirisiMode | undefined>(serverGiris);
  const serverGuven = server?.tanitimGuveni;
  const [guven, setGuven] = useState<TanitimGuveniMode | undefined>(serverGuven);
  const guvenDirty = serverGuven !== undefined && guven !== undefined && guven !== serverGuven;
  const desenDirty = serverDesen !== undefined && desen !== undefined && desen !== serverDesen;
  const girisDirty = serverGiris !== undefined && giris !== undefined && giris !== serverGiris;
  return {
    serverDesen, serverGiris, serverGuven, desen, giris, guven, setDesen, setGiris, setGuven,
    desenFallback: server?.defaultDesenRenkEslesme, girisFallback: server?.defaultTabletIeGirisi, guvenFallback: server?.defaultTanitimGuveni,
    dirty: desenDirty || girisDirty || guvenDirty,
    body: {
      ...(desenDirty ? { desenRenkEslesme: desen } : {}), ...(girisDirty ? { tabletIeGirisi: giris } : {}),
      ...(guvenDirty ? { tanitimGuveni: guven } : {}),
    },
    reset: () => { setDesen(serverDesen); setGiris(serverGiris); setGuven(serverGuven); },
  };
}

export function IeFormFields({ draft }: { draft: ReturnType<typeof useIeFormDraft> }) {
  return (
    <>
      {draft.serverDesen !== undefined && (
        <div data-testid="gb-desen-renk-eslesme">
          <FieldLabel
            htmlFor="gb-desen-renk-eslesme-radios"
            label="Belgedeki desen ve renk yazısı"
            desc={`${TERIM.terbiyeIsEmri.cumleBasi.yalin} formunda belge okutulunca, belgede okunan desen (kumaş) ve renk yazısıyla ne yapılsın. Öneri yalnız adı ya da kodu birebir tutan kayıtta gelir; işi yavaşlatmaz.`}
          />
          <div id="gb-desen-renk-eslesme-radios" className="mt-2">
            <EnumRadioOptions name="Belgedeki desen ve renk yazısı" value={draft.desen ?? "KAPALI"} options={desenRenkEslesmeOptions()} onChange={(v) => draft.setDesen(v as DesenRenkEslesmeMode)} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {desenRenkEslesmeOptions().find((o) => o.value === (draft.desenFallback ?? "KAPALI"))?.label}</p>
        </div>
      )}
      {draft.serverGiris !== undefined && (
        <div data-testid="gb-tablet-ie-girisi">
          <FieldLabel
            htmlFor="gb-tablet-ie-girisi-radios"
            label={`Tablette ${TERIM.terbiyeIsEmri.tekilKucuk} girişi`}
            desc={`Tabletteki ${TERIM.terbiyeIsEmri.tekilKucuk} formunda hangi okutma yolları açık olsun. Fason çalışan fabrikada yalnız belge okutma seçilir.`}
          />
          <div id="gb-tablet-ie-girisi-radios" className="mt-2">
            <EnumRadioOptions name={`Tablette ${TERIM.terbiyeIsEmri.tekilKucuk} girişi`} value={draft.giris ?? "IKISI"} options={tabletIeGirisiOptions()} onChange={(v) => draft.setGiris(v as TabletIeGirisiMode)} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {tabletIeGirisiOptions().find((o) => o.value === (draft.girisFallback ?? "IKISI"))?.label}</p>
        </div>
      )}
      {draft.serverGuven !== undefined && (
        <div data-testid="gb-tanitim-guveni">
          <FieldLabel
            htmlFor="gb-tanitim-guveni-radios"
            label="Tanıtılan belgeye güven"
            desc="Belge şablonu bir kez elle tanıtıldıktan sonra, aynı belge okutulunca okunan değerler onaylatılsın mı yoksa forma doğrudan mı yazılsın."
          />
          <div id="gb-tanitim-guveni-radios" className="mt-2">
            <EnumRadioOptions name="Tanıtılan belgeye güven" value={draft.guven ?? "SOR"} options={TANITIM_GUVENI_OPTIONS} onChange={(v) => draft.setGuven(v as TanitimGuveniMode)} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {TANITIM_GUVENI_OPTIONS.find((o) => o.value === (draft.guvenFallback ?? "SOR"))?.label}</p>
        </div>
      )}
    </>
  );
}
