import request from "supertest";
import { expect, test } from "vitest";

import { createApp as createComposedApp } from "../src/app";
import { createApp } from "../src/app/create-app";
import { InMemoryStore } from "./support/in-memory-store";

test("serves the health route through the app compatibility entry", async () => {
  expect(createComposedApp).toBe(createApp);

  const response = await request(createComposedApp({ store: new InMemoryStore() })).get("/health");

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ ok: true });
});
