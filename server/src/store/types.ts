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

export interface Store {
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
}
