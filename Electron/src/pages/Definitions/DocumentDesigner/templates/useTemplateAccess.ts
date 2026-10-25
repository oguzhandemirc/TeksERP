import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { DOCUMENT_TEMPLATE_DESIGN, DOCUMENT_TEMPLATE_PUBLISH } from "@/lib/permissions";
import { useAuthStore } from "@/store/auth";
import { designerAccess, type DesignerAccess } from "./model";

export interface TemplateAccess extends DesignerAccess {
  /** `documents.publishSodEnabled` (P-b) — yalnız düğme pasifliği; asıl kapı sunucuda 403 `PUBLISH_SOD`. */
  sodEnabled: boolean;
  me: string | null;
}

export function useTemplateAccess(): TemplateAccess {
  const { hasAnyPermission } = useRoleAccess();
  const flags = useFeatureFlags().data?.data as { documentPublishSodEnabled?: boolean } | undefined;
  const me = useAuthStore((s) => s.user?.userId ?? null);
  return {
    ...designerAccess(hasAnyPermission(DOCUMENT_TEMPLATE_DESIGN), hasAnyPermission(DOCUMENT_TEMPLATE_PUBLISH)),
    sodEnabled: flags?.documentPublishSodEnabled === true,
    me,
  };
}
