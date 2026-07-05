import type { TenantConfig } from "./tenant";
import type { OperatorRole, PlatformAdminRole } from "@prisma/client";

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      tenantId: string;
      email: string;
      role: OperatorRole;
    }

    interface PlatformAdminUser {
      id: string;
      email: string;
      role: PlatformAdminRole;
      name?: string | null;
    }

    interface Request {
      tenantId: string;
      tenant: TenantConfig;
      authUser?: AuthUser;
      platformAdmin?: PlatformAdminUser;
    }
  }
}

export {};
