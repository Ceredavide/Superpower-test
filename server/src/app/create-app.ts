import fs from "node:fs";
import path from "node:path";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";

import { createAuthHelpers } from "./auth-helpers";
import { registerAuthRoutes } from "../features/auth/routes";
import { registerGroupRoutes } from "../features/groups/routes";
import { registerLedgerRoutes } from "../features/ledger/routes";
import type { Store } from "../store/types";

export type CreateAppOptions = {
  store: Store;
  sessionCookieName?: string;
  sessionTtlDays?: number;
  clientOrigin?: string;
  staticAssetsPath?: string;
};

export function createApp({
  store,
  sessionCookieName = "expense_groups_session",
  sessionTtlDays = 30,
  clientOrigin = "http://localhost:5173",
  staticAssetsPath
}: CreateAppOptions) {
  const app = express();
  const {
    createSession,
    getAuthenticatedUser,
    getRawSessionToken,
    requireCompletedProfile,
    requireUser
  } = createAuthHelpers({
    store,
    sessionCookieName,
    sessionTtlDays
  });

  app.use(
    cors({
      origin: clientOrigin,
      credentials: true
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  registerAuthRoutes(app, {
    store,
    sessionCookieName,
    createSession,
    getAuthenticatedUser,
    getRawSessionToken
  });

  app.get("/health", (_request, response) => {
    response.status(200).json({ ok: true });
  });

  registerGroupRoutes(app, {
    store,
    requireCompletedProfile,
    requireUser
  });

  registerLedgerRoutes(app, {
    store,
    requireCompletedProfile,
    requireUser
  });

  if (staticAssetsPath && fs.existsSync(staticAssetsPath)) {
    app.use(express.static(staticAssetsPath));

    app.get("*", (request, response, next) => {
      if (
        request.path.startsWith("/auth/") ||
        request.path.startsWith("/groups/") ||
        request.path.startsWith("/invitations/") ||
        request.path.startsWith("/expenses/")
      ) {
        return next();
      }

      if (request.path.startsWith("/users/") || request.path.startsWith("/health")) {
        return next();
      }

      return response.sendFile(path.join(staticAssetsPath, "index.html"));
    });
  }

  return app;
}
