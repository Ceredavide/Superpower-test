export type StoredUser = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  displayNameNormalized: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewUserInput = {
  email: string;
  passwordHash: string;
};

export type UpdateDisplayNameInput = {
  userId: string;
  displayName: string;
  displayNameNormalized: string;
};

export type StoredSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
};

export type NewSessionInput = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type GroupSummary = {
  id: string;
  name: string;
  ownerId: string;
  role: "owner" | "member";
  createdAt: Date;
  updatedAt: Date;
};

export type MembershipStatus = "active" | "inactive";

export type ExpenseCategory = "food" | "transport" | "housing" | "entertainment" | "other";

export type ExpenseSplitMode = "equal" | "percentage" | "exact";

export type ExpenseParticipantInput = {
  userId: string;
  included: boolean;
  percentage?: number;
  amountOwed?: string;
};

export type LedgerAmount = {
  userId: string;
  amount: string;
};

export type LedgerBalance = {
  userId: string;
  balance: string;
};

export type LedgerSettlement = {
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

export type CreateSettlementInput = {
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amount: string;
  paidAt: Date;
  createdByUserId: string;
};

export type LedgerSettlementSuggestion = {
  fromUserId: string;
  toUserId: string;
  amount: string;
};

export type LedgerMember = {
  id: string;
  email: string;
  displayName: string | null;
  status: MembershipStatus;
  leftAt: Date | null;
};

export type LedgerExpenseShare = {
  userId: string;
  amount: string;
};

export type LedgerExpense = {
  id: string;
  groupId: string;
  title: string;
  category: ExpenseCategory;
  splitMode: ExpenseSplitMode;
  expenseDate: Date;
  createdAt: Date;
  updatedAt: Date;
  payers: LedgerAmount[];
  shares: LedgerExpenseShare[];
};

export type GroupLedger = {
  groupId: string;
  members: LedgerMember[];
  expenses: LedgerExpense[];
  balances: LedgerBalance[];
  settleUpSuggestions: LedgerSettlementSuggestion[];
  settlements: LedgerSettlement[];
};

export type GroupDetail = GroupSummary & {
  members: Array<{
    id: string;
    email: string;
    displayName: string | null;
    role: "owner" | "member";
  }>;
};

export type InvitationSummary = {
  id: string;
  status: "pending";
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
};

export type PendingInvitation = {
  id: string;
  groupId: string;
  invitedUserId: string;
  invitedByUserId: string;
  status: "pending";
  createdAt: Date;
  respondedAt: Date | null;
};

export type DashboardData = {
  groups: GroupSummary[];
  invitations: InvitationSummary[];
};

export type ExpensePayerInput = {
  userId: string;
  amountPaid: string;
};

type LegacyExpenseInput = {
  groupId: string;
  createdByUserId: string;
  title: string;
  expenseDate: Date;
  payers: ExpensePayerInput[];
};

type LegacyUpdateExpenseInput = {
  expenseId: string;
  title: string;
  expenseDate: Date;
  payers: ExpensePayerInput[];
};

export type CreateExpenseInput = {
  groupId: string;
  createdByUserId: string;
  title: string;
  expenseDate: Date;
  category: ExpenseCategory;
  splitMode: ExpenseSplitMode;
  participants: ExpenseParticipantInput[];
  payers: ExpensePayerInput[];
};

export type UpdateExpenseInput = {
  expenseId: string;
  title: string;
  expenseDate: Date;
  category: ExpenseCategory;
  splitMode: ExpenseSplitMode;
  participants: ExpenseParticipantInput[];
  payers: ExpensePayerInput[];
};

export type GroupExpense = {
  id: string;
  groupId: string;
  title: string;
  category?: ExpenseCategory;
  splitMode?: ExpenseSplitMode;
  expenseDate: Date;
  createdAt: Date;
  updatedAt: Date;
  totalAmount: string;
  createdBy: {
    id: string;
    email: string;
    displayName: string | null;
  };
  payers: Array<{
    user: {
      id: string;
      email: string;
      displayName: string | null;
    };
    amountPaid: string;
  }>;
};

export interface Store {
  supportsExpenses(): boolean;
  createUser(input: NewUserInput): Promise<StoredUser>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<StoredUser | null>;
  findUserByDisplayNameNormalized(displayNameNormalized: string): Promise<StoredUser | null>;
  updateDisplayName(input: UpdateDisplayNameInput): Promise<StoredUser | null>;
  createSession(input: NewSessionInput): Promise<StoredSession>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  createGroup(name: string, ownerId: string): Promise<GroupSummary>;
  listGroupsForUser(userId: string): Promise<GroupSummary[]>;
  getGroupDetail(groupId: string, viewerUserId: string): Promise<GroupDetail | null>;
  isGroupOwner(groupId: string, userId: string): Promise<boolean>;
  isGroupMember(groupId: string, userId: string): Promise<boolean>;
  hasPendingInvitation(groupId: string, userId: string): Promise<boolean>;
  createInvitation(groupId: string, invitedUserId: string, invitedByUserId: string): Promise<unknown>;
  listPendingInvitationsForUser(userId: string): Promise<InvitationSummary[]>;
  findPendingInvitationForUser(invitationId: string, userId: string): Promise<PendingInvitation | null>;
  acceptInvitation(invitationId: string, userId: string): Promise<unknown>;
  declineInvitation(invitationId: string, userId: string): Promise<unknown>;
  getDashboardData(userId: string): Promise<DashboardData>;
  getLedger(groupId: string, viewerUserId: string): Promise<GroupLedger | null>;
  createExpense(input: CreateExpenseInput | LegacyExpenseInput): Promise<GroupExpense>;
  listExpensesForGroup(groupId: string): Promise<GroupExpense[]>;
  findExpenseById(expenseId: string): Promise<GroupExpense | null>;
  updateExpense(input: UpdateExpenseInput | LegacyUpdateExpenseInput): Promise<GroupExpense | null>;
  createSettlement(input: CreateSettlementInput): Promise<LedgerSettlement>;
  removeGroupMember(groupId: string, memberId: string): Promise<LedgerMember | null>;
  deleteExpense(expenseId: string): Promise<boolean>;
  isExpenseCreator(expenseId: string, userId: string): Promise<boolean>;
}
