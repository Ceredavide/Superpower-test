import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "./App";

beforeEach(() => {
  window.history.pushState({}, "", "/auth");

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("renders the auth route through the composed app entry", async () => {
  render(<App />);

  expect(await screen.findByRole("heading", { name: "Split your shared costs" })).toBeInTheDocument();
});
