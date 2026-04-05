import fs from "node:fs";
import path from "node:path";

import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { z } from "zod";

import { normalizeExpenseShares } from "./lib/ledger";
import { moneyToCents, normalizeMoneyInput, sumMoney } from "./lib/money";
import { createSessionToken, hashSessionToken } from "./lib/session";
import type {
  ExpenseParticipantInput,
  ExpensePayerInput,
  ExpenseSplitMode,
  GroupExpense,
  GroupLedger,
  LedgerSettlement,
  Store,
  StoredUser
} from "./store/types";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = registerSchema;

const profileSchema = z.object({
  displayName: z.string().trim().min(1)
});

const groupSchema = z.object({
  name: z.string().trim().min(1)
});

const invitationSchema = z.object({
  identifier: z.string().trim().min(1)
});

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

const legacyExpenseSchema = z.object({
  title: z.string().trim().min(1),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payers: z.array(expensePayerSchema).min(1)
});

const settlementSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amount: z.string().trim().min(1)
});

class ExpenseValidationError extends Error {}
const EXPENSE_DATE_ERROR = "Expense date must be a real calendar date in YYYY-MM-DD format.";

type CreateAppOptions = {
  store: Store;
  sessionCookieName?: string;
  sessionTtlDays?: number;
  clientOrigin?: string;
  staticAssetsPath?: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(displayName: string) {
  return displayName.trim().toLowerCase();
}

function serializeUser(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName
  };
}

function serializeExpense(expense: GroupExpense) {
  return {
    ...expense,
    expenseDate: expense.expenseDate.toISOString().slice(0, 10),
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString()
  };
}

function serializeLedgerSettlement(settlement: LedgerSettlement) {
  return {
    ...settlement,
    paidAt: settlement.paidAt.toISOString(),
    createdAt: settlement.createdAt.toISOString(),
    updatedAt: settlement.updatedAt.toISOString()
  };
}

function serializeLedger(ledger: GroupLedger) {
  return {
    groupId: ledger.groupId,
    members: ledger.members.map((member) => ({
      ...member,
      leftAt: member.leftAt ? member.leftAt.toISOString() : null
    })),
    expenses: ledger.expenses.map((expense) => ({
      ...expense,
      expenseDate: expense.expenseDate.toISOString().slice(0, 10),
      createdAt: expense.createdAt.toISOString(),
      updatedAt: expense.updatedAt.toISOString()
    })),
    balances: ledger.balances,
    settleUpSuggestions: ledger.settleUpSuggestions,
    settlements: ledger.settlements.map(serializeLedgerSettlement)
  };
}

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

function hasAnyRichExpenseField(body: unknown) {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as Record<string, unknown>;

  return (
    "category" in candidate ||
    "splitMode" in candidate ||
    "participants" in candidate
  );
}

export function createApp({
  store,
  sessionCookieName = "expense_groups_session",
  sessionTtlDays = 30,
  clientOrigin = "http://localhost:5173",
  staticAssetsPath
}: CreateAppOptions) {
  const app = express();

  app.use(
    cors({
      origin: clientOrigin,
      credentials: true
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  async function getAuthenticatedUser(cookieValue?: string | null) {
    if (!cookieValue) {
      return null;
    }

    const session = await store.findSessionByTokenHash(hashSessionToken(cookieValue));

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return store.findUserById(session.userId);
  }

  function getRawSessionToken(request: express.Request) {
    return request.cookies[sessionCookieName] as string | undefined;
  }

  async function requireUser(request: express.Request, response: express.Response) {
    const user = await getAuthenticatedUser(getRawSessionToken(request));

    if (!user) {
      response.status(401).json({ error: "You must be logged in to do that." });
      return null;
    }

    return user;
  }

  function requireCompletedProfile(user: StoredUser, response: express.Response) {
    if (!user.displayName) {
      response.status(403).json({ error: "Finish your profile before doing that." });
      return false;
    }

    return true;
  }

  async function createSession(userId: string) {
    const rawToken = createSessionToken();
    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000);

    await store.createSession({
      userId,
      tokenHash: hashSessionToken(rawToken),
      expiresAt
    });

    return { rawToken, expiresAt };
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
    participants: Array<{
      userId: string;
      included?: boolean;
      percentage?: string | number;
      amountOwed?: string;
    }>;
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
    participants: Array<{
      userId: string;
      included?: boolean;
      percentage?: string | number;
      amountOwed?: string;
    }>;
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

  app.post("/auth/register", async (request, response) => {
    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Enter a valid email and an 8+ character password." });
    }

    const email = normalizeEmail(parsed.data.email);
    const existingUser = await store.findUserByEmail(email);

    if (existingUser) {
      return response.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const user = await store.createUser({ email, passwordHash });
    const session = await createSession(user.id);

    response.cookie(sessionCookieName, session.rawToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      expires: session.expiresAt
    });

    return response.status(201).json({ user: serializeUser(user) });
  });

  app.post("/auth/login", async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Enter a valid email and an 8+ character password." });
    }

    const email = normalizeEmail(parsed.data.email);
    const user = await store.findUserByEmail(email);

    if (!user) {
      return response.status(401).json({ error: "Invalid email or password." });
    }

    const matches = await bcrypt.compare(parsed.data.password, user.passwordHash);

    if (!matches) {
      return response.status(401).json({ error: "Invalid email or password." });
    }

    const session = await createSession(user.id);

    response.cookie(sessionCookieName, session.rawToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      expires: session.expiresAt
    });

    return response.status(200).json({ user: serializeUser(user) });
  });

  app.post("/auth/logout", async (request, response) => {
    const rawToken = request.cookies[sessionCookieName] as string | undefined;

    if (rawToken) {
      await store.deleteSessionByTokenHash(hashSessionToken(rawToken));
    }

    response.clearCookie(sessionCookieName);
    return response.status(204).send();
  });

  app.get("/auth/me", async (request, response) => {
    const user = await getAuthenticatedUser(request.cookies[sessionCookieName] as string | undefined);

    return response.status(200).json({ user: user ? serializeUser(user) : null });
  });

  app.patch("/users/me/profile", async (request, response) => {
    const user = await getAuthenticatedUser(getRawSessionToken(request));

    if (!user) {
      return response.status(401).json({ error: "You must be logged in to do that." });
    }

    const parsed = profileSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Display name is required." });
    }

    const displayName = parsed.data.displayName.trim();
    const displayNameNormalized = normalizeDisplayName(displayName);
    const existingUser = await store.findUserByDisplayNameNormalized(displayNameNormalized);

    if (existingUser && existingUser.id !== user.id) {
      return response.status(409).json({ error: "That display name is already taken." });
    }

    const updatedUser = await store.updateDisplayName({
      userId: user.id,
      displayName,
      displayNameNormalized
    });

    return response.status(200).json({ user: updatedUser ? serializeUser(updatedUser) : serializeUser(user) });
  });

  app.get("/health", (_request, response) => {
    response.status(200).json({ ok: true });
  });

  app.get("/groups", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const groups = await store.listGroupsForUser(user.id);
    response.status(200).json({ groups });
  });

  app.post("/groups", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    if (!requireCompletedProfile(user, response)) {
      return;
    }

    const parsed = groupSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Group name is required." });
    }

    const group = await store.createGroup(parsed.data.name.trim(), user.id);
    return response.status(201).json({ group });
  });

  app.get("/groups/:groupId", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const group = await store.getGroupDetail(request.params.groupId, user.id);

    if (!group) {
      return response.status(404).json({ error: "Group not found." });
    }

    return response.status(200).json({ group });
  });

  app.get("/invitations", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const invitations = await store.listPendingInvitationsForUser(user.id);
    return response.status(200).json({ invitations });
  });

  app.post("/groups/:groupId/invitations", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    if (!requireCompletedProfile(user, response)) {
      return;
    }

    const parsed = invitationSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Enter an email or display name to invite." });
    }

    const groupId = request.params.groupId;
    const canInvite = await store.isGroupOwner(groupId, user.id);

    if (!canInvite) {
      return response.status(403).json({ error: "Only group owners can invite members." });
    }

    const identifier = parsed.data.identifier.trim();
    const target = z.string().email().safeParse(identifier).success
      ? await store.findUserByEmail(normalizeEmail(identifier))
      : await store.findUserByDisplayNameNormalized(normalizeDisplayName(identifier));

    if (!target) {
      return response.status(400).json({ error: "Only registered users can be invited." });
    }

    if (await store.isGroupMember(groupId, target.id)) {
      return response.status(409).json({ error: "That user is already a member of the group." });
    }

    if (await store.hasPendingInvitation(groupId, target.id)) {
      return response.status(409).json({ error: "That user already has a pending invitation." });
    }

    const invitation = await store.createInvitation(groupId, target.id, user.id);
    return response.status(201).json({ invitation });
  });

  if (store.supportsExpenses()) {
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

      const expectsRichExpense = hasAnyRichExpenseField(request.body);
      const parsed = expenseSchema.safeParse(request.body);
      const parsedLegacy = expectsRichExpense
        ? null
        : legacyExpenseSchema.safeParse(request.body);

      if (!parsed.success && !parsedLegacy?.success) {
        return response.status(400).json({
          error: expectsRichExpense
            ? "Enter a title, category, split mode, date, at least one payer, and participants."
            : "Enter a title, a date, and at least one payer."
        });
      }

      try {
        let expense: GroupExpense;

        if (parsed.success) {
          expense = await store.createExpense({
            groupId: request.params.groupId,
            createdByUserId: user.id,
            ...(await buildRichExpenseInput({
              groupId: request.params.groupId,
              viewerUserId: user.id,
              ...parsed.data
            }))
          });
        } else {
          if (!parsedLegacy?.success) {
            throw new Error("Legacy expense parsing unexpectedly failed.");
          }

          const legacyData = parsedLegacy.data;

          expense = await store.createExpense({
            groupId: request.params.groupId,
            createdByUserId: user.id,
            title: legacyData.title.trim(),
            expenseDate: parseExpenseDate(legacyData.expenseDate),
            payers: await validateExpensePayers(request.params.groupId, legacyData.payers)
          });
        }

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

      const expectsRichExpense = hasAnyRichExpenseField(request.body);
      const parsed = expenseSchema.safeParse(request.body);
      const parsedLegacy = expectsRichExpense
        ? null
        : legacyExpenseSchema.safeParse(request.body);

      if (!parsed.success && !parsedLegacy?.success) {
        return response.status(400).json({
          error: expectsRichExpense
            ? "Enter a title, category, split mode, date, at least one payer, and participants."
            : "Enter a title, a date, and at least one payer."
        });
      }

      try {
        let updatedExpense: GroupExpense | null;

        if (parsed.success) {
          updatedExpense = await store.updateExpense({
            expenseId: expense.id,
            ...(await buildRichExpenseInput({
              groupId: expense.groupId,
              viewerUserId: user.id,
              ...parsed.data
            }))
          });
        } else {
          if (!parsedLegacy?.success) {
            throw new Error("Legacy expense parsing unexpectedly failed.");
          }

          const legacyData = parsedLegacy.data;

          updatedExpense = await store.updateExpense({
            expenseId: expense.id,
            title: legacyData.title.trim(),
            expenseDate: parseExpenseDate(legacyData.expenseDate),
            payers: await validateExpensePayers(expense.groupId, legacyData.payers)
          });
        }

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

      if (expense.createdBy.id !== user.id) {
        return response.status(403).json({ error: "Only the creator can delete this expense." });
      }

      await store.deleteExpense(expense.id);
      return response.status(204).send();
    });
  }

  app.post("/invitations/:invitationId/accept", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    if (!requireCompletedProfile(user, response)) {
      return;
    }

    const invitation = await store.acceptInvitation(request.params.invitationId, user.id);

    if (!invitation) {
      return response.status(404).json({ error: "Invitation not found." });
    }

    return response.status(200).json({ invitation });
  });

  app.post("/invitations/:invitationId/decline", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    if (!requireCompletedProfile(user, response)) {
      return;
    }

    const invitation = await store.declineInvitation(request.params.invitationId, user.id);

    if (!invitation) {
      return response.status(404).json({ error: "Invitation not found." });
    }

    return response.status(200).json({ invitation });
  });

  if (staticAssetsPath && fs.existsSync(staticAssetsPath)) {
    app.use(express.static(staticAssetsPath));

    app.get("*", (request, response, next) => {
      if (
        request.path.startsWith("/auth/") ||
        request.path.startsWith("/groups/") ||
        request.path.startsWith("/invitations/") ||
        request.path.startsWith("/expenses/")
      ) {
        return next();
      }

      if (request.path.startsWith("/users/") || request.path.startsWith("/health")) {
        return next();
      }

      return response.sendFile(path.join(staticAssetsPath, "index.html"));
    });
  }

  return app;
}
