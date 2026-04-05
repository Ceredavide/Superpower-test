import type { Express } from "express";
import { z } from "zod";

import { createAuthHelpers } from "../../app/auth-helpers";
import {
  serializeExpense,
  serializeLedger,
  serializeLedgerSettlement
} from "../../app/serialize";
import { normalizeExpenseShares } from "../../core/lib/ledger";
import { moneyToCents, normalizeMoneyInput, sumMoney } from "../../core/lib/money";
import type {
  ExpenseParticipantInput,
  ExpensePayerInput,
  ExpenseSplitMode,
  Store
} from "../../store/types";

const expensePayerSchema = z.object({
  userId: z.string().min(1),
  amountPaid: z.string().trim().min(1)
});

const expenseParticipantSchema = z.object({
  userId: z.string().min(1),
  included: z.boolean().optional(),
  percentage: z.union([z.string().trim().min(1), z.number().finite()]).optional(),
  amountOwed: z.string().trim().min(1).optional()
});

const expenseSchema = z.object({
  title: z.string().trim().min(1),
  category: z.enum(["food", "transport", "housing", "entertainment", "other"]),
  splitMode: z.enum(["equal", "percentage", "exact"]),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payers: z.array(expensePayerSchema).min(1),
  participants: z.array(expenseParticipantSchema).min(1)
});

const settlementSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amount: z.string().trim().min(1)
});

class ExpenseValidationError extends Error {}

const EXPENSE_DATE_ERROR = "Expense date must be a real calendar date in YYYY-MM-DD format.";

type LedgerRouteDeps = {
  store: Store;
} & Pick<
  ReturnType<typeof createAuthHelpers>,
  "requireCompletedProfile" | "requireUser"
>;

type ExpenseParticipantRequestInput = {
  userId: string;
  included?: boolean;
  percentage?: string | number;
  amountOwed?: string;
};

function parseExpenseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new ExpenseValidationError(EXPENSE_DATE_ERROR);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ExpenseValidationError(EXPENSE_DATE_ERROR);
  }

  return parsed;
}

function signedMoneyToCents(value: string) {
  const trimmed = value.trim();
  const isNegative = trimmed.startsWith("-");
  const unsigned = isNegative ? trimmed.slice(1) : trimmed;

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(unsigned)) {
    throw new Error("Amounts must be positive numbers with up to 2 decimal places.");
  }

  const [whole, fraction = ""] = unsigned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  return isNegative ? -cents : cents;
}

export function registerLedgerRoutes(app: Express, deps: LedgerRouteDeps) {
  const { requireCompletedProfile, requireUser, store } = deps;

  if (!store.supportsExpenses()) {
    return;
  }

  async function validateExpensePayers(groupId: string, payers: ExpensePayerInput[]) {
    const seen = new Set<string>();
    const normalizedPayers: ExpensePayerInput[] = [];

    for (const payer of payers) {
      let normalizedAmount = "";

      try {
        normalizedAmount = normalizeMoneyInput(payer.amountPaid);
      } catch (error) {
        throw new ExpenseValidationError((error as Error).message);
      }

      if (seen.has(payer.userId)) {
        throw new ExpenseValidationError("Each payer can only appear once per expense.");
      }

      seen.add(payer.userId);

      if (!(await store.isGroupMember(groupId, payer.userId))) {
        throw new ExpenseValidationError("Each payer must be a current group member.");
      }

      normalizedPayers.push({
        userId: payer.userId,
        amountPaid: normalizedAmount
      });
    }

    return normalizedPayers;
  }

  async function validateExpenseParticipants(input: {
    groupId: string;
    viewerUserId: string;
    splitMode: ExpenseSplitMode;
    participants: ExpenseParticipantRequestInput[];
  }) {
    const group = await store.getGroupDetail(input.groupId, input.viewerUserId);

    if (!group) {
      throw new ExpenseValidationError("Group not found.");
    }

    const activeMemberIds = new Set(group.members.map((member) => member.id));
    const seen = new Set<string>();

    return input.participants.map((participant) => {
      if (seen.has(participant.userId)) {
        throw new ExpenseValidationError("Each participant can only appear once per expense.");
      }

      if (!activeMemberIds.has(participant.userId)) {
        throw new ExpenseValidationError("Each participant must be a current group member.");
      }

      seen.add(participant.userId);

      const included = participant.included ?? true;
      const hasSplitDetails =
        participant.percentage !== undefined || participant.amountOwed !== undefined;

      if (!included && hasSplitDetails) {
        throw new ExpenseValidationError("Excluded participants cannot include split details.");
      }

      const normalizedParticipant: ExpenseParticipantInput = {
        userId: participant.userId,
        included
      };

      if (participant.percentage !== undefined) {
        const percentage =
          typeof participant.percentage === "number"
            ? participant.percentage
            : Number(participant.percentage.trim());

        if (!Number.isFinite(percentage)) {
          throw new ExpenseValidationError("Percentages must be valid numbers.");
        }

        normalizedParticipant.percentage = percentage;
      }

      if (participant.amountOwed !== undefined) {
        normalizedParticipant.amountOwed = normalizeMoneyInput(participant.amountOwed);
      }

      return normalizedParticipant;
    });
  }

  async function buildRichExpenseInput(input: {
    groupId: string;
    viewerUserId: string;
    title: string;
    expenseDate: string;
    category: "food" | "transport" | "housing" | "entertainment" | "other";
    splitMode: ExpenseSplitMode;
    payers: ExpensePayerInput[];
    participants: ExpenseParticipantRequestInput[];
  }) {
    const expenseDate = parseExpenseDate(input.expenseDate);
    const normalizedPayers = await validateExpensePayers(input.groupId, input.payers);
    const normalizedParticipants = await validateExpenseParticipants({
      groupId: input.groupId,
      viewerUserId: input.viewerUserId,
      splitMode: input.splitMode,
      participants: input.participants
    });
    const totalAmount = sumMoney(normalizedPayers.map((payer) => payer.amountPaid));

    try {
      normalizeExpenseShares({
        splitMode: input.splitMode,
        total: totalAmount,
        participants: normalizedParticipants
      });
    } catch (error) {
      throw new ExpenseValidationError((error as Error).message);
    }

    return {
      title: input.title.trim(),
      category: input.category,
      splitMode: input.splitMode,
      expenseDate,
      payers: normalizedPayers,
      participants: normalizedParticipants
    };
  }

  app.get("/groups/:groupId/ledger", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const isMember = await store.isGroupMember(request.params.groupId, user.id);

    if (!isMember) {
      return response.status(403).json({ error: "Only group members can view the ledger." });
    }

    const ledger = await store.getLedger(request.params.groupId, user.id);

    if (!ledger) {
      return response.status(404).json({ error: "Group not found." });
    }

    return response.status(200).json(serializeLedger(ledger));
  });

  app.get("/groups/:groupId/expenses", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const isMember = await store.isGroupMember(request.params.groupId, user.id);

    if (!isMember) {
      return response.status(403).json({ error: "Only group members can view expenses." });
    }

    const expenses = await store.listExpensesForGroup(request.params.groupId);
    return response.status(200).json({ expenses: expenses.map(serializeExpense) });
  });

  app.post("/groups/:groupId/expenses", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    if (!requireCompletedProfile(user, response)) {
      return;
    }

    const isMember = await store.isGroupMember(request.params.groupId, user.id);

    if (!isMember) {
      return response.status(403).json({ error: "Only group members can add expenses." });
    }

    const parsed = expenseSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        error: "Enter a title, category, split mode, date, at least one payer, and participants."
      });
    }

    try {
      const expense = await store.createExpense({
        groupId: request.params.groupId,
        createdByUserId: user.id,
        ...(await buildRichExpenseInput({
          groupId: request.params.groupId,
          viewerUserId: user.id,
          ...parsed.data
        }))
      });

      return response.status(201).json({ expense: serializeExpense(expense) });
    } catch (error) {
      if (error instanceof ExpenseValidationError) {
        return response.status(400).json({ error: error.message });
      }

      throw error;
    }
  });

  app.patch("/expenses/:expenseId", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const expense = await store.findExpenseById(request.params.expenseId);

    if (!expense) {
      return response.status(404).json({ error: "Expense not found." });
    }

    if (expense.createdBy.id !== user.id) {
      return response.status(403).json({ error: "Only the creator can edit this expense." });
    }

    const parsed = expenseSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        error: "Enter a title, category, split mode, date, at least one payer, and participants."
      });
    }

    try {
      const updatedExpense = await store.updateExpense({
        expenseId: expense.id,
        ...(await buildRichExpenseInput({
          groupId: expense.groupId,
          viewerUserId: user.id,
          ...parsed.data
        }))
      });

      if (!updatedExpense) {
        return response.status(404).json({ error: "Expense not found." });
      }

      return response.status(200).json({ expense: serializeExpense(updatedExpense) });
    } catch (error) {
      if (error instanceof ExpenseValidationError) {
        return response.status(400).json({ error: error.message });
      }

      throw error;
    }
  });

  app.post("/groups/:groupId/settlements", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const isMember = await store.isGroupMember(request.params.groupId, user.id);

    if (!isMember) {
      return response.status(403).json({ error: "Only group members can record settlements." });
    }

    const parsed = settlementSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Enter who paid whom and a valid amount." });
    }

    try {
      const amount = normalizeMoneyInput(parsed.data.amount);
      const amountCents = moneyToCents(amount);

      if (parsed.data.fromUserId === parsed.data.toUserId) {
        throw new ExpenseValidationError("Settlement payer and payee must be different members.");
      }

      const ledger = await store.getLedger(request.params.groupId, user.id);

      if (!ledger) {
        return response.status(404).json({ error: "Group not found." });
      }

      const activeMemberIds = new Set(ledger.members.map((member) => member.id));

      if (
        !activeMemberIds.has(parsed.data.fromUserId) ||
        !activeMemberIds.has(parsed.data.toUserId)
      ) {
        throw new ExpenseValidationError("Settlements can only involve active group members.");
      }

      const balances = new Map(ledger.balances.map((balance) => [balance.userId, balance.balance]));
      const fromBalanceCents = signedMoneyToCents(balances.get(parsed.data.fromUserId) ?? "0.00");
      const toBalanceCents = signedMoneyToCents(balances.get(parsed.data.toUserId) ?? "0.00");
      const maxSettlementCents = Math.min(
        Math.max(-fromBalanceCents, 0),
        Math.max(toBalanceCents, 0)
      );

      if (amountCents > maxSettlementCents) {
        throw new ExpenseValidationError(
          "Settlement amount exceeds the current outstanding balance."
        );
      }

      const settlement = await store.createSettlement({
        groupId: request.params.groupId,
        fromUserId: parsed.data.fromUserId,
        toUserId: parsed.data.toUserId,
        amount,
        paidAt: new Date(),
        createdByUserId: user.id
      });

      return response.status(201).json({ settlement: serializeLedgerSettlement(settlement) });
    } catch (error) {
      if (error instanceof ExpenseValidationError) {
        return response.status(400).json({ error: error.message });
      }

      if ((error as Error).message === "Amounts must be positive numbers with up to 2 decimal places.") {
        return response.status(400).json({ error: (error as Error).message });
      }

      throw error;
    }
  });

  app.post("/groups/:groupId/members/:memberId/remove", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const isOwner = await store.isGroupOwner(request.params.groupId, user.id);

    if (!isOwner) {
      return response.status(403).json({ error: "Only group owners can remove members." });
    }

    const group = await store.getGroupDetail(request.params.groupId, user.id);

    if (!group) {
      return response.status(404).json({ error: "Group not found." });
    }

    if (!group.members.some((member) => member.id === request.params.memberId)) {
      return response.status(404).json({ error: "Member not found." });
    }

    if (group.members.length <= 1) {
      return response.status(400).json({ error: "You cannot remove the last active member." });
    }

    const updatedGroup = await store.removeGroupMember(
      request.params.groupId,
      request.params.memberId
    );

    if (!updatedGroup) {
      return response.status(400).json({ error: "Unable to remove that member." });
    }

    return response.status(200).json({ group: updatedGroup });
  });

  app.delete("/expenses/:expenseId", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const expense = await store.findExpenseById(request.params.expenseId);

    if (!expense) {
      return response.status(404).json({ error: "Expense not found." });
    }

    const isActiveMember = await store.isGroupMember(expense.groupId, user.id);

    if (!isActiveMember) {
      return response.status(403).json({ error: "Only active group members can delete this expense." });
    }

    if (expense.createdBy.id !== user.id) {
      return response.status(403).json({ error: "Only the creator can delete this expense." });
    }

    await store.deleteExpense(expense.id);
    return response.status(204).send();
  });
}
