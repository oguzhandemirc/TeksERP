import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabelTemplatesPage } from "@/pages/LabelTemplates/LabelTemplatesPage";
import { LabelAssignmentsPage } from "@/pages/Labels/LabelAssignmentsPage";

/**
 * Etiketler — tek başlık + içerikte iki sekme (çift PageHeader sorunu giderildi).
 * Eski "Yazıcı Modelleri" ve "Boyutlar" kalktı (yazıcı dili + medya boyutu artık
 * doğrudan yazıcı cihazında — Etiket Stüdyosu v2). Kalan 2 kavram:
 *   - Düzenler  = hangi alan nerede / uzman kod — LabelTemplate (TEK HAVUZ)
 *   - Atamalar  = bağlam başına varsayılan şablon — LabelContextDefault
 * Alt sayfalar `hideHeader` ile kendi PageHeader'larını basmaz → tek başlık kalır.
 */
export function EtiketlerPage() {
  // Aktif sekme URL'de (?tab=) — düzenle→kaydet sonrası doğru sekmeye (Düzenler) dönülür.
  const [sp, setSp] = useSearchParams();
  // Alt sayfaların Yenile/+Yeni butonları başlığa PORTAL'lanır (yıldızın sağına) —
  // ref-callback state'i: element mount olunca alt sayfalara geçer.
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null);
  const tabParam = sp.get("tab");
  const tab = tabParam === "assignments" ? "assignments" : "templates";
  const setTab = (v: string) => {
    const n = new URLSearchParams(sp);
    n.set("tab", v);
    setSp(n, { replace: true });
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Etiketler"
        description="Etiket düzenleri (alan yerleşimi / uzman kod) ve bağlam atamaları."
        actions={<div ref={setActionsEl} className="flex items-center gap-2" />}
      />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-4 w-fit">
          <TabsTrigger value="templates">Düzenler</TabsTrigger>
          <TabsTrigger value="assignments">Atamalar</TabsTrigger>
        </TabsList>
        <TabsContent value="templates" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <LabelTemplatesPage hideHeader actionsPortal={actionsEl} />
        </TabsContent>
        <TabsContent value="assignments" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <LabelAssignmentsPage hideHeader actionsPortal={actionsEl} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
