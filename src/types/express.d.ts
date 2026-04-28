import type { TenantConfig } from "./tenant";
import type { OperatorRole } from "@prisma/client";

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      tenantId: string;
      email: string;
      role: OperatorRole;
    }

    interface Request {
      tenantId: string;
      tenant: TenantConfig;
      authUser?: AuthUser;
    }
  }
}

export {};
