import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { App } from "./App";

type MockRoute = {
  method?: string;
  path: string;
  status?: number;
  body: unknown;
};

function installFetchMock(routes: MockRoute[]) {
  const queue = [...routes];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const path = url.startsWith("http") ? new URL(url).pathname : url;
      const method = (init?.method ?? "GET").toUpperCase();
      const match = queue.find((entry) => entry.path === path && (entry.method ?? "GET") === method);

      if (!match) {
        throw new Error(`No fetch mock found for ${method} ${path}`);
      }

      queue.splice(queue.indexOf(match), 1);

      return new Response(JSON.stringify(match.body), {
        status: match.status ?? 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    })
  );
}

describe("App", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("renders the auth route through the composed app entry", async () => {
    installFetchMock([{ path: "/auth/me", body: { user: null } }]);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Split your shared costs" })).toBeInTheDocument();
  });

  test("registers, completes the display name, and lands on the dashboard", async () => {
    installFetchMock([
      { path: "/auth/me", body: { user: null } },
      {
        method: "POST",
        path: "/auth/register",
        status: 201,
        body: { user: { id: "user_1", email: "owner@example.com", displayName: null } }
      },
      {
        method: "PATCH",
        path: "/users/me/profile",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups", body: { groups: [] } },
      { path: "/invitations", body: { invitations: [] } }
    ]);

    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByText("Split your shared costs")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email address"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "supersecret");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Choose your display name")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Display name"), "Morgan");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText("Your groups")).toBeInTheDocument();
    expect(await screen.findByText("Create your first expense group to get started.")).toBeInTheDocument();
  });

  test("loads the dashboard for an authenticated user with groups and invitations", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      {
        path: "/groups",
        body: {
          groups: [
            {
              id: "group_1",
              name: "April Trip",
              ownerId: "user_1",
              role: "owner",
              createdAt: "2026-04-04T00:00:00.000Z",
              updatedAt: "2026-04-04T00:00:00.000Z"
            }
          ]
        }
      },
      {
        path: "/invitations",
        body: {
          invitations: [
            {
              id: "invite_1",
              status: "pending",
              createdAt: "2026-04-04T00:00:00.000Z",
              respondedAt: null,
              group: { id: "group_2", name: "Weekend House" },
              invitedBy: { id: "user_2", email: "friend@example.com", displayName: "Avery" }
            }
          ]
        }
      }
    ]);

    render(<App />);

    expect(await screen.findByText("April Trip")).toBeInTheDocument();
    expect(await screen.findByText("Weekend House")).toBeInTheDocument();
    expect(screen.getByText("Invited by Avery")).toBeInTheDocument();

    await waitFor(() => {
      expect(window.location.pathname).toBe("/dashboard");
    });
  });
});
