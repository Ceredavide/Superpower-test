import { Prisma, type PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

import {
  deriveBalances,
  normalizeExpenseShares,
  redistributeDepartedMemberExpense,
  suggestSettlements
} from "../lib/ledger";
import { normalizeMoneyInput, sumMoney } from "../lib/money";
import type {
  CreateSettlementInput,
  CreateExpenseInput,
  DashboardData,
  GroupDetail,
  GroupExpense,
  GroupLedger,
  GroupSummary,
  InvitationSummary,
  NewSessionInput,
  NewUserInput,
  PendingInvitation,
  LedgerExpense,
  LedgerMember,
  LedgerSettlement,
  Store,
  StoredSession,
  StoredUser,
  UpdateDisplayNameInput,
  UpdateExpenseInput
} from "./types";

const expenseInclude = {
  createdBy: true,
  payers: {
    include: {
      user: true
    },
    orderBy: {
      id: "asc"
    }
  },
  shares: {
    include: {
      user: true
    },
    orderBy: {
      id: "asc"
    }
  }
} satisfies Prisma.ExpenseInclude;

type ExpenseWithRelations = Prisma.ExpenseGetPayload<{
  include: typeof expenseInclude;
}>;

type MembershipWithUser = Prisma.GroupMembershipGetPayload<{
  include: {
    user: true;
  };
}>;

function toGroupSummary(entry: {
  role: "owner" | "member";
  group: {
    id: string;
    name: string;
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
  };
}): GroupSummary {
  return {
    id: entry.group.id,
    name: entry.group.name,
    ownerId: entry.group.ownerId,
    role: entry.role,
    createdAt: entry.group.createdAt,
    updatedAt: entry.group.updatedAt
  };
}

function toGroupExpense(expense: ExpenseWithRelations): GroupExpense {
  return {
    id: expense.id,
    groupId: expense.groupId,
    title: expense.title,
    category: expense.category,
    splitMode: expense.splitMode,
    expenseDate: expense.expenseDate,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    totalAmount: sumMoney(expense.payers.map((payer) => payer.amountPaid.toFixed(2))),
    createdBy: {
      id: expense.createdBy.id,
      email: expense.createdBy.email,
      displayName: expense.createdBy.displayName
    },
    payers: expense.payers.map((payer) => ({
      user: {
        id: payer.user.id,
        email: payer.user.email,
        displayName: payer.user.displayName
      },
      amountPaid: payer.amountPaid.toFixed(2)
    }))
  };
}

function toLedgerExpense(expense: ExpenseWithRelations): LedgerExpense {
  return {
    id: expense.id,
    groupId: expense.groupId,
    title: expense.title,
    category: expense.category,
    splitMode: expense.splitMode,
    expenseDate: expense.expenseDate,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    payers: expense.payers.map((payer) => ({
      userId: payer.user.id,
      amount: payer.amountPaid.toFixed(2)
    })),
    shares: expense.shares.map((share) => ({
      userId: share.user.id,
      amount: share.amount.toFixed(2)
    }))
  };
}

function redistributeExpenseForActiveRoster(
  expense: LedgerExpense,
  departedMemberships: MembershipWithUser[],
  activeMemberIds: string[]
): LedgerExpense {
  return departedMemberships.reduce<LedgerExpense>((currentExpense, departedMembership) => {
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

function toLedgerMember(entry: {
  id: string;
  role: "owner" | "member";
  status: "active" | "inactive";
  leftAt: Date | null;
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
}): LedgerMember {
  return {
    id: entry.user.id,
    email: entry.user.email,
    displayName: entry.user.displayName,
    status: entry.status,
    leftAt: entry.leftAt
  };
}

function toLedgerSettlement(entry: {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amount: Decimal;
  paidAt: Date;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}): LedgerSettlement {
  return {
    id: entry.id,
    groupId: entry.groupId,
    fromUserId: entry.fromUserId,
    toUserId: entry.toUserId,
    amount: entry.amount.toFixed(2),
    paidAt: entry.paidAt,
    createdByUserId: entry.createdByUserId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

function toGroupDetailFromMemberships(
  group: {
    id: string;
    name: string;
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
  },
  memberships: Array<{
    role: "owner" | "member";
    status: "active" | "inactive";
    user: {
      id: string;
      email: string;
      displayName: string | null;
    };
  }>
): GroupDetail {
  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    role: "owner",
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    members: memberships
      .filter((membership) => membership.status === "active")
      .map((membership) => ({
        id: membership.user.id,
        email: membership.user.email,
        displayName: membership.user.displayName,
        role: membership.role
      }))
  };
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

function buildExpenseShareRows(input: CreateExpenseInput | UpdateExpenseInput, totalAmount: string) {
  return normalizeExpenseShares({
    splitMode: input.splitMode,
    total: totalAmount,
    participants: input.participants
  }).map((share) => ({
    userId: share.userId,
    amount: new Decimal(normalizeMoneyInput(share.amount))
  }));
}

export class PrismaStore implements Store {
  constructor(private readonly prisma: PrismaClient) {}

  supportsExpenses() {
    return true;
  }

  createUser(input: NewUserInput): Promise<StoredUser> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash
      }
    });
  }

  findUserByEmail(email: string): Promise<StoredUser | null> {
    return this.prisma.user.findUnique({
      where: { email }
    });
  }

  findUserById(userId: string): Promise<StoredUser | null> {
    return this.prisma.user.findUnique({
      where: { id: userId }
    });
  }

  findUserByDisplayNameNormalized(displayNameNormalized: string): Promise<StoredUser | null> {
    return this.prisma.user.findUnique({
      where: { displayNameNormalized }
    });
  }

  updateDisplayName(input: UpdateDisplayNameInput): Promise<StoredUser | null> {
    return this.prisma.user.update({
      where: { id: input.userId },
      data: {
        displayName: input.displayName,
        displayNameNormalized: input.displayNameNormalized
      }
    });
  }

  createSession(input: NewSessionInput): Promise<StoredSession> {
    return this.prisma.session.create({
      data: input
    });
  }

  findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    return this.prisma.session.findUnique({
      where: { tokenHash }
    });
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { tokenHash }
    });
  }

  async createGroup(name: string, ownerId: string): Promise<GroupSummary> {
    const group = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdGroup = await tx.expenseGroup.create({
        data: {
          name,
          ownerId
        }
      });

      await tx.groupMembership.create({
        data: {
          groupId: createdGroup.id,
          userId: ownerId,
          role: "owner",
          status: "active",
          leftAt: null
        }
      });

      return createdGroup;
    });

    return {
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      role: "owner",
      createdAt: group.createdAt,
      updatedAt: group.updatedAt
    };
  }

  async listGroupsForUser(userId: string): Promise<GroupSummary[]> {
    const memberships = await this.prisma.groupMembership.findMany({
      where: {
        userId,
        status: "active"
      },
      include: {
        group: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return memberships.map((membership: {
      role: "owner" | "member";
      group: {
        id: string;
        name: string;
        ownerId: string;
        createdAt: Date;
        updatedAt: Date;
      };
    }) =>
      toGroupSummary({
        role: membership.role,
        group: membership.group
      })
    );
  }

  async getGroupDetail(groupId: string, viewerUserId: string): Promise<GroupDetail | null> {
    const membership = await this.prisma.groupMembership.findFirst({
      where: {
        groupId,
        userId: viewerUserId,
        status: "active"
      },
      include: {
        group: {
          include: {
            memberships: {
              include: {
                user: true
              },
              where: {
                status: "active"
              },
              orderBy: {
                createdAt: "asc"
              }
            }
          }
        }
      }
    });

    if (!membership) {
      return null;
    }

    return {
      id: membership.group.id,
      name: membership.group.name,
      ownerId: membership.group.ownerId,
      role: membership.role,
      createdAt: membership.group.createdAt,
      updatedAt: membership.group.updatedAt,
      members: membership.group.memberships.map((entry: {
        user: {
          id: string;
          email: string;
          displayName: string | null;
        };
        role: "owner" | "member";
      }) => ({
        id: entry.user.id,
        email: entry.user.email,
        displayName: entry.user.displayName,
        role: entry.role
      }))
    };
  }

  async isGroupOwner(groupId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.groupMembership.count({
      where: {
        groupId,
        userId,
        role: "owner",
        status: "active"
      }
    });

    return count > 0;
  }

  async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.groupMembership.count({
      where: {
        groupId,
        userId,
        status: "active"
      }
    });

    return count > 0;
  }

  async hasPendingInvitation(groupId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.groupInvitation.count({
      where: {
        groupId,
        invitedUserId: userId,
        status: "pending"
      }
    });

    return count > 0;
  }

  createInvitation(groupId: string, invitedUserId: string, invitedByUserId: string) {
    return this.prisma.groupInvitation.create({
      data: {
        groupId,
        invitedUserId,
        invitedByUserId
      }
    });
  }

  async listPendingInvitationsForUser(userId: string): Promise<InvitationSummary[]> {
    const invitations = await this.prisma.groupInvitation.findMany({
      where: {
        invitedUserId: userId,
        status: "pending"
      },
      include: {
        group: true,
        invitedBy: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return invitations.map((invitation: {
      id: string;
      createdAt: Date;
      respondedAt: Date | null;
      group: {
        id: string;
        name: string;
      };
      invitedBy: {
        id: string;
        email: string;
        displayName: string | null;
      };
    }) => ({
      id: invitation.id,
      status: "pending" as const,
      createdAt: invitation.createdAt,
      respondedAt: invitation.respondedAt,
      group: {
        id: invitation.group.id,
        name: invitation.group.name
      },
      invitedBy: {
        id: invitation.invitedBy.id,
        email: invitation.invitedBy.email,
        displayName: invitation.invitedBy.displayName
      }
    }));
  }

  findPendingInvitationForUser(invitationId: string, userId: string): Promise<PendingInvitation | null> {
    return this.prisma.groupInvitation.findFirst({
      where: {
        id: invitationId,
        invitedUserId: userId,
        status: "pending"
      }
    }) as Promise<PendingInvitation | null>;
  }

  async acceptInvitation(invitationId: string, userId: string) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const invitation = await tx.groupInvitation.findFirst({
        where: {
          id: invitationId,
          invitedUserId: userId,
          status: "pending"
        }
      });

      if (!invitation) {
        return null;
      }

      const acceptedInvitation = await tx.groupInvitation.update({
        where: { id: invitationId },
        data: {
          status: "accepted",
          respondedAt: new Date()
        }
      });

      await tx.groupMembership.upsert({
        where: {
          groupId_userId: {
            groupId: invitation.groupId,
            userId
          }
        },
        create: {
          groupId: invitation.groupId,
          userId,
          role: "member",
          status: "active",
          leftAt: null
        },
        update: {
          role: "member",
          status: "active",
          leftAt: null
        }
      });

      return acceptedInvitation;
    });
  }

  async declineInvitation(invitationId: string, userId: string) {
    const invitation = await this.prisma.groupInvitation.findFirst({
      where: {
        id: invitationId,
        invitedUserId: userId,
        status: "pending"
      }
    });

    if (!invitation) {
      return null;
    }

    return this.prisma.groupInvitation.update({
      where: { id: invitationId },
      data: {
        status: "declined",
        respondedAt: new Date()
      }
    });
  }

  async getDashboardData(userId: string): Promise<DashboardData> {
    const [groups, invitations] = await Promise.all([
      this.listGroupsForUser(userId),
      this.listPendingInvitationsForUser(userId)
    ]);

    return { groups, invitations };
  }

  async getLedger(groupId: string, viewerUserId: string): Promise<GroupLedger | null> {
    const [memberships, expenses, settlements] = await Promise.all([
      this.prisma.groupMembership.findMany({
        where: { groupId },
        include: { user: true },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.expense.findMany({
        where: { groupId },
        include: expenseInclude,
        orderBy: [{ expenseDate: "asc" }, { createdAt: "asc" }]
      }),
      this.prisma.settlement.findMany({
        where: { groupId },
        orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }]
      })
    ]);

    const viewerMembership = memberships.find(
      (entry) => entry.userId === viewerUserId && entry.status === "active"
    );

    if (!viewerMembership) {
      return null;
    }

    const activeMemberships = memberships.filter((entry) => entry.status === "active");
    const departedMemberships = memberships
      .filter((entry) => entry.status === "inactive")
      .sort((left, right) => {
        const leftTime = left.leftAt?.getTime() ?? left.createdAt.getTime();
        const rightTime = right.leftAt?.getTime() ?? right.createdAt.getTime();

        return leftTime - rightTime;
      });
    const activeMemberIds = activeMemberships.map((entry) => entry.userId);
    const ledgerExpenses = expenses
      .map(toLedgerExpense)
      .map((expense) =>
        redistributeExpenseForActiveRoster(expense, departedMemberships, activeMemberIds)
      );
    const activeSettlements = settlements.filter(
      (settlement) =>
        activeMemberIds.includes(settlement.fromUserId) &&
        activeMemberIds.includes(settlement.toUserId)
    );
    const balances =
      activeMemberIds.length <= 1
        ? activeMemberIds.map((userId) => ({
            userId,
            balance: "0.00"
          }))
        : deriveBalances({
            memberIds: activeMemberIds,
            expenses: ledgerExpenses.map((expense) => ({
              payers: expense.payers,
              shares: expense.shares
            })),
            settlements: activeSettlements.map((entry) => ({
              fromUserId: entry.fromUserId,
              toUserId: entry.toUserId,
              amount: entry.amount.toFixed(2)
            }))
          });

    return {
      groupId,
      members: activeMemberships.map(toLedgerMember),
      expenses: ledgerExpenses,
      balances,
      settleUpSuggestions:
        activeMemberIds.length <= 1 ? [] : suggestSettlements(balances),
      settlements: settlements.map(toLedgerSettlement)
    };
  }

  async createExpense(input: CreateExpenseInput): Promise<GroupExpense> {
    const totalAmount = sumMoney(input.payers.map((payer) => payer.amountPaid));
    const richInput = hasSplitDetails(input);
    const expense = await this.prisma.expense.create({
      data: {
        groupId: input.groupId,
        title: input.title,
        ...(richInput
          ? {
              category: input.category,
              splitMode: input.splitMode
            }
          : {}),
        expenseDate: input.expenseDate,
        createdByUserId: input.createdByUserId,
        payers: {
          create: input.payers.map((payer) => ({
            userId: payer.userId,
            amountPaid: new Decimal(normalizeMoneyInput(payer.amountPaid))
          }))
        },
        ...(richInput
          ? {
              shares: {
                create: buildExpenseShareRows(input, totalAmount)
              }
            }
          : {})
      },
      include: expenseInclude
    });

    return toGroupExpense(expense);
  }

  async listExpensesForGroup(groupId: string): Promise<GroupExpense[]> {
    const expenses = await this.prisma.expense.findMany({
      where: { groupId },
      include: expenseInclude,
      orderBy: [{ expenseDate: "asc" }, { createdAt: "asc" }]
    });

    return expenses.map(toGroupExpense);
  }

  async findExpenseById(expenseId: string): Promise<GroupExpense | null> {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      include: expenseInclude
    });

    return expense ? toGroupExpense(expense) : null;
  }

  async updateExpense(input: UpdateExpenseInput): Promise<GroupExpense | null> {
    const existingExpense = await this.prisma.expense.findUnique({
      where: { id: input.expenseId }
    });

    if (!existingExpense) {
      return null;
    }

    const totalAmount = sumMoney(input.payers.map((payer) => payer.amountPaid));
    const richInput = hasSplitDetails(input);
    const expense = await this.prisma.expense.update({
      where: { id: input.expenseId },
      data: {
        title: input.title,
        expenseDate: input.expenseDate,
        ...(richInput
          ? {
              category: input.category,
              splitMode: input.splitMode
            }
          : {}),
        payers: {
          deleteMany: {},
          create: input.payers.map((payer) => ({
            userId: payer.userId,
            amountPaid: new Decimal(normalizeMoneyInput(payer.amountPaid))
          }))
        },
        ...(richInput
          ? {
              shares: {
                deleteMany: {},
                create: buildExpenseShareRows(input, totalAmount)
              }
            }
          : {})
      },
      include: expenseInclude
    });

    return toGroupExpense(expense);
  }

  async createSettlement(input: CreateSettlementInput): Promise<LedgerSettlement> {
    const settlement = await this.prisma.settlement.create({
      data: {
        groupId: input.groupId,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amount: new Decimal(normalizeMoneyInput(input.amount)),
        paidAt: input.paidAt,
        createdByUserId: input.createdByUserId
      }
    });

    return toLedgerSettlement(settlement);
  }

  async removeGroupMember(groupId: string, memberId: string): Promise<GroupDetail | null> {
    const [membership, group] = await Promise.all([
      this.prisma.groupMembership.findUnique({
        where: {
          groupId_userId: {
            groupId,
            userId: memberId
          }
        },
        include: {
          user: true
        }
      }),
      this.prisma.expenseGroup.findUnique({
        where: { id: groupId }
      })
    ]);

    if (!membership || !group) {
      return null;
    }

    const updated = await this.prisma.groupMembership.update({
      where: {
        groupId_userId: {
          groupId,
          userId: memberId
        }
      },
      data: {
        status: "inactive",
        leftAt: new Date()
      },
      include: {
        user: true
      }
    });

    return this.getGroupDetail(groupId, group.ownerId);
  }

  async deleteExpense(expenseId: string): Promise<boolean> {
    const deleted = await this.prisma.expense.deleteMany({
      where: { id: expenseId }
    });

    return deleted.count > 0;
  }

  async isExpenseCreator(expenseId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.expense.count({
      where: {
        id: expenseId,
        createdByUserId: userId
      }
    });

    return count > 0;
  }
}
