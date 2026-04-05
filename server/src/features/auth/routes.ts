import bcrypt from "bcryptjs";
import type { Express } from "express";
import { z } from "zod";

import { createAuthHelpers, normalizeDisplayName, normalizeEmail } from "../../app/auth-helpers";
import { serializeUser } from "../../app/serialize";
import { hashSessionToken } from "../../core/lib/session";
import type { Store } from "../../store/types";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = registerSchema;

const profileSchema = z.object({
  displayName: z.string().trim().min(1)
});

type AuthRouteDeps = {
  store: Store;
  sessionCookieName: string;
} & Pick<
  ReturnType<typeof createAuthHelpers>,
  "createSession" | "getAuthenticatedUser" | "getRawSessionToken"
>;

export function registerAuthRoutes(app: Express, deps: AuthRouteDeps) {
  const {
    createSession,
    getAuthenticatedUser,
    getRawSessionToken,
    sessionCookieName,
    store
  } = deps;

  app.post("/auth/register", async (request, response) => {
    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Enter a valid email and an 8+ character password." });
    }

    const email = normalizeEmail(parsed.data.email);
    const existingUser = await store.findUserByEmail(email);

    if (existingUser) {
      return response.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const user = await store.createUser({ email, passwordHash });
    const session = await createSession(user.id);

    response.cookie(sessionCookieName, session.rawToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      expires: session.expiresAt
    });

    return response.status(201).json({ user: serializeUser(user) });
  });

  app.post("/auth/login", async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Enter a valid email and an 8+ character password." });
    }

    const email = normalizeEmail(parsed.data.email);
    const user = await store.findUserByEmail(email);

    if (!user) {
      return response.status(401).json({ error: "Invalid email or password." });
    }

    const matches = await bcrypt.compare(parsed.data.password, user.passwordHash);

    if (!matches) {
      return response.status(401).json({ error: "Invalid email or password." });
    }

    const session = await createSession(user.id);

    response.cookie(sessionCookieName, session.rawToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      expires: session.expiresAt
    });

    return response.status(200).json({ user: serializeUser(user) });
  });

  app.post("/auth/logout", async (request, response) => {
    const rawToken = getRawSessionToken(request);

    if (rawToken) {
      await store.deleteSessionByTokenHash(hashSessionToken(rawToken));
    }

    response.clearCookie(sessionCookieName);
    return response.status(204).send();
  });

  app.get("/auth/me", async (request, response) => {
    const user = await getAuthenticatedUser(getRawSessionToken(request));

    return response.status(200).json({ user: user ? serializeUser(user) : null });
  });

  app.patch("/users/me/profile", async (request, response) => {
    const user = await getAuthenticatedUser(getRawSessionToken(request));

    if (!user) {
      return response.status(401).json({ error: "You must be logged in to do that." });
    }

    const parsed = profileSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Display name is required." });
    }

    const displayName = parsed.data.displayName.trim();
    const displayNameNormalized = normalizeDisplayName(displayName);
    const existingUser = await store.findUserByDisplayNameNormalized(displayNameNormalized);

    if (existingUser && existingUser.id !== user.id) {
      return response.status(409).json({ error: "That display name is already taken." });
    }

    const updatedUser = await store.updateDisplayName({
      userId: user.id,
      displayName,
      displayNameNormalized
    });

    return response.status(200).json({ user: updatedUser ? serializeUser(updatedUser) : serializeUser(user) });
  });
}
