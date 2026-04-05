import type {
  ExpensePayload,
  GroupDetail,
  GroupExpense,
  GroupLedger,
  GroupSummary,
  Invitation,
  LedgerExpensePayload,
  SettlementPayload,
  User
} from "../types/shared";
import { ApiError, request } from "./client";

export { ApiError };

export const api = {
  getCurrentUser() {
    return request<{ user: User | null }>("/auth/me");
  },
  register(email: string, password: string) {
    return request<{ user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  login(email: string, password: string) {
    return request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  logout() {
    return request<void>("/auth/logout", {
      method: "POST"
    });
  },
  updateProfile(displayName: string) {
    return request<{ user: User }>("/users/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ displayName })
    });
  },
  listGroups() {
    return request<{ groups: GroupSummary[] }>("/groups");
  },
  createGroup(name: string) {
    return request<{ group: GroupSummary }>("/groups", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  },
  getGroup(groupId: string) {
    return request<{ group: GroupDetail }>(`/groups/${groupId}`);
  },
  getGroupLedger(groupId: string) {
    return request<GroupLedger>(`/groups/${groupId}/ledger`);
  },
  listInvitations() {
    return request<{ invitations: Invitation[] }>("/invitations");
  },
  inviteToGroup(groupId: string, identifier: string) {
    return request<{ invitation: { id: string } }>(`/groups/${groupId}/invitations`, {
      method: "POST",
      body: JSON.stringify({ identifier })
    });
  },
  acceptInvitation(invitationId: string) {
    return request<{ invitation: { id: string } }>(`/invitations/${invitationId}/accept`, {
      method: "POST"
    });
  },
  declineInvitation(invitationId: string) {
    return request<{ invitation: { id: string } }>(`/invitations/${invitationId}/decline`, {
      method: "POST"
    });
  },
  listExpenses(groupId: string) {
    return request<{ expenses: GroupExpense[] }>(`/groups/${groupId}/expenses`);
  },
  createExpense(groupId: string, payload: ExpensePayload | LedgerExpensePayload) {
    return request<{ expense: GroupExpense }>(`/groups/${groupId}/expenses`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateExpense(expenseId: string, payload: ExpensePayload | LedgerExpensePayload) {
    return request<{ expense: GroupExpense }>(`/expenses/${expenseId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  createSettlement(groupId: string, payload: SettlementPayload) {
    return request<{ settlement: GroupLedger["settlements"][number] }>(`/groups/${groupId}/settlements`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  removeGroupMember(groupId: string, memberId: string) {
    return request<{ group: GroupDetail }>(`/groups/${groupId}/members/${memberId}/remove`, {
      method: "POST"
    });
  },
  deleteExpense(expenseId: string) {
    return request<void>(`/expenses/${expenseId}`, {
      method: "DELETE"
    });
  }
};
