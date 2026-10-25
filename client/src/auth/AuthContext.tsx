import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, http } from "../api/http";
import type { User } from "../api/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  // Restore the session from the httpOnly cookie on page load.
  useEffect(() => {
    http
      .get<{ user: User }>("/auth/me")
      .then((res) => setUser(res.user))
      .catch((error) => {
        if (!(error instanceof ApiError && error.status === 401)) console.error(error);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await http.post<{ user: User }>("/auth/login", { email, password });
    queryClient.clear(); // never show one user's cached data to another
    setUser(res.user);
    return res.user;
  }, [queryClient]);

  const logout = useCallback(async () => {
    await http.post("/auth/logout").catch(() => undefined);
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

/** For components that only render for a signed-in user. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useUser called without a signed-in user");
  return user;
}
