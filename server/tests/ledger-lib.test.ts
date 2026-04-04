import { describe, expect, test } from "vitest";

import {
  deriveBalances,
  normalizeExpenseShares,
  redistributeDepartedMemberExpense,
  suggestSettlements
} from "../src/lib/ledger";
import type { CreateExpenseInput, UpdateExpenseInput } from "../src/store/types";

describe("ledger math helpers", () => {
  test("exposes richer create and update expense contracts", () => {
    const createInput: CreateExpenseInput = {
      groupId: "group_1",
      createdByUserId: "user_1",
      title: "Dinner",
      expenseDate: new Date("2026-04-03T00:00:00.000Z"),
      category: "food",
      splitMode: "equal",
      participants: [
        { userId: "user_1", included: true },
        { userId: "user_2", included: true }
      ],
      payers: [{ userId: "user_1", amountPaid: "20.00" }]
    };

    const updateInput: UpdateExpenseInput = {
      expenseId: "expense_1",
      title: "Updated dinner",
      expenseDate: new Date("2026-04-04T00:00:00.000Z"),
      category: "transport",
      splitMode: "exact",
      participants: [
        { userId: "user_1", included: true, amountOwed: "12.50" },
        { userId: "user_2", included: true, amountOwed: "7.50" }
      ],
      payers: [
        { userId: "user_1", amountPaid: "12.50" },
        { userId: "user_2", amountPaid: "7.50" }
      ]
    };

    expect(createInput.participants).toHaveLength(2);
    expect(updateInput.participants[1].amountOwed).toBe("7.50");
  });

  test("normalizes split-mode participants into owed shares", () => {
    expect(
      normalizeExpenseShares({
        splitMode: "equal",
        totalCents: 101,
        participants: [
          { userId: "member_a", included: true },
          { userId: "member_b", included: true },
          { userId: "member_c", included: true }
        ]
      })
    ).toEqual([
      { userId: "member_a", amountCents: 34 },
      { userId: "member_b", amountCents: 34 },
      { userId: "member_c", amountCents: 33 }
    ]);

    expect(
      normalizeExpenseShares({
        splitMode: "equal",
        totalCents: 100,
        participants: [
          { userId: "member_a", included: true },
          { userId: "member_b", included: false },
          { userId: "member_c", included: true }
        ]
      })
    ).toEqual([
      { userId: "member_a", amountCents: 50 },
      { userId: "member_c", amountCents: 50 }
    ]);
  });

  test("normalizes percentage and exact splits from participant input", () => {
    expect(
      normalizeExpenseShares({
        splitMode: "percentage",
        totalCents: 100,
        participants: [
          { userId: "member_a", included: true, percentage: 33.4 },
          { userId: "member_b", included: true, percentage: 33.3 },
          { userId: "member_c", included: true, percentage: 33.3 }
        ]
      })
    ).toEqual([
      { userId: "member_a", amountCents: 34 },
      { userId: "member_b", amountCents: 33 },
      { userId: "member_c", amountCents: 33 }
    ]);

    expect(() =>
      normalizeExpenseShares({
        splitMode: "percentage",
        totalCents: 100,
        participants: [
          { userId: "member_a", included: true, percentage: 60 },
          { userId: "member_b", included: true, percentage: 30 }
        ]
      })
    ).toThrow("Percentages must sum to exactly 100.");

    expect(
      normalizeExpenseShares({
        splitMode: "exact",
        totalCents: 20000,
        participants: [
          { userId: "member_a", included: true, amountOwed: "125.00" },
          { userId: "member_b", included: true, amountOwed: "75.00" }
        ]
      })
    ).toEqual([
      { userId: "member_a", amountCents: 12500 },
      { userId: "member_b", amountCents: 7500 }
    ]);
  });

  test("derives balances from payer rows, owed shares, and settlements", () => {
    expect(
      deriveBalances({
        memberIds: ["member_a", "member_b", "member_c"],
        expenses: [
          {
            payers: [
              { userId: "member_a", amountCents: 1000 },
              { userId: "member_b", amountCents: 500 }
            ],
            shares: [
              { userId: "member_a", amountCents: 500 },
              { userId: "member_b", amountCents: 500 }
            ]
          }
        ],
        settlements: [
          {
            fromUserId: "member_b",
            toUserId: "member_a",
            amountCents: 200
          }
        ]
      })
    ).toEqual([
      { userId: "member_a", balanceCents: 700 },
      { userId: "member_b", balanceCents: -200 },
      { userId: "member_c", balanceCents: 0 }
    ]);
  });

  test("suggests settle-up transfers with greedy debtor-creditor matching", () => {
    expect(
      suggestSettlements([
        { userId: "member_a", balanceCents: 700 },
        { userId: "member_b", balanceCents: -200 },
        { userId: "member_c", balanceCents: -500 }
      ])
    ).toEqual([
      { fromUserId: "member_c", toUserId: "member_a", amountCents: 500 },
      { fromUserId: "member_b", toUserId: "member_a", amountCents: 200 }
    ]);
  });

  test("redistributes a departed member's expense-level payer and share effects", () => {
    expect(
      redistributeDepartedMemberExpense(
        {
          payers: [
            { userId: "member_a", amountCents: 20 },
            { userId: "member_departed", amountCents: 10 }
          ],
          shares: [
            { userId: "member_a", amountCents: 20 },
            { userId: "member_departed", amountCents: 10 }
          ]
        },
        "member_departed",
        ["member_a", "member_b"]
      )
    ).toEqual({
      payers: [
        { userId: "member_a", amountCents: 25 },
        { userId: "member_b", amountCents: 5 }
      ],
      shares: [
        { userId: "member_a", amountCents: 25 },
        { userId: "member_b", amountCents: 5 }
      ]
    });
  });
});
