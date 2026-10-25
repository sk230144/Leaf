import type { Role } from "@prisma/client";

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  /** Present only for AUTHOR users */
  authorId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
