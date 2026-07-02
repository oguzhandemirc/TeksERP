import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionsTab } from "./PermissionsTab";
import { ApplyTemplateTab } from "./ApplyTemplateTab";
import { ResetPasswordTab } from "./ResetPasswordTab";
import { CardTokenTab } from "./CardTokenTab";
import type { AdminUserListItem } from "@/services/adminUserService";

interface Props {
  user: AdminUserListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserDetailSheet({ user, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-hidden">
        <SheetHeader>
          <SheetTitle>{user?.fullName ?? "—"}</SheetTitle>
          <SheetDescription>
            <span className="font-mono">{user?.username}</span>
            {" · "}
            {user?._count.permissions ?? 0} yetki
          </SheetDescription>
        </SheetHeader>

        {user && (
          <Tabs defaultValue="permissions" className="mt-4">
            <TabsList>
              <TabsTrigger value="permissions">Yetkiler</TabsTrigger>
              <TabsTrigger value="template">Şablon Uygula</TabsTrigger>
              <TabsTrigger value="password">Şifre Sıfırla</TabsTrigger>
              <TabsTrigger value="card">Personel Kartı</TabsTrigger>
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
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
