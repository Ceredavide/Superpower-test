import { centsToMoney, moneyToCents } from "./money";

import type { ExpenseParticipantInput, ExpenseSplitMode } from "../store/types";

export type LedgerEntry = {
  userId: string;
  amountCents: number;
};

export type NormalizeExpenseSharesInput = {
  splitMode: ExpenseSplitMode;
  total: string;
  participants: ExpenseParticipantInput[];
};

export type ExpenseLedgerInput = {
  payers: Array<{
    userId: string;
    amount: string;
  }>;
  shares: Array<{
    userId: string;
    amount: string;
  }>;
};

export type SettlementLedgerInput = {
  fromUserId: string;
  toUserId: string;
  amount: string;
};

export type DeriveBalancesInput = {
  memberIds: string[];
  expenses: ExpenseLedgerInput[];
  settlements: SettlementLedgerInput[];
};

export type BalanceSummary = {
  userId: string;
  balance: string;
};

const PERCENTAGE_SUM_TOLERANCE = 1e-9;

type MoneyAmount = {
  userId: string;
  amount: string;
};

type MoneyBalance = {
  userId: string;
  balance: string;
};

type MoneySettlementSuggestion = {
  fromUserId: string;
  toUserId: string;
  amount: string;
};

function signedMoneyToCents(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith("-")) {
    return -moneyToCents(trimmed.slice(1));
  }

  return moneyToCents(trimmed);
}

function normalizeEqualSplitCents(totalCents: number, memberIds: string[]) {
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

function normalizePercentageSplitCents(
  totalCents: number,
  entries: { userId: string; percentage: number }[]
) {
  for (const entry of entries) {
    if (entry.percentage < 0 || entry.percentage > 100) {
      throw new Error("Each percentage must be between 0 and 100.");
    }
  }

  const percentageTotal = entries.reduce((total, entry) => total + entry.percentage, 0);

  if (Math.abs(percentageTotal - 100) > PERCENTAGE_SUM_TOLERANCE) {
    throw new Error("Percentages must sum to exactly 100.");
  }

  const rankedEntries = entries.map((entry, index) => {
    const rawAmount = (totalCents * entry.percentage) / 100;
    const amountCents = Math.floor(rawAmount);

    return {
      userId: entry.userId,
      amountCents,
      fractionalRemainder: rawAmount - amountCents,
      index
    };
  });

  let remainder = totalCents - rankedEntries.reduce((total, entry) => total + entry.amountCents, 0);

  const orderedEntries = [...rankedEntries].sort((left, right) => {
    if (right.fractionalRemainder !== left.fractionalRemainder) {
      return right.fractionalRemainder - left.fractionalRemainder;
    }

    return left.index - right.index;
  });

  for (let index = 0; remainder > 0; index += 1) {
    orderedEntries[index % orderedEntries.length].amountCents += 1;
    remainder -= 1;
  }

  return [...rankedEntries]
    .sort((left, right) => left.index - right.index)
    .map((entry) => ({
      userId: entry.userId,
      amountCents:
        orderedEntries.find((candidate) => candidate.index === entry.index)?.amountCents ?? entry.amountCents
    }));
}

function normalizeExactSplitCents(
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

export function normalizeExpenseShares(input: NormalizeExpenseSharesInput): MoneyAmount[] {
  const totalCents = moneyToCents(input.total);
  const includedParticipants = input.participants.filter((participant) => participant.included);

  if (includedParticipants.length === 0) {
    throw new Error("At least one participant must be included.");
  }

  if (input.splitMode === "equal") {
    return normalizeEqualSplitCents(totalCents, includedParticipants.map((participant) => participant.userId)).map(
      (entry) => ({
        userId: entry.userId,
        amount: centsToMoney(entry.amountCents)
      })
    );
  }

  if (input.splitMode === "percentage") {
    return normalizePercentageSplitCents(
      totalCents,
      includedParticipants.map((participant) => {
        if (participant.percentage === undefined) {
          throw new Error("Percentage split participants must include percentage.");
        }

        return {
          userId: participant.userId,
          percentage: participant.percentage
        };
      })
    ).map((entry) => ({
      userId: entry.userId,
      amount: centsToMoney(entry.amountCents)
    }));
  }

  return normalizeExactSplitCents(
    totalCents,
    includedParticipants.map((participant) => ({
      userId: participant.userId,
      amountOwed: participant.amountOwed
    }))
  ).map((entry) => ({
    userId: entry.userId,
    amount: centsToMoney(entry.amountCents)
  }));
}

export function deriveBalances(input: DeriveBalancesInput): MoneyBalance[] {
  const balances = new Map<string, number>();

  for (const memberId of input.memberIds) {
    balances.set(memberId, 0);
  }

  const adjustBalance = (userId: string, amountCents: number) => {
    balances.set(userId, (balances.get(userId) ?? 0) + amountCents);
  };

  for (const expense of input.expenses) {
    for (const payer of expense.payers) {
      adjustBalance(payer.userId, moneyToCents(payer.amount));
    }

    for (const share of expense.shares) {
      adjustBalance(share.userId, -moneyToCents(share.amount));
    }
  }

  for (const settlement of input.settlements) {
    const amountCents = moneyToCents(settlement.amount);
    adjustBalance(settlement.fromUserId, -amountCents);
    adjustBalance(settlement.toUserId, amountCents);
  }

  return Array.from(balances.entries()).map(([userId, balanceCents]) => ({
    userId,
    balance: centsToMoney(balanceCents)
  }));
}

export function suggestSettlements(balances: MoneyBalance[]): MoneySettlementSuggestion[] {
  const workingBalances = balances
    .map((balance, index) => ({
      ...balance,
      balanceCents: signedMoneyToCents(balance.balance),
      index
    }))
    .filter((balance) => balance.balanceCents !== 0);

  const totalBalanceCents = workingBalances.reduce((total, balance) => total + balance.balanceCents, 0);

  if (totalBalanceCents !== 0) {
    throw new Error("Balances must sum to zero before suggesting settlements.");
  }

  const suggestions: MoneySettlementSuggestion[] = [];

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
      amount: centsToMoney(amountCents)
    });

    creditor.balanceCents -= amountCents;
    debtor.balanceCents += amountCents;
  }

  return suggestions;
}

function redistributeDepartedMemberEntries(
  entries: LedgerEntry[],
  departedUserId: string,
  activeMemberIds: string[]
) {
  if (activeMemberIds.length === 0) {
    throw new Error("At least one active member is required.");
  }

  const amountsByUser = new Map<string, number>();
  const allowedUserIds = new Set([departedUserId, ...activeMemberIds]);

  for (const userId of activeMemberIds) {
    amountsByUser.set(userId, 0);
  }

  let departedAmountCents = 0;

  for (const entry of entries) {
    if (!allowedUserIds.has(entry.userId)) {
      throw new Error("Redistribution input can only contain the departed member and active members.");
    }

    if (entry.userId === departedUserId) {
      departedAmountCents += entry.amountCents;
      continue;
    }

    if (amountsByUser.has(entry.userId)) {
      amountsByUser.set(entry.userId, (amountsByUser.get(entry.userId) ?? 0) + entry.amountCents);
    }
  }

  const redistributed = normalizeEqualSplitCents(departedAmountCents, activeMemberIds);

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
    payers: redistributeDepartedMemberEntries(
      expense.payers.map((entry) => ({
        userId: entry.userId,
        amountCents: moneyToCents(entry.amount)
      })),
      departedUserId,
      activeMemberIds
    ).map((entry) => ({
      userId: entry.userId,
      amount: centsToMoney(entry.amountCents)
    })),
    shares: redistributeDepartedMemberEntries(
      expense.shares.map((entry) => ({
        userId: entry.userId,
        amountCents: moneyToCents(entry.amount)
      })),
      departedUserId,
      activeMemberIds
    ).map((entry) => ({
      userId: entry.userId,
      amount: centsToMoney(entry.amountCents)
    }))
  };
}
