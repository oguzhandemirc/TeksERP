import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionsTab } from "./PermissionsTab";
import { ApplyTemplateTab } from "./ApplyTemplateTab";
import { ResetPasswordTab } from "./ResetPasswordTab";
import { CardTokenTab } from "./CardTokenTab";
import { QuickPinTab } from "./QuickPinTab";
import type { AdminUserListItem } from "@/services/adminUserService";

type UserDetailTab = "permissions" | "template" | "password" | "card" | "quick-pin";

interface Props {
  user: AdminUserListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Açılışta gösterilecek sekme (örn. yeni-kullanıcı "yönet" → hızlı PIN). */
  initialTab?: UserDetailTab;
}

export function UserDetailSheet({ user, open, onOpenChange, initialTab = "permissions" }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-hidden">
        <SheetHeader>
          <SheetTitle>{user?.fullName ?? "—"}</SheetTitle>
          <SheetDescription>
            <span className="font-mono">{user?.username}</span>
            {" · "}
            {user?._count?.permissions ?? 0} yetki
          </SheetDescription>
        </SheetHeader>

        {user && (
          // key={initialTab}: farklı sekmeyle yeniden açılınca defaultValue tekrar uygulansın.
          <Tabs key={initialTab} defaultValue={initialTab} className="mt-4">
            <TabsList>
              <TabsTrigger value="permissions">Yetkiler</TabsTrigger>
              <TabsTrigger value="template">Şablon Uygula</TabsTrigger>
              <TabsTrigger value="password">Şifre Sıfırla</TabsTrigger>
              <TabsTrigger value="card">Personel Kartı</TabsTrigger>
              <TabsTrigger value="quick-pin">Hızlı PIN</TabsTrigger>
            </TabsList>
            <TabsContent value="permissions">
              <PermissionsTab userId={user.id} />
            </TabsContent>
            <TabsContent value="template">
              <ApplyTemplateTab userId={user.id} />
            </TabsContent>
            <TabsContent value="password">
              <ResetPasswordTab userId={user.id} username={user.username} />
            </TabsContent>
            <TabsContent value="card">
              <CardTokenTab userId={user.id} username={user.username} fullName={user.fullName} />
            </TabsContent>
            <TabsContent value="quick-pin">
              <QuickPinTab userId={user.id} username={user.username} />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
