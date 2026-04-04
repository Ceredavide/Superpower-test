import { moneyToCents } from "./money";

import type { ExpenseParticipantInput, ExpenseSplitMode } from "../store/types";

export type LedgerEntry = {
  userId: string;
  amountCents: number;
};

export type NormalizeExpenseSharesInput = {
  splitMode: ExpenseSplitMode;
  totalCents: number;
  participants: ExpenseParticipantInput[];
};

export type ExpenseLedgerInput = {
  payers: LedgerEntry[];
  shares: LedgerEntry[];
};

export type SettlementLedgerInput = {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
};

export type DeriveBalancesInput = {
  memberIds: string[];
  expenses: ExpenseLedgerInput[];
  settlements: SettlementLedgerInput[];
};

export type BalanceSummary = {
  userId: string;
  balanceCents: number;
};

export type SettlementSuggestion = {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
};

const PERCENTAGE_SUM_TOLERANCE = 1e-9;

export function normalizeEqualSplit(totalCents: number, memberIds: string[]) {
  if (memberIds.length === 0) {
    return [];
  }

  const baseAmount = Math.floor(totalCents / memberIds.length);
  const remainder = totalCents % memberIds.length;

  return memberIds.map((userId, index) => ({
    userId,
    amountCents: baseAmount + (index < remainder ? 1 : 0)
  }));
}

export function normalizePercentageSplit(totalCents: number, entries: { userId: string; percentage: number }[]) {
  const percentageTotal = entries.reduce((total, entry) => total + entry.percentage, 0);

  if (Math.abs(percentageTotal - 100) > PERCENTAGE_SUM_TOLERANCE) {
    throw new Error("Percentages must sum to exactly 100.");
  }

  const baseAmounts = entries.map((entry) => Math.floor((totalCents * entry.percentage) / 100));
  const remainder = totalCents - baseAmounts.reduce((total, amount) => total + amount, 0);

  return entries.map((entry, index) => ({
    userId: entry.userId,
    amountCents: baseAmounts[index] + (index < remainder ? 1 : 0)
  }));
}

function normalizeExactSplit(
  totalCents: number,
  entries: { userId: string; amountOwed?: string }[]
) {
  const normalizedEntries = entries.map((entry) => {
    if (!entry.amountOwed) {
      throw new Error("Exact split participants must include amountOwed.");
    }

    return {
      userId: entry.userId,
      amountCents: moneyToCents(entry.amountOwed)
    };
  });

  const totalShareCents = normalizedEntries.reduce((total, entry) => total + entry.amountCents, 0);

  if (totalShareCents !== totalCents) {
    throw new Error("Exact split amounts must sum to the expense total.");
  }

  return normalizedEntries;
}

export function normalizeExpenseShares(input: NormalizeExpenseSharesInput) {
  const includedParticipants = input.participants.filter((participant) => participant.included);

  if (includedParticipants.length === 0) {
    throw new Error("At least one participant must be included.");
  }

  if (input.splitMode === "equal") {
    return normalizeEqualSplit(
      input.totalCents,
      includedParticipants.map((participant) => participant.userId)
    );
  }

  if (input.splitMode === "percentage") {
    return normalizePercentageSplit(
      input.totalCents,
      includedParticipants.map((participant) => {
        if (participant.percentage === undefined) {
          throw new Error("Percentage split participants must include percentage.");
        }

        return {
          userId: participant.userId,
          percentage: participant.percentage
        };
      })
    );
  }

  return normalizeExactSplit(
    input.totalCents,
    includedParticipants.map((participant) => ({
      userId: participant.userId,
      amountOwed: participant.amountOwed
    }))
  );
}

export function deriveBalances(input: DeriveBalancesInput): BalanceSummary[] {
  const balances = new Map<string, number>();

  for (const memberId of input.memberIds) {
    balances.set(memberId, 0);
  }

  const adjustBalance = (userId: string, amountCents: number) => {
    balances.set(userId, (balances.get(userId) ?? 0) + amountCents);
  };

  for (const expense of input.expenses) {
    for (const payer of expense.payers) {
      adjustBalance(payer.userId, payer.amountCents);
    }

    for (const share of expense.shares) {
      adjustBalance(share.userId, -share.amountCents);
    }
  }

  for (const settlement of input.settlements) {
    adjustBalance(settlement.fromUserId, -settlement.amountCents);
    adjustBalance(settlement.toUserId, settlement.amountCents);
  }

  return Array.from(balances.entries()).map(([userId, balanceCents]) => ({
    userId,
    balanceCents
  }));
}

export function suggestSettlements(balances: BalanceSummary[]): SettlementSuggestion[] {
  const workingBalances = balances
    .map((balance, index) => ({
      ...balance,
      index
    }))
    .filter((balance) => balance.balanceCents !== 0);

  const suggestions: SettlementSuggestion[] = [];

  while (true) {
    const creditors = workingBalances
      .filter((balance) => balance.balanceCents > 0)
      .sort((left, right) => {
        if (right.balanceCents !== left.balanceCents) {
          return right.balanceCents - left.balanceCents;
        }

        return left.index - right.index;
      });
    const debtors = workingBalances
      .filter((balance) => balance.balanceCents < 0)
      .sort((left, right) => {
        if (left.balanceCents !== right.balanceCents) {
          return left.balanceCents - right.balanceCents;
        }

        return left.index - right.index;
      });

    if (creditors.length === 0 || debtors.length === 0) {
      break;
    }

    const creditor = creditors[0];
    const debtor = debtors[0];
    const amountCents = Math.min(creditor.balanceCents, Math.abs(debtor.balanceCents));

    suggestions.push({
      fromUserId: debtor.userId,
      toUserId: creditor.userId,
      amountCents
    });

    creditor.balanceCents -= amountCents;
    debtor.balanceCents += amountCents;
  }

  return suggestions;
}

export function redistributeDepartedMemberEntries(
  entries: LedgerEntry[],
  departedUserId: string,
  activeMemberIds: string[]
) {
  if (activeMemberIds.length === 0) {
    throw new Error("At least one active member is required.");
  }

  const amountsByUser = new Map<string, number>();

  for (const userId of activeMemberIds) {
    amountsByUser.set(userId, 0);
  }

  let departedAmountCents = 0;

  for (const entry of entries) {
    if (entry.userId === departedUserId) {
      departedAmountCents += entry.amountCents;
      continue;
    }

    if (amountsByUser.has(entry.userId)) {
      amountsByUser.set(entry.userId, (amountsByUser.get(entry.userId) ?? 0) + entry.amountCents);
    }
  }

  const redistributed = normalizeEqualSplit(departedAmountCents, activeMemberIds);

  for (const entry of redistributed) {
    amountsByUser.set(entry.userId, (amountsByUser.get(entry.userId) ?? 0) + entry.amountCents);
  }

  return activeMemberIds.map((userId) => ({
    userId,
    amountCents: amountsByUser.get(userId) ?? 0
  }));
}

export function redistributeDepartedMemberExpense(
  expense: ExpenseLedgerInput,
  departedUserId: string,
  activeMemberIds: string[]
) {
  return {
    payers: redistributeDepartedMemberEntries(expense.payers, departedUserId, activeMemberIds),
    shares: redistributeDepartedMemberEntries(expense.shares, departedUserId, activeMemberIds)
  };
}
