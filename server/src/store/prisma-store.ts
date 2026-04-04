import type { PrismaClient } from "@prisma/client";

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
} from "./types";

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

export class PrismaStore implements Store {
  constructor(private readonly prisma: PrismaClient) {}

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
    const group = await this.prisma.$transaction(async (tx) => {
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
          role: "owner"
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
      where: { userId },
      include: {
        group: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return memberships.map((membership) =>
      toGroupSummary({
        role: membership.role,
        group: membership.group
      })
    );
  }

  async getGroupDetail(groupId: string, viewerUserId: string): Promise<GroupDetail | null> {
    const membership = await this.prisma.groupMembership.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: viewerUserId
        }
      },
      include: {
        group: {
          include: {
            memberships: {
              include: {
                user: true
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
      members: membership.group.memberships.map((entry) => ({
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
        role: "owner"
      }
    });

    return count > 0;
  }

  async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.groupMembership.count({
      where: {
        groupId,
        userId
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

    return invitations.map((invitation) => ({
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
    return this.prisma.$transaction(async (tx) => {
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
          role: "member"
        },
        update: {}
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
}
