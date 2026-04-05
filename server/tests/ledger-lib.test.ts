import { describe, expect, test } from "vitest";

import {
  deriveBalances,
  normalizeExpenseShares,
  redistributeDepartedMemberExpense,
  suggestSettlements
} from "../src/core/lib/ledger";
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
        total: "1.01",
        participants: [
          { userId: "member_a", included: true },
          { userId: "member_b", included: true },
          { userId: "member_c", included: true }
        ]
      })
    ).toEqual([
      { userId: "member_a", amount: "0.34" },
      { userId: "member_b", amount: "0.34" },
      { userId: "member_c", amount: "0.33" }
    ]);

    expect(
      normalizeExpenseShares({
        splitMode: "equal",
        total: "1.00",
        participants: [
          { userId: "member_a", included: true },
          { userId: "member_b", included: false },
          { userId: "member_c", included: true }
        ]
      })
    ).toEqual([
      { userId: "member_a", amount: "0.50" },
      { userId: "member_c", amount: "0.50" }
    ]);
  });

  test("normalizes percentage and exact splits from participant input", () => {
    expect(
      normalizeExpenseShares({
        splitMode: "percentage",
        total: "1.00",
        participants: [
          { userId: "member_a", included: true, percentage: 33.4 },
          { userId: "member_b", included: true, percentage: 33.3 },
          { userId: "member_c", included: true, percentage: 33.3 }
        ]
      })
    ).toEqual([
      { userId: "member_a", amount: "0.34" },
      { userId: "member_b", amount: "0.33" },
      { userId: "member_c", amount: "0.33" }
    ]);

    expect(() =>
      normalizeExpenseShares({
        splitMode: "percentage",
        total: "1.00",
        participants: [
          { userId: "member_a", included: true, percentage: 60 },
          { userId: "member_b", included: true, percentage: 30 }
        ]
      })
    ).toThrow("Percentages must sum to exactly 100.");

    expect(
      normalizeExpenseShares({
        splitMode: "exact",
        total: "200.00",
        participants: [
          { userId: "member_a", included: true, amountOwed: "125.00" },
          { userId: "member_b", included: true, amountOwed: "75.00" }
        ]
      })
    ).toEqual([
      { userId: "member_a", amount: "125.00" },
      { userId: "member_b", amount: "75.00" }
    ]);
  });

  test("gives leftover percentage cents to the largest fractional remainder", () => {
    expect(
      normalizeExpenseShares({
        splitMode: "percentage",
        total: "0.01",
        participants: [
          { userId: "member_a", included: true, percentage: 10 },
          { userId: "member_b", included: true, percentage: 90 }
        ]
      })
    ).toEqual([
      { userId: "member_a", amount: "0.00" },
      { userId: "member_b", amount: "0.01" }
    ]);
  });

  test("rejects invalid individual percentage values", () => {
    expect(() =>
      normalizeExpenseShares({
        splitMode: "percentage",
        total: "1.00",
        participants: [
          { userId: "member_a", included: true, percentage: -10 },
          { userId: "member_b", included: true, percentage: 110 }
        ]
      })
    ).toThrow("Each percentage must be between 0 and 100.");
  });

  test("derives balances from payer rows, owed shares, and settlements", () => {
    expect(
      deriveBalances({
        memberIds: ["member_a", "member_b", "member_c"],
        expenses: [
          {
            payers: [
              { userId: "member_a", amount: "10.00" },
              { userId: "member_b", amount: "5.00" }
            ],
            shares: [
              { userId: "member_a", amount: "5.00" },
              { userId: "member_b", amount: "5.00" }
            ]
          }
        ],
        settlements: [
          {
            fromUserId: "member_b",
            toUserId: "member_a",
            amount: "2.00"
          }
        ]
      })
    ).toEqual([
      { userId: "member_a", balance: "7.00" },
      { userId: "member_b", balance: "-2.00" },
      { userId: "member_c", balance: "0.00" }
    ]);
  });

  test("suggests settle-up transfers with greedy debtor-creditor matching", () => {
    expect(
      suggestSettlements([
        { userId: "member_a", balance: "7.00" },
        { userId: "member_b", balance: "-2.00" },
        { userId: "member_c", balance: "-5.00" }
      ])
    ).toEqual([
      { fromUserId: "member_c", toUserId: "member_a", amount: "5.00" },
      { fromUserId: "member_b", toUserId: "member_a", amount: "2.00" }
    ]);
  });

  test("rejects settle-up inputs that do not net to zero", () => {
    expect(() =>
      suggestSettlements([
        { userId: "member_a", balance: "7.00" },
        { userId: "member_b", balance: "-1.00" }
      ])
    ).toThrow("Balances must sum to zero before suggesting settlements.");
  });

  test("redistributes a departed member's expense-level payer and share effects", () => {
    expect(
      redistributeDepartedMemberExpense(
        {
          payers: [
            { userId: "member_a", amount: "0.20" },
            { userId: "member_departed", amount: "0.10" }
          ],
          shares: [
            { userId: "member_a", amount: "0.20" },
            { userId: "member_departed", amount: "0.10" }
          ]
        },
        "member_departed",
        ["member_a", "member_b"]
      )
    ).toEqual({
      payers: [
        { userId: "member_a", amount: "0.25" },
        { userId: "member_b", amount: "0.05" }
      ],
      shares: [
        { userId: "member_a", amount: "0.25" },
        { userId: "member_b", amount: "0.05" }
      ]
    });
  });

  test("rejects redistribution entries for unknown active members", () => {
    expect(() =>
      redistributeDepartedMemberExpense(
        {
          payers: [
            { userId: "member_a", amount: "0.20" },
            { userId: "member_other", amount: "0.10" },
            { userId: "member_departed", amount: "0.10" }
          ],
          shares: [
            { userId: "member_a", amount: "0.20" },
            { userId: "member_other", amount: "0.10" },
            { userId: "member_departed", amount: "0.10" }
          ]
        },
        "member_departed",
        ["member_a", "member_b"]
      )
    ).toThrow("Redistribution input can only contain the departed member and active members.");
  });
});
