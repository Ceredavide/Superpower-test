export type User = {
  id: string;
  email: string;
  displayName: string | null;
};

export type ExpenseCategory = "food" | "transport" | "housing" | "entertainment" | "other";

export type ExpenseSplitMode = "equal" | "percentage" | "exact";

export type MembershipStatus = "active" | "inactive";

export type GroupSummary = {
  id: string;
  name: string;
  ownerId: string;
  role: "owner" | "member";
  createdAt: string;
  updatedAt: string;
};

export type GroupDetail = GroupSummary & {
  members: Array<{
    id: string;
    email: string;
    displayName: string | null;
    role: "owner" | "member";
  }>;
};

export type GroupExpense = {
  id: string;
  groupId: string;
  title: string;
  category?: ExpenseCategory;
  splitMode?: ExpenseSplitMode;
  expenseDate: string;
  totalAmount: string;
  createdAt: string;
  updatedAt: string;
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

export type LedgerMember = {
  id: string;
  email: string;
  displayName: string | null;
  status: MembershipStatus;
  leftAt: string | null;
};

export type LedgerExpense = {
  id: string;
  groupId: string;
  title: string;
  category: ExpenseCategory;
  splitMode: ExpenseSplitMode;
  expenseDate: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: string;
    email: string;
    displayName: string | null;
  };
  payers: Array<{
    userId: string;
    amount: string;
  }>;
  shares: Array<{
    userId: string;
    amount: string;
  }>;
};

export type LedgerBalance = {
  userId: string;
  balance: string;
};

export type LedgerSettlementSuggestion = {
  fromUserId: string;
  toUserId: string;
  amount: string;
};

export type LedgerSettlement = {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  fromUser: {
    id: string;
    email: string;
    displayName: string | null;
  };
  toUser: {
    id: string;
    email: string;
    displayName: string | null;
  };
  amount: string;
  paidAt: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type GroupLedger = {
  groupId: string;
  members: LedgerMember[];
  expenses: LedgerExpense[];
  balances: LedgerBalance[];
  settleUpSuggestions: LedgerSettlementSuggestion[];
  settlements: LedgerSettlement[];
};

export type Invitation = {
  id: string;
  status: "pending";
  createdAt: string;
  respondedAt: string | null;
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

export type ExpensePayload = {
  title: string;
  expenseDate: string;
  payers: Array<{
    userId: string;
    amountPaid: string;
  }>;
};

export type LedgerExpensePayload = ExpensePayload & {
  category: ExpenseCategory;
  splitMode: ExpenseSplitMode;
  participants: Array<{
    userId: string;
    included: boolean;
    percentage?: string;
    amountOwed?: string;
  }>;
};

export type SettlementPayload = {
  fromUserId: string;
  toUserId: string;
  amount: string;
};
