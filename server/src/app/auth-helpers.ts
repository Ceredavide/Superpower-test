import type { Request, Response } from "express";

import { createSessionToken, hashSessionToken } from "../core/lib/session";
import type { Store, StoredUser } from "../store/types";

type CreateAuthHelpersOptions = {
  store: Store;
  sessionCookieName: string;
  sessionTtlDays: number;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeDisplayName(displayName: string) {
  return displayName.trim().toLowerCase();
}

export function createAuthHelpers({
  store,
  sessionCookieName,
  sessionTtlDays
}: CreateAuthHelpersOptions) {
  async function getAuthenticatedUser(cookieValue?: string | null) {
    if (!cookieValue) {
      return null;
    }

    const session = await store.findSessionByTokenHash(hashSessionToken(cookieValue));

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return store.findUserById(session.userId);
  }

  function getRawSessionToken(request: Request) {
    return request.cookies[sessionCookieName] as string | undefined;
  }

  async function requireUser(request: Request, response: Response) {
    const user = await getAuthenticatedUser(getRawSessionToken(request));

    if (!user) {
      response.status(401).json({ error: "You must be logged in to do that." });
      return null;
    }

    return user;
  }

  function requireCompletedProfile(user: StoredUser, response: Response) {
    if (!user.displayName) {
      response.status(403).json({ error: "Finish your profile before doing that." });
      return false;
    }

    return true;
  }

  async function createSession(userId: string) {
    const rawToken = createSessionToken();
    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000);

    await store.createSession({
      userId,
      tokenHash: hashSessionToken(rawToken),
      expiresAt
    });

    return { rawToken, expiresAt };
  }

  return {
    createSession,
    getAuthenticatedUser,
    getRawSessionToken,
    requireCompletedProfile,
    requireUser
  };
}
