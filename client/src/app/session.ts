import { startTransition, useEffect, useState } from "react";

import { api } from "../core/api";
import type { User } from "../core/types/shared";

export type SessionState = {
  isLoading: boolean;
  user: User | null;
};

export type AppRouteProps = {
  session: SessionState;
  onUserChange: (user: User | null) => void;
};

export function useAppSession() {
  const [session, setSession] = useState<SessionState>({ isLoading: true, user: null });

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await api.getCurrentUser();

        if (!cancelled) {
          startTransition(() => {
            setSession({ isLoading: false, user: response.user });
          });
        }
      } catch {
        if (!cancelled) {
          setSession({ isLoading: false, user: null });
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleUserChange(user: User | null) {
    setSession((current) => ({ ...current, user }));
  }

  return { session, handleUserChange };
}
