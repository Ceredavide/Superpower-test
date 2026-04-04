import { cleanup, render, screen, within } from "@testing-library/react";
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
        headers: { "Content-Type": "application/json" }
      });
    })
  );
}

describe("group expenses", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/groups/group_1");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("renders group expenses oldest-first and only exposes edit/delete for the creator", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      {
        path: "/groups/group_1",
        body: {
          group: {
            id: "group_1",
            name: "Weekend House",
            ownerId: "user_1",
            role: "owner",
            createdAt: "2026-04-04T00:00:00.000Z",
            updatedAt: "2026-04-04T00:00:00.000Z",
            members: [
              { id: "user_1", email: "owner@example.com", displayName: "Morgan", role: "owner" },
              { id: "user_2", email: "member@example.com", displayName: "Avery", role: "member" }
            ]
          }
        }
      },
      {
        path: "/groups/group_1/expenses",
        body: {
          expenses: [
            {
              id: "expense_older",
              groupId: "group_1",
              title: "Train tickets",
              expenseDate: "2026-04-06",
              totalAmount: "30.00",
              createdAt: "2026-04-06T08:00:00.000Z",
              updatedAt: "2026-04-06T08:00:00.000Z",
              createdBy: { id: "user_2", email: "member@example.com", displayName: "Avery" },
              payers: [{ user: { id: "user_2", email: "member@example.com", displayName: "Avery" }, amountPaid: "30.00" }]
            },
            {
              id: "expense_newer",
              groupId: "group_1",
              title: "Groceries",
              expenseDate: "2026-04-08",
              totalAmount: "20.00",
              createdAt: "2026-04-08T08:00:00.000Z",
              updatedAt: "2026-04-08T08:00:00.000Z",
              createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
              payers: [
                { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }, amountPaid: "12.50" },
                { user: { id: "user_2", email: "member@example.com", displayName: "Avery" }, amountPaid: "7.50" }
              ]
            }
          ]
        }
      }
    ]);

    render(<App />);

    const cards = await screen.findAllByTestId("expense-card");

    expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual([
      "Train tickets",
      "Groceries"
    ]);

    expect(within(cards[0]).queryByRole("button", { name: "Edit expense" })).toBeNull();
    expect(within(cards[0]).queryByRole("button", { name: "Delete expense" })).toBeNull();
    expect(within(cards[1]).getByRole("button", { name: "Edit expense" })).toBeInTheDocument();
    expect(within(cards[1]).getByRole("button", { name: "Delete expense" })).toBeInTheDocument();
  });

  test("updates the live total and submits a new expense", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      {
        path: "/groups/group_1",
        body: {
          group: {
            id: "group_1",
            name: "Weekend House",
            ownerId: "user_1",
            role: "owner",
            createdAt: "2026-04-04T00:00:00.000Z",
            updatedAt: "2026-04-04T00:00:00.000Z",
            members: [
              { id: "user_1", email: "owner@example.com", displayName: "Morgan", role: "owner" },
              { id: "user_2", email: "member@example.com", displayName: "Avery", role: "member" }
            ]
          }
        }
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } },
      {
        method: "POST",
        path: "/groups/group_1/expenses",
        status: 201,
        body: {
          expense: {
            id: "expense_1",
            groupId: "group_1",
            title: "Dinner",
            expenseDate: "2026-04-09",
            totalAmount: "25.50",
            createdAt: "2026-04-09T08:00:00.000Z",
            updatedAt: "2026-04-09T08:00:00.000Z",
            createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
            payers: [
              { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }, amountPaid: "10.00" },
              { user: { id: "user_2", email: "member@example.com", displayName: "Avery" }, amountPaid: "15.50" }
            ]
          }
        }
      },
      {
        path: "/groups/group_1/expenses",
        body: {
          expenses: [
            {
              id: "expense_1",
              groupId: "group_1",
              title: "Dinner",
              expenseDate: "2026-04-09",
              totalAmount: "25.50",
              createdAt: "2026-04-09T08:00:00.000Z",
              updatedAt: "2026-04-09T08:00:00.000Z",
              createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
              payers: [
                { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }, amountPaid: "10.00" },
                { user: { id: "user_2", email: "member@example.com", displayName: "Avery" }, amountPaid: "15.50" }
              ]
            }
          ]
        }
      }
    ]);

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("No expenses recorded yet.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Expense title"), "Dinner");
    await user.type(screen.getByLabelText("Expense date"), "2026-04-09");
    await user.selectOptions(screen.getByLabelText("Payer 1"), "user_1");
    await user.type(screen.getByLabelText("Amount paid by payer 1"), "10.00");
    await user.click(screen.getByRole("button", { name: "Add payer" }));
    await user.selectOptions(screen.getByLabelText("Payer 2"), "user_2");
    await user.type(screen.getByLabelText("Amount paid by payer 2"), "15.50");

    expect(screen.getByText("Total: 25.50")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save expense" }));

    expect(await screen.findByText("Dinner")).toBeInTheDocument();
    expect(screen.getByText("Total paid 25.50")).toBeInTheDocument();
  });
});
