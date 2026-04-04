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

  test("renders group expenses oldest-first, hides creator controls for non-creators, and defaults new payer rows to the signed-in user", async () => {
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
              { id: "user_2", email: "member@example.com", displayName: "Avery", role: "member" },
              { id: "user_1", email: "owner@example.com", displayName: "Morgan", role: "owner" }
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
              createdAt: "2026-04-09T08:00:00.000Z",
              updatedAt: "2026-04-09T08:00:00.000Z",
              createdBy: { id: "user_2", email: "member@example.com", displayName: "Avery" },
              payers: [{ user: { id: "user_2", email: "member@example.com", displayName: "Avery" }, amountPaid: "30.00" }]
            },
            {
              id: "expense_newer",
              groupId: "group_1",
              title: "Groceries",
              expenseDate: "2026-04-08",
              totalAmount: "20.00",
              createdAt: "2026-04-06T08:00:00.000Z",
              updatedAt: "2026-04-06T08:00:00.000Z",
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

    expect(screen.getByLabelText("Payer 1")).toHaveValue("user_1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add payer" }));

    expect(screen.getByLabelText("Payer 2")).toHaveValue("user_1");
    await user.click(screen.getAllByRole("button", { name: "Remove payer" })[1]);

    expect(screen.queryByLabelText("Payer 2")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove payer" })).toBeDisabled();
  });

  test("keeps a saved expense visible when the follow-up refresh is unavailable", async () => {
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
              { id: "user_2", email: "member@example.com", displayName: "Avery", role: "member" },
              { id: "user_1", email: "owner@example.com", displayName: "Morgan", role: "owner" }
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
            id: "expense_saved",
            groupId: "group_1",
            title: "Museum tickets",
            expenseDate: "2026-04-10",
            totalAmount: "18.00",
            createdAt: "2026-04-10T08:00:00.000Z",
            updatedAt: "2026-04-10T08:00:00.000Z",
            createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
            payers: [{ user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }, amountPaid: "18.00" }]
          }
        }
      }
    ]);

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("No expenses recorded yet.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Expense title"), "Museum tickets");
    await user.type(screen.getByLabelText("Expense date"), "2026-04-10");
    await user.type(screen.getByLabelText("Amount paid by payer 1"), "18.00");
    await user.click(screen.getByRole("button", { name: "Save expense" }));

    expect(await screen.findByText("Expense saved.")).toBeInTheDocument();
    expect(screen.getByText("Museum tickets")).toBeInTheDocument();
  });

  test("ignores live-total inputs the backend would reject", async () => {
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
              { id: "user_2", email: "member@example.com", displayName: "Avery", role: "member" },
              { id: "user_1", email: "owner@example.com", displayName: "Morgan", role: "owner" }
            ]
          }
        }
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } }
    ]);

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("No expenses recorded yet.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Amount paid by payer 1"), ".5");
    expect(document.querySelector(".expense-total-chip")?.textContent).toBe("Total: 0.00");

    await user.clear(screen.getByLabelText("Amount paid by payer 1"));
    await user.type(screen.getByLabelText("Amount paid by payer 1"), "12.999");
    expect(document.querySelector(".expense-total-chip")?.textContent).toBe("Total: 0.00");
  });

  test("creates, edits, and deletes an expense for the creator", async () => {
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
              { id: "user_2", email: "member@example.com", displayName: "Avery", role: "member" },
              { id: "user_1", email: "owner@example.com", displayName: "Morgan", role: "owner" }
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
            totalAmount: "15.00",
            createdAt: "2026-04-09T08:00:00.000Z",
            updatedAt: "2026-04-09T08:00:00.000Z",
            createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
            payers: [{ user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }, amountPaid: "15.00" }]
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
              totalAmount: "15.00",
              createdAt: "2026-04-09T08:00:00.000Z",
              updatedAt: "2026-04-09T08:00:00.000Z",
              createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
              payers: [{ user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }, amountPaid: "15.00" }]
            }
          ]
        }
      },
      {
        method: "PATCH",
        path: "/expenses/expense_1",
        body: {
          expense: {
            id: "expense_1",
            groupId: "group_1",
            title: "Dinner with dessert",
            expenseDate: "2026-04-09",
            totalAmount: "15.00",
            createdAt: "2026-04-09T08:00:00.000Z",
            updatedAt: "2026-04-09T09:00:00.000Z",
            createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
            payers: [{ user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }, amountPaid: "15.00" }]
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
              title: "Dinner with dessert",
              expenseDate: "2026-04-09",
              totalAmount: "15.00",
              createdAt: "2026-04-09T08:00:00.000Z",
              updatedAt: "2026-04-09T09:00:00.000Z",
              createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
              payers: [{ user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }, amountPaid: "15.00" }]
            }
          ]
        }
      },
      {
        method: "DELETE",
        path: "/expenses/expense_1",
        body: {}
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } }
    ]);

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("No expenses recorded yet.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Expense title"), "Dinner");
    await user.type(screen.getByLabelText("Expense date"), "2026-04-09");
    await user.type(screen.getByLabelText("Amount paid by payer 1"), "15.00");
    await user.click(screen.getByRole("button", { name: "Add payer" }));
    await user.selectOptions(screen.getByLabelText("Payer 2"), "user_2");
    await user.click(screen.getAllByRole("button", { name: "Remove payer" })[1]);

    expect(screen.queryByLabelText("Payer 2")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove payer" })).toBeDisabled();
    expect(screen.getByText("Total: 15.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save expense" }));

    expect(await screen.findByText("Dinner")).toBeInTheDocument();
    expect(screen.getByText("Total paid 15.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit expense" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete expense" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit expense" }));
    await user.clear(screen.getByLabelText("Expense title"));
    await user.type(screen.getByLabelText("Expense title"), "Dinner with dessert");
    await user.click(screen.getByRole("button", { name: "Save expense" }));

    expect(await screen.findByText("Dinner with dessert")).toBeInTheDocument();
    expect(screen.getByText("Total paid 15.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete expense" }));

    expect(await screen.findByText("No expenses recorded yet.")).toBeInTheDocument();
  });

  test("shows inline error text when saving an expense fails", async () => {
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
              { id: "user_2", email: "member@example.com", displayName: "Avery", role: "member" },
              { id: "user_1", email: "owner@example.com", displayName: "Morgan", role: "owner" }
            ]
          }
        }
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } },
      {
        method: "POST",
        path: "/groups/group_1/expenses",
        status: 422,
        body: { error: "Expense validation failed." }
      }
    ]);

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("No expenses recorded yet.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Expense title"), "Dinner");
    await user.type(screen.getByLabelText("Expense date"), "2026-04-09");
    await user.type(screen.getByLabelText("Amount paid by payer 1"), "10.00");
    await user.click(screen.getByRole("button", { name: "Save expense" }));

    expect(await screen.findByText("Expense validation failed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Expense title")).toHaveValue("Dinner");
    expect(screen.getByLabelText("Expense date")).toHaveValue("2026-04-09");
  });
});
