import { describe, expect, test } from "vitest";

import {
  deriveBalances,
  normalizeEqualSplit,
  normalizePercentageSplit,
  redistributeDepartedMemberEntries,
  suggestSettlements
} from "../src/lib/ledger";

describe("ledger math helpers", () => {
  test("normalizes equal splits with deterministic remainder cents", () => {
    expect(normalizeEqualSplit(100, ["member_a", "member_b", "member_c"])).toEqual([
      { userId: "member_a", amountCents: 34 },
      { userId: "member_b", amountCents: 33 },
      { userId: "member_c", amountCents: 33 }
    ]);
  });

  test("normalizes percentage splits and rejects totals other than 100", () => {
    expect(
      normalizePercentageSplit(100, [
        { userId: "member_a", percentage: 33.4 },
        { userId: "member_b", percentage: 33.3 },
        { userId: "member_c", percentage: 33.3 }
      ])
    ).toEqual([
      { userId: "member_a", amountCents: 34 },
      { userId: "member_b", amountCents: 33 },
      { userId: "member_c", amountCents: 33 }
    ]);

    expect(() =>
      normalizePercentageSplit(100, [
        { userId: "member_a", percentage: 60 },
        { userId: "member_b", percentage: 30 }
      ])
    ).toThrow("Percentages must sum to exactly 100.");
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

  test("redistributes a departed member's payer and share effects across active members", () => {
    expect(
      redistributeDepartedMemberEntries(
        [
          { userId: "member_a", amountCents: 20 },
          { userId: "member_departed", amountCents: 10 }
        ],
        "member_departed",
        ["member_a", "member_b"]
      )
    ).toEqual([
      { userId: "member_a", amountCents: 25 },
      { userId: "member_b", amountCents: 5 }
    ]);
  });
});
