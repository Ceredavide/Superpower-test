import type {
  CreateSettlementInput,
  CreateExpenseInput,
  DashboardData,
  GroupDetail,
  GroupExpense,
  GroupLedger,
  GroupSummary,
  InvitationSummary,
  LedgerExpense,
  LedgerMember,
  LedgerSettlement,
  NewSessionInput,
  NewUserInput,
  PendingInvitation,
  Store,
  StoredSession,
  StoredUser,
  UpdateDisplayNameInput,
  UpdateExpenseInput
} from "../../src/store/types";
import {
  deriveBalances,
  normalizeExpenseShares,
  redistributeDepartedMemberExpense,
  suggestSettlements
} from "../../src/core/lib/ledger";
import { sumMoney } from "../../src/core/lib/money";

type StoredGroup = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
};

type StoredMembership = {
  id: string;
  groupId: string;
  userId: string;
  role: "owner" | "member";
  status: "active" | "inactive";
  leftAt: Date | null;
  createdAt: Date;
};

type StoredInvitation = {
  id: string;
  groupId: string;
  invitedUserId: string;
  invitedByUserId: string;
  status: "pending" | "accepted" | "declined";
  createdAt: Date;
  respondedAt: Date | null;
};

type StoredExpense = {
  id: string;
  groupId: string;
  title: string;
  category: "food" | "transport" | "housing" | "entertainment" | "other";
  splitMode: "equal" | "percentage" | "exact";
  expenseDate: Date;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

type StoredExpensePayer = {
  id: string;
  expenseId: string;
  userId: string;
  amountPaid: string;
};

type StoredExpenseShare = {
  id: string;
  expenseId: string;
  userId: string;
  amount: string;
};

type StoredSettlement = {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amount: string;
  paidAt: Date;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function hasSplitDetails(
  input: CreateExpenseInput | UpdateExpenseInput | {
    groupId: string;
    createdByUserId: string;
    title: string;
    expenseDate: Date;
    payers: Array<{ userId: string; amountPaid: string }>;
  }
): input is CreateExpenseInput | UpdateExpenseInput {
  return "participants" in input;
}

function toLedgerMember(entry: StoredMembership, user: StoredUser): LedgerMember {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: entry.status,
    leftAt: entry.leftAt
  };
}

function toLedgerSettlement(
  entry: StoredSettlement,
  usersById: Map<string, StoredUser>
): LedgerSettlement {
  const fromUser = usersById.get(entry.fromUserId);
  const toUser = usersById.get(entry.toUserId);

  if (!fromUser || !toUser) {
    throw new Error("Settlement users must exist.");
  }

  return {
    id: entry.id,
    groupId: entry.groupId,
    fromUserId: entry.fromUserId,
    toUserId: entry.toUserId,
    fromUser: {
      id: fromUser.id,
      email: fromUser.email,
      displayName: fromUser.displayName
    },
    toUser: {
      id: toUser.id,
      email: toUser.email,
      displayName: toUser.displayName
    },
    amount: entry.amount,
    paidAt: entry.paidAt,
    createdByUserId: entry.createdByUserId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

function settlementToExpenseEffect(settlement: Pick<LedgerSettlement, "fromUserId" | "toUserId" | "amount">) {
  return {
    payers: [
      {
        userId: settlement.toUserId,
        amount: settlement.amount
      }
    ],
    shares: [
      {
        userId: settlement.fromUserId,
        amount: settlement.amount
      }
    ]
  };
}

function effectContainsUser(
  effect: ReturnType<typeof settlementToExpenseEffect> | LedgerExpense,
  userId: string
) {
  return (
    effect.payers.some((payer) => payer.userId === userId) ||
    effect.shares.some((share) => share.userId === userId)
  );
}

function pruneZeroMoneyEntries(effect: {
  payers: Array<{ userId: string; amount: string }>;
  shares: Array<{ userId: string; amount: string }>;
}) {
  return {
    payers: effect.payers.filter((entry) => entry.amount !== "0.00"),
    shares: effect.shares.filter((entry) => entry.amount !== "0.00")
  };
}

function pruneZeroMoneyEntriesFromLedgerExpense(expense: LedgerExpense): LedgerExpense {
  return {
    ...expense,
    payers: expense.payers.filter((entry) => entry.amount !== "0.00"),
    shares: expense.shares.filter((entry) => entry.amount !== "0.00")
  };
}

function redistributeLedgerExpenseForActiveRoster(
  expense: LedgerExpense,
  departedMemberships: StoredMembership[],
  activeMemberIds: string[]
) {
  return departedMemberships.reduce<LedgerExpense>((currentExpense, departedMembership) => {
    if (!effectContainsUser(currentExpense, departedMembership.userId)) {
      return currentExpense;
    }

    const redistributed = redistributeDepartedMemberExpense(
      {
        payers: currentExpense.payers,
        shares: currentExpense.shares
      },
      departedMembership.userId,
      activeMemberIds
    );

    return {
      ...currentExpense,
      payers: redistributed.payers,
      shares: redistributed.shares
    };
  }, expense);
}

export class InMemoryStore implements Store {
  private users: StoredUser[] = [];
  private sessions: StoredSession[] = [];
  private groups: StoredGroup[] = [];
  private memberships: StoredMembership[] = [];
  private invitations: StoredInvitation[] = [];
  private expenses: StoredExpense[] = [];
  private expensePayers: StoredExpensePayer[] = [];
  private expenseShares: StoredExpenseShare[] = [];
  private settlements: StoredSettlement[] = [];

  supportsExpenses() {
    return true;
  }

  async createUser(input: NewUserInput): Promise<StoredUser> {
    const now = new Date();
    const user: StoredUser = {
      id: createId("user"),
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: null,
      displayNameNormalized: null,
      createdAt: now,
      updatedAt: now
    };

    this.users.push(user);
    return user;
  }

  async findUserByEmail(email: string) {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async findUserById(userId: string) {
    return this.users.find((user) => user.id === userId) ?? null;
  }

  async findUserByDisplayNameNormalized(displayNameNormalized: string) {
    return (
      this.users.find((user) => user.displayNameNormalized === displayNameNormalized) ?? null
    );
  }

  async updateDisplayName(input: UpdateDisplayNameInput) {
    const user = this.users.find((entry) => entry.id === input.userId);

    if (!user) {
      return null;
    }

    user.displayName = input.displayName;
    user.displayNameNormalized = input.displayNameNormalized;
    user.updatedAt = new Date();

    return user;
  }

  async createSession(input: NewSessionInput) {
    const session: StoredSession = {
      id: createId("session"),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdAt: new Date()
    };

    this.sessions.push(session);
    return session;
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.sessions.find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async deleteSessionByTokenHash(tokenHash: string) {
    this.sessions = this.sessions.filter((session) => session.tokenHash !== tokenHash);
  }

  async createGroup(name: string, ownerId: string): Promise<GroupSummary> {
    const now = new Date();
    const group: StoredGroup = {
      id: createId("group"),
      name,
      ownerId,
      createdAt: now,
      updatedAt: now
    };
    const membership: StoredMembership = {
      id: createId("membership"),
      groupId: group.id,
      userId: ownerId,
      role: "owner",
      status: "active",
      leftAt: null,
      createdAt: now
    };

    this.groups.push(group);
    this.memberships.push(membership);

    return {
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      role: membership.role,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt
    };
  }

  async listGroupsForUser(userId: string): Promise<GroupSummary[]> {
    return this.memberships
      .filter((membership) => membership.userId === userId && membership.status === "active")
      .map((membership) => {
        const group = this.groups.find((entry) => entry.id === membership.groupId)!;

        return {
          id: group.id,
          name: group.name,
          ownerId: group.ownerId,
          role: membership.role,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt
        };
      });
  }

  async getGroupDetail(groupId: string, viewerUserId: string): Promise<GroupDetail | null> {
    const membership = this.memberships.find(
      (entry) =>
        entry.groupId === groupId && entry.userId === viewerUserId && entry.status === "active"
    );
    const group = this.groups.find((entry) => entry.id === groupId);

    if (!membership || !group) {
      return null;
    }

    const members = this.memberships
      .filter((entry) => entry.groupId === groupId && entry.status === "active")
      .map((entry) => {
        const user = this.users.find((candidate) => candidate.id === entry.userId)!;

        return {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: entry.role
        };
      });

    return {
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      role: membership.role,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      members
    };
  }

  async isGroupOwner(groupId: string, userId: string) {
    return this.memberships.some(
      (membership) =>
        membership.groupId === groupId &&
        membership.userId === userId &&
        membership.role === "owner" &&
        membership.status === "active"
    );
  }

  async isGroupMember(groupId: string, userId: string) {
    return this.memberships.some(
      (membership) =>
        membership.groupId === groupId &&
        membership.userId === userId &&
        membership.status === "active"
    );
  }

  async hasPendingInvitation(groupId: string, userId: string) {
    return this.invitations.some(
      (invitation) =>
        invitation.groupId === groupId &&
        invitation.invitedUserId === userId &&
        invitation.status === "pending"
    );
  }

  async createInvitation(groupId: string, invitedUserId: string, invitedByUserId: string) {
    const invitation: StoredInvitation = {
      id: createId("invite"),
      groupId,
      invitedUserId,
      invitedByUserId,
      status: "pending",
      createdAt: new Date(),
      respondedAt: null
    };

    this.invitations.push(invitation);
    return invitation;
  }

  async listPendingInvitationsForUser(userId: string): Promise<InvitationSummary[]> {
    return this.invitations
      .filter((invitation) => invitation.invitedUserId === userId && invitation.status === "pending")
      .map((invitation) => {
        const group = this.groups.find((entry) => entry.id === invitation.groupId)!;
        const invitedBy = this.users.find((entry) => entry.id === invitation.invitedByUserId)!;

        return {
          id: invitation.id,
          status: invitation.status,
          createdAt: invitation.createdAt,
          respondedAt: invitation.respondedAt,
          group: {
            id: group.id,
            name: group.name
          },
          invitedBy: {
            id: invitedBy.id,
            email: invitedBy.email,
            displayName: invitedBy.displayName
          }
        };
      });
  }

  async findPendingInvitationForUser(invitationId: string, userId: string): Promise<PendingInvitation | null> {
    const invitation = this.invitations.find(
      (entry) => entry.id === invitationId && entry.invitedUserId === userId && entry.status === "pending"
    );

    if (!invitation) {
      return null;
    }

    return {
      ...invitation
    };
  }

  async acceptInvitation(invitationId: string, userId: string) {
    const invitation = this.invitations.find(
      (entry) => entry.id === invitationId && entry.invitedUserId === userId && entry.status === "pending"
    );

    if (!invitation) {
      return null;
    }

    invitation.status = "accepted";
    invitation.respondedAt = new Date();

    if (!(await this.isGroupMember(invitation.groupId, userId))) {
      this.memberships.push({
        id: createId("membership"),
        groupId: invitation.groupId,
        userId,
        role: "member",
        status: "active",
        leftAt: null,
        createdAt: new Date()
      });
    } else {
      const membership = this.memberships.find(
        (entry) => entry.groupId === invitation.groupId && entry.userId === userId
      );

      if (membership) {
        membership.role = "member";
        membership.status = "active";
        membership.leftAt = null;
      }
    }

    return invitation;
  }

  async declineInvitation(invitationId: string, userId: string) {
    const invitation = this.invitations.find(
      (entry) => entry.id === invitationId && entry.invitedUserId === userId && entry.status === "pending"
    );

    if (!invitation) {
      return null;
    }

    invitation.status = "declined";
    invitation.respondedAt = new Date();
    return invitation;
  }

  async getDashboardData(userId: string): Promise<DashboardData> {
    return {
      groups: await this.listGroupsForUser(userId),
      invitations: await this.listPendingInvitationsForUser(userId)
    };
  }

  async getLedger(groupId: string, viewerUserId: string): Promise<GroupLedger | null> {
    const membership = this.memberships.find(
      (entry) =>
        entry.groupId === groupId && entry.userId === viewerUserId && entry.status === "active"
    );

    if (!membership) {
      return null;
    }

    const groupMembers = this.memberships
      .filter((entry) => entry.groupId === groupId && entry.status === "active")
      .map((entry) => {
        const user = this.users.find((candidate) => candidate.id === entry.userId)!;
        return toLedgerMember(entry, user);
      });
    const activeMemberIds = groupMembers.map((entry) => entry.id);
    const departedMemberships = this.memberships
      .filter((entry) => entry.groupId === groupId && entry.status === "inactive")
      .sort((left, right) => {
        const leftTime = left.leftAt?.getTime() ?? left.createdAt.getTime();
        const rightTime = right.leftAt?.getTime() ?? right.createdAt.getTime();

        return leftTime - rightTime;
      });

    const ledgerExpenses = this.expenses
      .filter((expense) => expense.groupId === groupId)
      .sort((left, right) => {
        const byDate = left.expenseDate.getTime() - right.expenseDate.getTime();
        return byDate !== 0 ? byDate : left.createdAt.getTime() - right.createdAt.getTime();
      })
      .map((expense) => this.materializeLedgerExpense(expense))
      .map((expense) =>
        pruneZeroMoneyEntriesFromLedgerExpense(
          redistributeLedgerExpenseForActiveRoster(expense, departedMemberships, activeMemberIds)
        )
      );

    const usersById = new Map(this.users.map((user) => [user.id, user]));
    const ledgerSettlements = this.settlements
      .filter((settlement) => settlement.groupId === groupId)
      .sort((left, right) => {
        const byPaidAt = left.paidAt.getTime() - right.paidAt.getTime();
        return byPaidAt !== 0 ? byPaidAt : left.createdAt.getTime() - right.createdAt.getTime();
      })
      .map((settlement) => toLedgerSettlement(settlement, usersById));
    const settlementEffects = ledgerSettlements.map((settlement) =>
      pruneZeroMoneyEntries(
        departedMemberships.reduce<ReturnType<typeof settlementToExpenseEffect>>(
          (currentEffect, departedMembership) =>
            effectContainsUser(currentEffect, departedMembership.userId)
              ? redistributeDepartedMemberExpense(
                  currentEffect,
                  departedMembership.userId,
                  activeMemberIds
                )
              : currentEffect,
          settlementToExpenseEffect(settlement)
        )
      )
    );

    const balances =
      activeMemberIds.length <= 1
        ? activeMemberIds.map((userId) => ({
            userId,
            balance: "0.00"
          }))
        : deriveBalances({
            memberIds: activeMemberIds,
            expenses: [
              ...ledgerExpenses.map((expense) => ({
                payers: expense.payers,
                shares: expense.shares
              })),
              ...settlementEffects
            ],
            settlements: []
          });

    return {
      groupId,
      members: groupMembers,
      expenses: ledgerExpenses,
      balances,
      settleUpSuggestions: activeMemberIds.length <= 1 ? [] : suggestSettlements(balances),
      settlements: ledgerSettlements
    };
  }

  private materializeExpense(expense: StoredExpense): GroupExpense {
    const createdBy = this.users.find((user) => user.id === expense.createdByUserId)!;
    const payers = this.expensePayers
      .filter((entry) => entry.expenseId === expense.id)
      .map((entry) => ({
        user: this.users.find((user) => user.id === entry.userId)!,
        amountPaid: entry.amountPaid
      }));

    return {
      id: expense.id,
      groupId: expense.groupId,
      title: expense.title,
      category: expense.category,
      splitMode: expense.splitMode,
      expenseDate: expense.expenseDate,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      totalAmount: sumMoney(payers.map((payer) => payer.amountPaid)),
      createdBy: {
        id: createdBy.id,
        email: createdBy.email,
        displayName: createdBy.displayName
      },
      payers: payers.map((payer) => ({
        user: {
          id: payer.user.id,
          email: payer.user.email,
          displayName: payer.user.displayName
        },
        amountPaid: payer.amountPaid
      }))
    };
  }

  private materializeLedgerExpense(expense: StoredExpense): LedgerExpense {
    const createdBy = this.users.find((user) => user.id === expense.createdByUserId)!;
    const payers = this.expensePayers
      .filter((entry) => entry.expenseId === expense.id)
      .map((entry) => ({
        userId: entry.userId,
        amount: entry.amountPaid
      }));
    const shares = this.expenseShares
      .filter((entry) => entry.expenseId === expense.id)
      .map((entry) => ({
        userId: entry.userId,
        amount: entry.amount
      }));

    return {
      id: expense.id,
      groupId: expense.groupId,
      title: expense.title,
      category: expense.category,
      splitMode: expense.splitMode,
      expenseDate: expense.expenseDate,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      createdBy: {
        id: createdBy.id,
        email: createdBy.email,
        displayName: createdBy.displayName
      },
      payers,
      shares
    };
  }

  async createExpense(input: CreateExpenseInput): Promise<GroupExpense> {
    const now = new Date();
    const richInput = hasSplitDetails(input);
    const totalAmount = sumMoney(input.payers.map((payer) => payer.amountPaid));
    const expense: StoredExpense = {
      id: createId("expense"),
      groupId: input.groupId,
      title: input.title,
      category: richInput ? input.category : "other",
      splitMode: richInput ? input.splitMode : "equal",
      expenseDate: input.expenseDate,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now
    };

    this.expenses.push(expense);
    this.expensePayers.push(
      ...input.payers.map((payer) => ({
        id: createId("expense_payer"),
        expenseId: expense.id,
        userId: payer.userId,
        amountPaid: payer.amountPaid
      }))
    );
    if (richInput) {
      this.expenseShares.push(
        ...normalizeExpenseShares({
          splitMode: input.splitMode,
          total: totalAmount,
          participants: input.participants
        }).map((share) => ({
          id: createId("expense_share"),
          expenseId: expense.id,
          userId: share.userId,
          amount: share.amount
        }))
      );
    }

    return this.materializeExpense(expense);
  }

  async listExpensesForGroup(groupId: string): Promise<GroupExpense[]> {
    return this.expenses
      .filter((expense) => expense.groupId === groupId)
      .sort((left, right) => {
        const byDate = left.expenseDate.getTime() - right.expenseDate.getTime();
        return byDate !== 0 ? byDate : left.createdAt.getTime() - right.createdAt.getTime();
      })
      .map((expense) => this.materializeExpense(expense));
  }

  async findExpenseById(expenseId: string): Promise<GroupExpense | null> {
    const expense = this.expenses.find((entry) => entry.id === expenseId);
    return expense ? this.materializeExpense(expense) : null;
  }

  async updateExpense(input: UpdateExpenseInput): Promise<GroupExpense | null> {
    const expense = this.expenses.find((entry) => entry.id === input.expenseId);

    if (!expense) {
      return null;
    }

    const richInput = hasSplitDetails(input);
    const totalAmount = sumMoney(input.payers.map((payer) => payer.amountPaid));
    expense.title = input.title;
    expense.expenseDate = input.expenseDate;
    if (richInput) {
      expense.category = input.category;
      expense.splitMode = input.splitMode;
    }
    expense.updatedAt = new Date();
    this.expensePayers = this.expensePayers.filter((entry) => entry.expenseId !== expense.id);
    this.expensePayers.push(
      ...input.payers.map((payer) => ({
        id: createId("expense_payer"),
        expenseId: expense.id,
        userId: payer.userId,
        amountPaid: payer.amountPaid
      }))
    );
    this.expenseShares = this.expenseShares.filter((entry) => entry.expenseId !== expense.id);
    if (richInput) {
      this.expenseShares.push(
        ...normalizeExpenseShares({
          splitMode: input.splitMode,
          total: totalAmount,
          participants: input.participants
        }).map((share) => ({
          id: createId("expense_share"),
          expenseId: expense.id,
          userId: share.userId,
          amount: share.amount
        }))
      );
    }

    return this.materializeExpense(expense);
  }

  async createSettlement(input: CreateSettlementInput): Promise<LedgerSettlement> {
    const settlement: StoredSettlement = {
      id: createId("settlement"),
      groupId: input.groupId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amount: input.amount,
      paidAt: input.paidAt,
      createdByUserId: input.createdByUserId,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.settlements.push(settlement);
    return toLedgerSettlement(settlement, new Map(this.users.map((user) => [user.id, user])));
  }

  async removeGroupMember(groupId: string, memberId: string): Promise<GroupDetail | null> {
    const membership = this.memberships.find(
      (entry) => entry.groupId === groupId && entry.userId === memberId
    );

    const group = this.groups.find((entry) => entry.id === groupId);

    if (!membership || !group || membership.status !== "active") {
      return null;
    }

    const remainingActiveMemberships = this.memberships
      .filter(
        (entry) =>
          entry.groupId === groupId && entry.status === "active" && entry.userId !== memberId
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const isOwnerRemoval = group.ownerId === memberId;
    const replacementOwner = isOwnerRemoval ? remainingActiveMemberships[0] : null;

    if (isOwnerRemoval && !replacementOwner) {
      return null;
    }

    membership.status = "inactive";
    membership.leftAt = new Date();

    if (replacementOwner) {
      group.ownerId = replacementOwner.userId;
      replacementOwner.role = "owner";
      return this.getGroupDetail(groupId, replacementOwner.userId);
    }

    return this.getGroupDetail(groupId, group.ownerId);
  }

  async deleteExpense(expenseId: string): Promise<boolean> {
    const previousLength = this.expenses.length;
    this.expenses = this.expenses.filter((entry) => entry.id !== expenseId);
    this.expensePayers = this.expensePayers.filter((entry) => entry.expenseId !== expenseId);
    this.expenseShares = this.expenseShares.filter((entry) => entry.expenseId !== expenseId);
    return this.expenses.length !== previousLength;
  }

  async isExpenseCreator(expenseId: string, userId: string): Promise<boolean> {
    return this.expenses.some((expense) => expense.id === expenseId && expense.createdByUserId === userId);
  }
}
