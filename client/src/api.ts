import type { GroupDetail, GroupSummary, Invitation, User } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError((data.error as string | undefined) ?? "Something went wrong.", response.status);
  }

  return data as T;
}

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
  }
};
