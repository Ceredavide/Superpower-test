import type { GroupExpense, GroupLedger, LedgerSettlement, StoredUser } from "../store/types";

export function serializeUser(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName
  };
}

export function serializeExpense(expense: GroupExpense) {
  return {
    ...expense,
    expenseDate: expense.expenseDate.toISOString().slice(0, 10),
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString()
  };
}

export function serializeLedgerSettlement(settlement: LedgerSettlement) {
  return {
    ...settlement,
    paidAt: settlement.paidAt.toISOString(),
    createdAt: settlement.createdAt.toISOString(),
    updatedAt: settlement.updatedAt.toISOString()
  };
}

export function serializeLedger(ledger: GroupLedger) {
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
