import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabelFormatProfilesPage } from "@/pages/LabelFormatProfiles/LabelFormatProfilesPage";
import { LabelTemplatesPage } from "@/pages/LabelTemplates/LabelTemplatesPage";

/**
 * Etiketler — eski 3 ekran (Yazıcı Modelleri + Format Profilleri + Etiket
 * Standartları) tek sekmeli ekranda. Yazıcı dili artık cihaz (Donanım) satırında,
 * o yüzden "Yazıcı Modelleri" standalone kalktı. Kalan 2 kavram:
 *   - Boyutlar  = etiketin fiziksel ölçüsü (mm) — LabelFormatProfile
 *   - Düzenler  = hangi alan nerede (alan yerleşimi) — LabelTemplate
 */
export function EtiketlerPage() {
  return (
    <Tabs defaultValue="formats" className="flex h-full flex-col">
      <TabsList className="m-4 mb-0 w-fit">
        <TabsTrigger value="formats">Boyutlar</TabsTrigger>
        <TabsTrigger value="templates">Düzenler</TabsTrigger>
      </TabsList>
      <TabsContent value="formats" className="mt-0 min-h-0 flex-1 overflow-hidden">
        <LabelFormatProfilesPage />
      </TabsContent>
      <TabsContent value="templates" className="mt-0 min-h-0 flex-1 overflow-hidden">
        <LabelTemplatesPage />
      </TabsContent>
    </Tabs>
  );
}
