import type {
  DashboardData,
  GroupDetail,
  GroupSummary,
  InvitationSummary,
  NewSessionInput,
  NewUserInput,
  PendingInvitation,
  Store,
  StoredSession,
  StoredUser,
  UpdateDisplayNameInput
} from "../../src/store/types";

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

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export class InMemoryStore implements Store {
  private users: StoredUser[] = [];
  private sessions: StoredSession[] = [];
  private groups: StoredGroup[] = [];
  private memberships: StoredMembership[] = [];
  private invitations: StoredInvitation[] = [];

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
      .filter((membership) => membership.userId === userId)
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
      (entry) => entry.groupId === groupId && entry.userId === viewerUserId
    );
    const group = this.groups.find((entry) => entry.id === groupId);

    if (!membership || !group) {
      return null;
    }

    const members = this.memberships
      .filter((entry) => entry.groupId === groupId)
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
        membership.groupId === groupId && membership.userId === userId && membership.role === "owner"
    );
  }

  async isGroupMember(groupId: string, userId: string) {
    return this.memberships.some(
      (membership) => membership.groupId === groupId && membership.userId === userId
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
        createdAt: new Date()
      });
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
}
