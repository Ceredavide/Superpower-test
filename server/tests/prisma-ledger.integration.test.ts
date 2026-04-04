import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { PrismaStore } from "../src/store/prisma-store";

const runIntegration = Boolean(process.env.DATABASE_URL);
const maybeDescribe = runIntegration ? describe : describe.skip;

maybeDescribe("Prisma ledger persistence integration", () => {
  const prisma = new PrismaClient();
  const store = new PrismaStore(prisma);

  let ownerId = "";
  let memberId = "";
  let groupId = "";

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    if (groupId) {
      await prisma.expenseGroup.deleteMany({ where: { id: groupId } });
    }

    if (ownerId) {
      await prisma.user.deleteMany({ where: { id: ownerId } });
    }

    if (memberId) {
      await prisma.user.deleteMany({ where: { id: memberId } });
    }

    ownerId = "";
    memberId = "";
    groupId = "";
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("persists split-mode expenses, settlements, and membership state", async () => {
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ownerId = `owner_${uniqueSuffix}`;
    memberId = `member_${uniqueSuffix}`;

    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          email: `${ownerId}@example.com`,
          passwordHash: "hash",
          displayName: "Morgan",
          displayNameNormalized: `morgan_${uniqueSuffix}`
        },
        {
          id: memberId,
          email: `${memberId}@example.com`,
          passwordHash: "hash",
          displayName: "Avery",
          displayNameNormalized: `avery_${uniqueSuffix}`
        }
      ]
    });

    const createdGroup = await prisma.expenseGroup.create({
      data: {
        id: `group_${uniqueSuffix}`,
        name: "Weekend House",
        ownerId
      }
    });

    groupId = createdGroup.id;

    await prisma.groupMembership.createMany({
      data: [
        {
          groupId,
          userId: ownerId,
          role: "owner"
        },
        {
          groupId,
          userId: memberId,
          role: "member"
        }
      ]
    });

    const expense = await store.createExpense({
      groupId,
      createdByUserId: ownerId,
      title: "Shared dinner",
      expenseDate: new Date("2026-04-08T00:00:00.000Z"),
      category: "food",
      splitMode: "equal",
      participants: [
        { userId: ownerId, included: true },
        { userId: memberId, included: true }
      ],
      payers: [
        { userId: ownerId, amountPaid: "12.50" },
        { userId: memberId, amountPaid: "7.50" }
      ]
    });

    expect(expense.category).toBe("food");
    expect(expense.splitMode).toBe("equal");

    const expenseShares = await prisma.expenseShare.findMany({
      where: { expenseId: expense.id },
      orderBy: { userId: "asc" }
    });

    expect(
      expenseShares
        .map((share) => [share.userId, share.amount.toFixed(2)])
        .sort((left, right) => left[0].localeCompare(right[0]))
    ).toEqual([
      [memberId, "10.00"],
      [ownerId, "10.00"]
    ]);

    const updatedExpense = await store.updateExpense({
      expenseId: expense.id,
      title: "Shared dinner updated",
      expenseDate: new Date("2026-04-09T00:00:00.000Z"),
      category: "transport",
      splitMode: "exact",
      participants: [
        { userId: ownerId, included: true, amountOwed: "8.00" },
        { userId: memberId, included: true, amountOwed: "12.00" }
      ],
      payers: [
        { userId: ownerId, amountPaid: "15.00" },
        { userId: memberId, amountPaid: "5.00" }
      ]
    });

    expect(updatedExpense).not.toBeNull();
    expect(updatedExpense?.category).toBe("transport");
    expect(updatedExpense?.splitMode).toBe("exact");

    const updatedShares = await prisma.expenseShare.findMany({
      where: { expenseId: expense.id },
      orderBy: { userId: "asc" }
    });

    expect(
      updatedShares
        .map((share) => [share.userId, share.amount.toFixed(2)])
        .sort((left, right) => left[0].localeCompare(right[0]))
    ).toEqual([
      [memberId, "12.00"],
      [ownerId, "8.00"]
    ]);

    const settlement = await (store as any).createSettlement({
      groupId,
      fromUserId: memberId,
      toUserId: ownerId,
      amount: "2.50",
      paidAt: new Date("2026-04-10T00:00:00.000Z"),
      createdByUserId: ownerId
    });

    expect({
      ...settlement,
      amount: settlement.amount.toFixed(2)
    }).toMatchObject({
      groupId,
      fromUserId: memberId,
      toUserId: ownerId,
      amount: "2.50"
    });

    const settlements = await prisma.settlement.findMany({
      where: { groupId }
    });

    expect(settlements).toHaveLength(1);
    expect({
      ...settlements[0],
      amount: settlements[0].amount.toFixed(2)
    }).toMatchObject({
      groupId,
      fromUserId: memberId,
      toUserId: ownerId,
      createdByUserId: ownerId
    });

    const memberBeforeInactive = await prisma.groupMembership.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: memberId
        }
      }
    });

    expect(memberBeforeInactive?.status).toBe("active");
    expect(memberBeforeInactive?.leftAt).toBeNull();

    const leftAt = new Date("2026-04-11T00:00:00.000Z");

    await prisma.groupMembership.update({
      where: {
        groupId_userId: {
          groupId,
          userId: memberId
        }
      },
      data: {
        status: "inactive",
        leftAt
      }
    });

    const memberAfterInactive = await prisma.groupMembership.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: memberId
        }
      }
    });

    expect(memberAfterInactive?.status).toBe("inactive");
    expect(memberAfterInactive?.leftAt).toEqual(leftAt);
    expect(await store.isGroupMember(groupId, memberId)).toBe(false);
  });
});
