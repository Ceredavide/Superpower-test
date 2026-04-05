import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, test } from "vitest";

import { createApp } from "../src/app";
import { createAuthHelpers } from "../src/app/auth-helpers";
import { registerAuthRoutes } from "../src/features/auth/routes";
import { InMemoryStore } from "./support/in-memory-store";

describe("auth routes", () => {
  test("registers auth handlers onto an express app", async () => {
    const store = new InMemoryStore();
    const app = express();

    app.use(express.json());
    app.use(cookieParser());

    registerAuthRoutes(app, {
      store,
      sessionCookieName: "expense_groups_session",
      ...createAuthHelpers({
        store,
        sessionCookieName: "expense_groups_session",
        sessionTtlDays: 30
      })
    });

    const registerResponse = await request(app).post("/auth/register").send({
      email: "owner@example.com",
      password: "supersecret"
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.user).toMatchObject({
      email: "owner@example.com",
      displayName: null
    });
  });

  test("registers, restores the session, and completes the display name profile", async () => {
    const app = createApp({ store: new InMemoryStore() });

    const registerResponse = await request(app).post("/auth/register").send({
      email: "owner@example.com",
      password: "supersecret"
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.user).toMatchObject({
      email: "owner@example.com",
      displayName: null
    });
    expect(registerResponse.headers["set-cookie"]).toBeDefined();

    const cookie = registerResponse.headers["set-cookie"][0];

    const meResponse = await request(app).get("/auth/me").set("Cookie", cookie);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user).toMatchObject({
      email: "owner@example.com",
      displayName: null
    });

    const profileResponse = await request(app).patch("/users/me/profile").set("Cookie", cookie).send({
      displayName: "Morgan"
    });

    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.user).toMatchObject({
      email: "owner@example.com",
      displayName: "Morgan"
    });
  });

  test("rejects duplicate registration and allows login afterward", async () => {
    const app = createApp({ store: new InMemoryStore() });

    const firstRegistration = await request(app).post("/auth/register").send({
      email: "member@example.com",
      password: "supersecret"
    });

    expect(firstRegistration.status).toBe(201);

    const duplicateRegistration = await request(app).post("/auth/register").send({
      email: "MEMBER@example.com",
      password: "supersecret"
    });

    expect(duplicateRegistration.status).toBe(409);
    expect(duplicateRegistration.body.error).toBe("An account with that email already exists.");

    const loginResponse = await request(app).post("/auth/login").send({
      email: "member@example.com",
      password: "supersecret"
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.email).toBe("member@example.com");
  });
});
