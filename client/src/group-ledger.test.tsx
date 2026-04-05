import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { App } from "./App";

type MockRoute = {
  method?: string;
  path: string;
  status?: number;
  body: unknown | ((request: { body: unknown }) => unknown);
};

function installFetchMock(routes: MockRoute[]) {
  const queue = [...routes];
  const requests: Array<{ method: string; path: string; body: unknown }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const path = url.startsWith("http") ? new URL(url).pathname : url;
      const method = (init?.method ?? "GET").toUpperCase();
      const body =
        typeof init?.body === "string" && init.body.length > 0
          ? (JSON.parse(init.body) as unknown)
          : undefined;
      const match = queue.find((entry) => entry.path === path && (entry.method ?? "GET") === method);

      if (!match) {
        throw new Error(`No fetch mock found for ${method} ${path}`);
      }

      queue.splice(queue.indexOf(match), 1);
      requests.push({ method, path, body });

      return new Response(
        JSON.stringify(typeof match.body === "function" ? match.body({ body }) : match.body),
        {
          status: match.status ?? 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    })
  );

  return { requests };
}

function buildLedgerResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    groupId: "group_1",
    members: [
      {
        id: "user_1",
        email: "owner@example.com",
        displayName: "Morgan",
        status: "active",
        leftAt: null
      },
      {
        id: "user_2",
        email: "member@example.com",
        displayName: "Avery",
        status: "active",
        leftAt: null
      },
      {
        id: "user_3",
        email: "third@example.com",
        displayName: "Jules",
        status: "active",
        leftAt: null
      }
    ],
    expenses: [],
    balances: [
      { userId: "user_1", balance: "0.00" },
      { userId: "user_2", balance: "0.00" },
      { userId: "user_3", balance: "0.00" }
    ],
    settleUpSuggestions: [],
    settlements: [],
    ...overrides
  };
}

function buildGroupResponse(memberIds: string[] = ["user_1", "user_2", "user_3"]) {
  const members = [
    { id: "user_1", email: "owner@example.com", displayName: "Morgan", role: "owner" },
    { id: "user_2", email: "member@example.com", displayName: "Avery", role: "member" },
    { id: "user_3", email: "third@example.com", displayName: "Jules", role: "member" }
  ].filter((member) => memberIds.includes(member.id));

  return {
    group: {
      id: "group_1",
      name: "Weekend House",
      ownerId: "user_1",
      role: "owner",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z",
      members
    }
  };
}

describe("group ledger", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/groups/group_1");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("switches split modes and submits the richer expense payload", async () => {
    const { requests } = installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups/group_1", body: buildGroupResponse() },
      { path: "/groups/group_1/ledger", body: buildLedgerResponse() },
      { path: "/groups/group_1/expenses", body: { expenses: [] } },
      {
        method: "POST",
        path: "/groups/group_1/expenses",
        status: 201,
        body: {
          expense: {
            id: "expense_1",
            groupId: "group_1",
            title: "Boat rental",
            category: "food",
            splitMode: "percentage",
            expenseDate: "2026-04-12",
            totalAmount: "40.00",
            createdAt: "2026-04-12T08:00:00.000Z",
            updatedAt: "2026-04-12T08:00:00.000Z",
            createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
            payers: [
              {
                user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
                amountPaid: "40.00"
              }
            ]
          }
        }
      }
    ]);

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("No expenses recorded yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Percentage for Morgan")).toBeNull();

    await user.selectOptions(screen.getByLabelText("Split mode"), "percentage");

    expect(screen.getByLabelText("Percentage for Morgan")).toBeInTheDocument();
    expect(screen.getByLabelText("Percentage for Avery")).toBeInTheDocument();
    expect(screen.queryByLabelText("Amount owed by Morgan")).toBeNull();

    await user.selectOptions(screen.getByLabelText("Category"), "food");
    await user.type(screen.getByLabelText("Expense title"), "Boat rental");
    await user.type(screen.getByLabelText("Expense date"), "2026-04-12");
    await user.type(screen.getByLabelText("Amount paid by payer 1"), "40.00");
    await user.clear(screen.getByLabelText("Percentage for Morgan"));
    await user.type(screen.getByLabelText("Percentage for Morgan"), "60");
    await user.clear(screen.getByLabelText("Percentage for Avery"));
    await user.type(screen.getByLabelText("Percentage for Avery"), "40");
    await user.click(screen.getByLabelText("Include Jules"));
    await user.click(screen.getByRole("button", { name: "Save expense" }));

    const createRequest = requests.find(
      (request) => request.method === "POST" && request.path === "/groups/group_1/expenses"
    );

    expect(createRequest?.body).toEqual({
      title: "Boat rental",
      category: "food",
      splitMode: "percentage",
      expenseDate: "2026-04-12",
      payers: [{ userId: "user_1", amountPaid: "40.00" }],
      participants: [
        { userId: "user_1", included: true, percentage: "60" },
        { userId: "user_2", included: true, percentage: "40" },
        { userId: "user_3", included: false }
      ]
    });
  });

  test("renders balances and settlement history from the ledger response", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups/group_1", body: buildGroupResponse() },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          balances: [
            { userId: "user_1", balance: "12.50" },
            { userId: "user_2", balance: "-7.50" },
            { userId: "user_3", balance: "-5.00" }
          ],
          settlements: [
            {
              id: "settlement_1",
              groupId: "group_1",
              fromUserId: "user_2",
              toUserId: "user_1",
              amount: "3.00",
              paidAt: "2026-04-10T09:30:00.000Z",
              createdByUserId: "user_2",
              createdAt: "2026-04-10T09:30:00.000Z",
              updatedAt: "2026-04-10T09:30:00.000Z"
            }
          ]
        })
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } }
    ]);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Current balances" })).toBeInTheDocument();
    expect(screen.getByText("Morgan is owed 12.50")).toBeInTheDocument();
    expect(screen.getByText("Avery owes 7.50")).toBeInTheDocument();
    expect(screen.getByText("Jules owes 5.00")).toBeInTheDocument();

    const history = screen.getByRole("list", { name: "Settlement history" });
    expect(within(history).getByText("Avery paid Morgan 3.00")).toBeInTheDocument();
    expect(within(history).getByText("2026-04-10")).toBeInTheDocument();
  });

  test("renders removed member names in settlement history on a fresh load", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups/group_1", body: buildGroupResponse(["user_1", "user_3"]) },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          members: [
            {
              id: "user_1",
              email: "owner@example.com",
              displayName: "Morgan",
              status: "active",
              leftAt: null
            },
            {
              id: "user_3",
              email: "third@example.com",
              displayName: "Jules",
              status: "active",
              leftAt: null
            }
          ],
          settlements: [
            {
              id: "settlement_removed",
              groupId: "group_1",
              fromUserId: "user_2",
              toUserId: "user_1",
              amount: "5.00",
              paidAt: "2026-04-11T09:30:00.000Z",
              createdByUserId: "user_1",
              createdAt: "2026-04-11T09:30:00.000Z",
              updatedAt: "2026-04-11T09:30:00.000Z",
              fromUser: {
                id: "user_2",
                email: "member@example.com",
                displayName: "Avery"
              },
              toUser: {
                id: "user_1",
                email: "owner@example.com",
                displayName: "Morgan"
              }
            }
          ]
        })
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } }
    ]);

    render(<App />);

    const history = await screen.findByRole("list", { name: "Settlement history" });
    expect(within(history).getByText("Avery paid Morgan 5.00")).toBeInTheDocument();
    expect(within(history).queryByText("user_2 paid Morgan 5.00")).not.toBeInTheDocument();
  });

  test("shows a visible error when the ledger fails to load", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups/group_1", body: buildGroupResponse() },
      {
        path: "/groups/group_1/ledger",
        status: 503,
        body: { error: "Ledger is temporarily unavailable." }
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } }
    ]);

    render(<App />);

    expect(await screen.findByText("Ledger is temporarily unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Current balances" })).toBeNull();
  });

  test("renders the ledger workspace when ledger data loads but /expenses fails", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups/group_1", body: buildGroupResponse() },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          expenses: [
            {
              id: "expense_1",
              groupId: "group_1",
              title: "House dinner",
              category: "food",
              splitMode: "equal",
              expenseDate: "2026-04-10",
              createdAt: "2026-04-10T08:00:00.000Z",
              updatedAt: "2026-04-10T08:00:00.000Z",
              createdBy: {
                id: "user_1",
                email: "owner@example.com",
                displayName: "Morgan"
              },
              payers: [{ userId: "user_2", amount: "24.00" }],
              shares: [
                { userId: "user_1", amount: "12.00" },
                { userId: "user_2", amount: "12.00" }
              ]
            }
          ],
          balances: [
            { userId: "user_1", balance: "12.00" },
            { userId: "user_2", balance: "-12.00" },
            { userId: "user_3", balance: "0.00" }
          ]
        })
      },
      {
        path: "/groups/group_1/expenses",
        status: 503,
        body: { error: "Legacy expenses are unavailable." }
      }
    ]);

    render(<App />);

    expect(await screen.findByText("House dinner")).toBeInTheDocument();
    expect(screen.getByText("Avery paid 24.00")).toBeInTheDocument();
    expect(screen.getByText("Morgan is owed 12.00")).toBeInTheDocument();
    expect(screen.getByText("Created by Morgan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit expense" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete expense" })).toBeInTheDocument();
    expect(screen.queryByText("Legacy expenses are unavailable.")).toBeNull();
  });

  test("shows a visible error when a ledger refresh fails", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups/group_1", body: buildGroupResponse() },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          balances: [
            { userId: "user_1", balance: "12.50" },
            { userId: "user_2", balance: "-7.50" },
            { userId: "user_3", balance: "-5.00" }
          ],
          settleUpSuggestions: [{ fromUserId: "user_2", toUserId: "user_1", amount: "7.50" }]
        })
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } },
      {
        method: "POST",
        path: "/groups/group_1/settlements",
        status: 201,
        body: {
          settlement: {
            id: "settlement_1",
            groupId: "group_1",
            fromUserId: "user_2",
            toUserId: "user_1",
            amount: "7.50",
            paidAt: "2026-04-12T08:45:00.000Z",
            createdByUserId: "user_1",
            createdAt: "2026-04-12T08:45:00.000Z",
            updatedAt: "2026-04-12T08:45:00.000Z"
          }
        }
      },
      {
        path: "/groups/group_1/ledger",
        status: 503,
        body: { error: "Unable to refresh the group ledger." }
      }
    ]);

    const user = userEvent.setup();
    render(<App />);

    const suggestions = await screen.findByRole("list", { name: "Settle-up suggestions" });
    await user.click(within(suggestions).getByRole("button", { name: "Mark paid" }));

    expect(await screen.findByText("Unable to refresh the group ledger.")).toBeInTheDocument();
    expect(screen.getByText("Morgan is owed 12.50")).toBeInTheDocument();
  });

  test("records a settle-up suggestion and refreshes the ledger history", async () => {
    const { requests } = installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups/group_1", body: buildGroupResponse() },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          balances: [
            { userId: "user_1", balance: "12.50" },
            { userId: "user_2", balance: "-7.50" },
            { userId: "user_3", balance: "-5.00" }
          ],
          settleUpSuggestions: [{ fromUserId: "user_2", toUserId: "user_1", amount: "7.50" }]
        })
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } },
      {
        method: "POST",
        path: "/groups/group_1/settlements",
        status: 201,
        body: {
          settlement: {
            id: "settlement_1",
            groupId: "group_1",
            fromUserId: "user_2",
            toUserId: "user_1",
            amount: "7.50",
            paidAt: "2026-04-12T08:45:00.000Z",
            createdByUserId: "user_1",
            createdAt: "2026-04-12T08:45:00.000Z",
            updatedAt: "2026-04-12T08:45:00.000Z"
          }
        }
      },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          balances: [
            { userId: "user_1", balance: "5.00" },
            { userId: "user_2", balance: "0.00" },
            { userId: "user_3", balance: "-5.00" }
          ],
          settleUpSuggestions: [{ fromUserId: "user_3", toUserId: "user_1", amount: "5.00" }],
          settlements: [
            {
              id: "settlement_1",
              groupId: "group_1",
              fromUserId: "user_2",
              toUserId: "user_1",
              amount: "7.50",
              paidAt: "2026-04-12T08:45:00.000Z",
              createdByUserId: "user_1",
              createdAt: "2026-04-12T08:45:00.000Z",
              updatedAt: "2026-04-12T08:45:00.000Z"
            }
          ]
        })
      },
      {
        path: "/groups/group_1/expenses",
        body: {
          expenses: [
            {
              id: "expense_1",
              groupId: "group_1",
              title: "House dinner",
              category: "food",
              splitMode: "equal",
              expenseDate: "2026-04-10",
              totalAmount: "24.00",
              createdAt: "2026-04-10T08:00:00.000Z",
              updatedAt: "2026-04-10T08:00:00.000Z",
              createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
              payers: [
                {
                  user: { id: "user_2", email: "member@example.com", displayName: "Avery" },
                  amountPaid: "24.00"
                }
              ]
            }
          ]
        }
      }
    ]);

    const user = userEvent.setup();
    render(<App />);

    const suggestions = await screen.findByRole("list", { name: "Settle-up suggestions" });
    await user.click(within(suggestions).getByRole("button", { name: "Mark paid" }));

    const settlementRequest = requests.find(
      (request) => request.method === "POST" && request.path === "/groups/group_1/settlements"
    );

    expect(settlementRequest?.body).toEqual({
      fromUserId: "user_2",
      toUserId: "user_1",
      amount: "7.50"
    });
    expect(await screen.findByText("Avery paid Morgan 7.50")).toBeInTheDocument();
    expect(screen.getByText("Jules owes 5.00")).toBeInTheDocument();
  });

  test("lets the owner remove a member and updates the active roster view", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups/group_1", body: buildGroupResponse() },
      { path: "/groups/group_1/ledger", body: buildLedgerResponse() },
      { path: "/groups/group_1/expenses", body: { expenses: [] } },
      {
        method: "POST",
        path: "/groups/group_1/members/user_2/remove",
        body: buildGroupResponse(["user_1", "user_3"])
      },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          members: [
            {
              id: "user_1",
              email: "owner@example.com",
              displayName: "Morgan",
              status: "active",
              leftAt: null
            },
            {
              id: "user_3",
              email: "third@example.com",
              displayName: "Jules",
              status: "active",
              leftAt: null
            }
          ],
          balances: [
            { userId: "user_1", balance: "0.00" },
            { userId: "user_3", balance: "0.00" }
          ]
        })
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } }
    ]);

    const user = userEvent.setup();
    render(<App />);

    const removeButtons = await screen.findAllByRole("button", { name: "Remove member" });
    await user.click(removeButtons[0]);

    expect(await screen.findByText("Member removed.")).toBeInTheDocument();
    expect(screen.queryByText("Avery")).toBeNull();
    expect(screen.getAllByText("Jules").length).toBeGreaterThan(0);
  });

  test("keeps expense rendering and edit hydration aligned with the ledger after member removal", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups/group_1", body: buildGroupResponse() },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          expenses: [
            {
              id: "expense_1",
              groupId: "group_1",
              title: "House dinner",
              category: "food",
              splitMode: "equal",
              expenseDate: "2026-04-10",
              createdAt: "2026-04-10T08:00:00.000Z",
              updatedAt: "2026-04-10T08:00:00.000Z",
              payers: [{ userId: "user_2", amount: "24.00" }],
              shares: [
                { userId: "user_1", amount: "12.00" },
                { userId: "user_2", amount: "12.00" }
              ]
            }
          ]
        })
      },
      {
        path: "/groups/group_1/expenses",
        body: {
          expenses: [
            {
              id: "expense_1",
              groupId: "group_1",
              title: "House dinner",
              category: "food",
              splitMode: "equal",
              expenseDate: "2026-04-10",
              totalAmount: "24.00",
              createdAt: "2026-04-10T08:00:00.000Z",
              updatedAt: "2026-04-10T08:00:00.000Z",
              createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
              payers: [
                {
                  user: { id: "user_2", email: "member@example.com", displayName: "Avery" },
                  amountPaid: "24.00"
                }
              ]
            }
          ]
        }
      },
      {
        method: "POST",
        path: "/groups/group_1/members/user_2/remove",
        body: buildGroupResponse(["user_1", "user_3"])
      },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          members: [
            {
              id: "user_1",
              email: "owner@example.com",
              displayName: "Morgan",
              status: "active",
              leftAt: null
            },
            {
              id: "user_3",
              email: "third@example.com",
              displayName: "Jules",
              status: "active",
              leftAt: null
            }
          ],
          expenses: [
            {
              id: "expense_1",
              groupId: "group_1",
              title: "House dinner",
              category: "food",
              splitMode: "equal",
              expenseDate: "2026-04-10",
              createdAt: "2026-04-10T08:00:00.000Z",
              updatedAt: "2026-04-10T09:00:00.000Z",
              payers: [
                { userId: "user_1", amount: "12.00" },
                { userId: "user_3", amount: "12.00" }
              ],
              shares: [
                { userId: "user_1", amount: "12.00" },
                { userId: "user_3", amount: "12.00" }
              ]
            }
          ]
        })
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } }
    ]);

    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Avery paid 24.00");
    const removeButtons = await screen.findAllByRole("button", { name: "Remove member" });
    await user.click(removeButtons[0]);

    expect(await screen.findByText("Member removed.")).toBeInTheDocument();
    expect(screen.queryByText("Avery paid 24.00")).toBeNull();
    expect(screen.getByText("Morgan paid 12.00")).toBeInTheDocument();
    expect(screen.getByText("Jules paid 12.00")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Edit expense" }));

    expect(screen.getByLabelText("Payer 1")).toHaveValue("user_1");
    expect(screen.getByLabelText("Amount paid by payer 1")).toHaveValue("12.00");
    expect(screen.getByLabelText("Payer 2")).toHaveValue("user_3");
    expect(screen.getByLabelText("Amount paid by payer 2")).toHaveValue("12.00");
  });

  test("keeps removed member names in settlement history after the active roster changes", async () => {
    installFetchMock([
      {
        path: "/auth/me",
        body: { user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" } }
      },
      { path: "/groups/group_1", body: buildGroupResponse() },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          settlements: [
            {
              id: "settlement_1",
              groupId: "group_1",
              fromUserId: "user_2",
              toUserId: "user_1",
              amount: "5.00",
              paidAt: "2026-04-10T09:30:00.000Z",
              createdByUserId: "user_1",
              createdAt: "2026-04-10T09:30:00.000Z",
              updatedAt: "2026-04-10T09:30:00.000Z"
            }
          ]
        })
      },
      { path: "/groups/group_1/expenses", body: { expenses: [] } },
      {
        method: "POST",
        path: "/groups/group_1/members/user_2/remove",
        body: buildGroupResponse(["user_1", "user_3"])
      },
      {
        path: "/groups/group_1/ledger",
        body: buildLedgerResponse({
          members: [
            {
              id: "user_1",
              email: "owner@example.com",
              displayName: "Morgan",
              status: "active",
              leftAt: null
            },
            {
              id: "user_3",
              email: "third@example.com",
              displayName: "Jules",
              status: "active",
              leftAt: null
            }
          ],
          settlements: [
            {
              id: "settlement_1",
              groupId: "group_1",
              fromUserId: "user_2",
              toUserId: "user_1",
              amount: "5.00",
              paidAt: "2026-04-10T09:30:00.000Z",
              createdByUserId: "user_1",
              createdAt: "2026-04-10T09:30:00.000Z",
              updatedAt: "2026-04-10T09:30:00.000Z"
            }
          ]
        })
      }
    ]);

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Avery paid Morgan 5.00")).toBeInTheDocument();

    const removeButtons = await screen.findAllByRole("button", { name: "Remove member" });
    await user.click(removeButtons[0]);

    expect(await screen.findByText("Member removed.")).toBeInTheDocument();
    expect(screen.getByText("Avery paid Morgan 5.00")).toBeInTheDocument();
    expect(screen.queryByText("user_2 paid Morgan 5.00")).toBeNull();
  });
});
