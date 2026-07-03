import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabelFormatProfilesPage } from "@/pages/LabelFormatProfiles/LabelFormatProfilesPage";
import { LabelTemplatesPage } from "@/pages/LabelTemplates/LabelTemplatesPage";

/**
 * Etiketler — tek başlık + içerikte iki sekme (çift PageHeader sorunu giderildi).
 * Eski "Yazıcı Modelleri" kalktı (yazıcı dili artık Donanım satırında). Kalan 2 kavram:
 *   - Boyutlar  = etiketin fiziksel ölçüsü (mm) — LabelFormatProfile
 *   - Düzenler  = hangi alan nerede / uzman kod — LabelTemplate
 * Alt sayfalar `hideHeader` ile kendi PageHeader'larını basmaz → tek başlık kalır.
 */
export function EtiketlerPage() {
  // Aktif sekme URL'de (?tab=) — düzenle→kaydet sonrası doğru sekmeye (Düzenler) dönülür.
  const [sp, setSp] = useSearchParams();
  // Alt sayfaların Yenile/+Yeni butonları başlığa PORTAL'lanır (yıldızın sağına) —
  // ref-callback state'i: element mount olunca alt sayfalara geçer.
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null);
  const tab = sp.get("tab") === "templates" ? "templates" : "formats";
  const setTab = (v: string) => {
    const n = new URLSearchParams(sp);
    n.set("tab", v);
    setSp(n, { replace: true });
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Etiketler"
        description="Etiket boyutları (mm) ve düzenleri (alan yerleşimi / uzman yazıcı kodu)."
        actions={<div ref={setActionsEl} className="flex items-center gap-2" />}
      />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-4 w-fit">
          <TabsTrigger value="formats">Boyutlar</TabsTrigger>
          <TabsTrigger value="templates">Düzenler</TabsTrigger>
        </TabsList>
        <TabsContent value="formats" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <LabelFormatProfilesPage hideHeader actionsPortal={actionsEl} />
        </TabsContent>
        <TabsContent value="templates" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <LabelTemplatesPage hideHeader actionsPortal={actionsEl} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
