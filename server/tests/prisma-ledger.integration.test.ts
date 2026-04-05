import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { PrismaStore } from "../src/store/prisma-store";
import type { Store } from "../src/store/types";

const runIntegration = Boolean(process.env.DATABASE_URL);
const maybeDescribe = runIntegration ? describe : describe.skip;

maybeDescribe("Prisma ledger persistence integration", () => {
  const prisma = new PrismaClient();
  const store: Store = new PrismaStore(prisma);

  let ownerId = "";
  let memberId = "";
  let departedId = "";
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

    if (departedId) {
      await prisma.user.deleteMany({ where: { id: departedId } });
    }

    ownerId = "";
    memberId = "";
    departedId = "";
    groupId = "";
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("persists split-mode expenses, settlements, and membership state", async () => {
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ownerId = `owner_${uniqueSuffix}`;
    memberId = `member_${uniqueSuffix}`;
    departedId = `departed_${uniqueSuffix}`;

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
        },
        {
          id: departedId,
          email: `${departedId}@example.com`,
          passwordHash: "hash",
          displayName: "Rowan",
          displayNameNormalized: `rowan_${uniqueSuffix}`
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
        },
        {
          groupId,
          userId: departedId,
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
        { userId: memberId, included: true },
        { userId: departedId, included: true }
      ],
      payers: [
        { userId: ownerId, amountPaid: "12.00" },
        { userId: departedId, amountPaid: "18.00" }
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
      [departedId, "10.00"],
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
        { userId: ownerId, included: true, amountOwed: "6.00" },
        { userId: memberId, included: true, amountOwed: "12.00" },
        { userId: departedId, included: true, amountOwed: "12.00" }
      ],
      payers: [
        { userId: ownerId, amountPaid: "18.00" },
        { userId: departedId, amountPaid: "12.00" }
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
      [departedId, "12.00"],
      [memberId, "12.00"],
      [ownerId, "6.00"]
    ]);

    const settlement = await store.createSettlement({
      groupId,
      fromUserId: memberId,
      toUserId: ownerId,
      amount: "2.50",
      paidAt: new Date("2026-04-10T00:00:00.000Z"),
      createdByUserId: ownerId
    });

    const departedSettlement = await store.createSettlement({
      groupId,
      fromUserId: departedId,
      toUserId: ownerId,
      amount: "4.00",
      paidAt: new Date("2026-04-10T12:00:00.000Z"),
      createdByUserId: ownerId
    });

    expect(settlement).toMatchObject({
      groupId,
      fromUserId: memberId,
      toUserId: ownerId,
      amount: "2.50"
    });
    expect(departedSettlement).toMatchObject({
      groupId,
      fromUserId: departedId,
      toUserId: ownerId,
      amount: "4.00"
    });

    const settlements = await prisma.settlement.findMany({
      where: { groupId }
    });

    expect(settlements).toHaveLength(2);
    expect(
      settlements.map((settlement) => ({
        ...settlement,
        amount: settlement.amount.toFixed(2)
      }))
    ).toEqual([
      expect.objectContaining({
        groupId,
        fromUserId: memberId,
        toUserId: ownerId,
        amount: "2.50",
        createdByUserId: ownerId
      }),
      expect.objectContaining({
        groupId,
        fromUserId: departedId,
        toUserId: ownerId,
        amount: "4.00",
        createdByUserId: ownerId
      })
    ]);

    const removedGroup = await store.removeGroupMember(groupId, departedId);

    expect(removedGroup).toMatchObject({
      id: groupId
    });
    expect(removedGroup?.members.map((member) => member.id)).toEqual([ownerId, memberId]);

    const ledger = await store.getLedger(groupId, ownerId);

    expect(ledger?.members.map((member) => member.id)).toEqual([ownerId, memberId]);
    expect(ledger?.balances).toEqual([
      { userId: ownerId, balance: "16.50" },
      { userId: memberId, balance: "-16.50" }
    ]);
    expect(ledger?.settleUpSuggestions).toEqual([
      { fromUserId: memberId, toUserId: ownerId, amount: "16.50" }
    ]);
    expect(ledger?.expenses[0].payers.map((payer) => [payer.userId, payer.amount])).toEqual([
      [ownerId, "24.00"],
      [memberId, "6.00"]
    ]);
    expect(ledger?.expenses[0].shares.map((share) => [share.userId, share.amount])).toEqual([
      [ownerId, "12.00"],
      [memberId, "18.00"]
    ]);
    expect(ledger?.settlements.map((entry) => [entry.fromUserId, entry.toUserId, entry.amount])).toEqual([
      [memberId, ownerId, "2.50"],
      [departedId, ownerId, "4.00"]
    ]);
    expect(await store.isGroupMember(groupId, departedId)).toBe(false);
  });

  test("transfers ownership when the current owner removes themself", async () => {
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_self`;
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

    const removedGroup = await store.removeGroupMember(groupId, ownerId);

    expect(removedGroup?.ownerId).toBe(memberId);
    expect(removedGroup?.members).toEqual([
      expect.objectContaining({
        id: memberId,
        role: "owner"
      })
    ]);

    const memberView = await store.getGroupDetail(groupId, memberId);

    expect(memberView?.ownerId).toBe(memberId);
    expect(memberView?.members).toEqual([
      expect.objectContaining({
        id: memberId,
        role: "owner"
      })
    ]);
    expect(await store.isGroupMember(groupId, ownerId)).toBe(false);
  });
});
