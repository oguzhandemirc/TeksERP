// Gelen belge → iş emri tek formu (Gülkesim K30; tek yazar `PUT /api/gelen-belge/ayarlar`): okunan desen/renk yazısının
//   ele alınışı + tablet iş emri girişi. Hüküm sunucuda; eski backend alanı göndermez → alan çizilmez, gövdeye girmez.
import { useState } from "react";
import { FieldLabel } from "./SettingRow";
import { EnumRadioOptions } from "./EnumRadioOptions";
import type { IncomingDocumentSettings } from "@/pages/Operations/GelenBelgeler/types";
import type { DesenRenkEslesmeMode, TabletIeGirisiMode } from "@/pages/Operations/GelenBelgeler/ieFormTypes";

export const DESEN_RENK_ESLESME_OPTIONS: ReadonlyArray<{ value: DesenRenkEslesmeMode; label: string; hint: string }> = [
  { value: "KAPALI", label: "Kullanma", hint: "Belgeden okunan desen ve renk yazısı iş emri formuna taşınmaz (bugünkü davranış)." },
  { value: "ONER", label: "Kayıt öner", hint: "Adı ya da kodu birebir tutan kumaş ve renk kaydı formda önerilir; görevli kontrol edip onaylar. Tutan kayıt yoksa alan boş kalır." },
  { value: "NOT", label: "Nota ekle", hint: "Okunan desen ve renk yazısı iş emri notunun sonuna eklenir; kumaş ve renk elle seçilir." },
];

export const TABLET_IE_GIRISI_OPTIONS: ReadonlyArray<{ value: TabletIeGirisiMode; label: string; hint: string }> = [
  { value: "IKISI", label: "Belge ve top okutma", hint: "Tablette iş emri hem belge okutarak hem top okutarak açılır (bugünkü davranış)." },
  { value: "BELGE", label: "Yalnız belge okutma", hint: "Fason çalışan fabrika için: iş emri yalnız gelen belge okutularak açılır; top okutma gizlenir." },
  { value: "TOP", label: "Yalnız top okutma", hint: "İş emri yalnız top okutularak açılır; belge okutma gizlenir." },
];

/** Taslak; sunucu alanı yoksa (eski backend) gövdeye girmez. */
export function useIeFormDraft(server: IncomingDocumentSettings | undefined) {
  const serverDesen = server?.desenRenkEslesme;
  const serverGiris = server?.tabletIeGirisi;
  const [desen, setDesen] = useState<DesenRenkEslesmeMode | undefined>(serverDesen);
  const [giris, setGiris] = useState<TabletIeGirisiMode | undefined>(serverGiris);
  const desenDirty = serverDesen !== undefined && desen !== undefined && desen !== serverDesen;
  const girisDirty = serverGiris !== undefined && giris !== undefined && giris !== serverGiris;
  return {
    serverDesen, serverGiris, desen, giris, setDesen, setGiris,
    desenFallback: server?.defaultDesenRenkEslesme, girisFallback: server?.defaultTabletIeGirisi,
    dirty: desenDirty || girisDirty,
    body: { ...(desenDirty ? { desenRenkEslesme: desen } : {}), ...(girisDirty ? { tabletIeGirisi: giris } : {}) },
    reset: () => { setDesen(serverDesen); setGiris(serverGiris); },
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
            desc="İş emri formunda belge okutulunca, belgede okunan desen (kumaş) ve renk yazısıyla ne yapılsın. Öneri yalnız adı ya da kodu birebir tutan kayıtta gelir; işi yavaşlatmaz."
          />
          <div id="gb-desen-renk-eslesme-radios" className="mt-2">
            <EnumRadioOptions name="Belgedeki desen ve renk yazısı" value={draft.desen ?? "KAPALI"} options={DESEN_RENK_ESLESME_OPTIONS} onChange={(v) => draft.setDesen(v as DesenRenkEslesmeMode)} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {DESEN_RENK_ESLESME_OPTIONS.find((o) => o.value === (draft.desenFallback ?? "KAPALI"))?.label}</p>
        </div>
      )}
      {draft.serverGiris !== undefined && (
        <div data-testid="gb-tablet-ie-girisi">
          <FieldLabel
            htmlFor="gb-tablet-ie-girisi-radios"
            label="Tablette iş emri girişi"
            desc="Tabletteki iş emri formunda hangi okutma yolları açık olsun. Fason çalışan fabrikada yalnız belge okutma seçilir."
          />
          <div id="gb-tablet-ie-girisi-radios" className="mt-2">
            <EnumRadioOptions name="Tablette iş emri girişi" value={draft.giris ?? "IKISI"} options={TABLET_IE_GIRISI_OPTIONS} onChange={(v) => draft.setGiris(v as TabletIeGirisiMode)} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {TABLET_IE_GIRISI_OPTIONS.find((o) => o.value === (draft.girisFallback ?? "IKISI"))?.label}</p>
        </div>
      )}
    </>
  );
}
