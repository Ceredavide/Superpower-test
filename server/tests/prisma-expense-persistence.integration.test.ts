import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { PrismaStore } from "../src/store/prisma-store";

const runIntegration = Boolean(process.env.DATABASE_URL);
const maybeDescribe = runIntegration ? describe : describe.skip;

maybeDescribe("Prisma expense persistence integration", () => {
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

  test("creates, lists oldest-first, updates, and deletes expenses", async () => {
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ownerId = `owner_${uniqueSuffix}`;
    memberId = `member_${uniqueSuffix}`;

    expect(store.supportsExpenses()).toBe(true);

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

    const laterExpense = await store.createExpense({
      groupId,
      createdByUserId: ownerId,
      title: "Later expense",
      expenseDate: new Date("2026-04-08T00:00:00.000Z"),
      payers: [
        { userId: ownerId, amountPaid: "10.00" },
        { userId: memberId, amountPaid: "5.00" }
      ]
    });

    const earlierExpense = await store.createExpense({
      groupId,
      createdByUserId: memberId,
      title: "Earlier expense",
      expenseDate: new Date("2026-04-06T00:00:00.000Z"),
      payers: [{ userId: memberId, amountPaid: "30.00" }]
    });

    await store.createExpense({
      groupId,
      createdByUserId: ownerId,
      title: "Same day first",
      expenseDate: new Date("2026-04-10T00:00:00.000Z"),
      payers: [{ userId: ownerId, amountPaid: "12.00" }]
    });

    await store.createExpense({
      groupId,
      createdByUserId: ownerId,
      title: "Same day second",
      expenseDate: new Date("2026-04-10T00:00:00.000Z"),
      payers: [{ userId: ownerId, amountPaid: "8.00" }]
    });

    const listedExpenses = await store.listExpensesForGroup(groupId);

    expect(listedExpenses.map((expense) => expense.title)).toEqual([
      "Earlier expense",
      "Later expense",
      "Same day first",
      "Same day second"
    ]);

    const updatedExpense = await store.updateExpense({
      expenseId: laterExpense.id,
      title: "Later expense updated",
      expenseDate: new Date("2026-04-09T00:00:00.000Z"),
      payers: [
        { userId: ownerId, amountPaid: "7.50" },
        { userId: memberId, amountPaid: "2.50" }
      ]
    });

    expect(updatedExpense).not.toBeNull();
    expect(updatedExpense).toMatchObject({
      title: "Later expense updated",
      totalAmount: "10.00"
    });

    const foundUpdatedExpense = await store.findExpenseById(laterExpense.id);

    expect(foundUpdatedExpense).toMatchObject({
      title: "Later expense updated",
      totalAmount: "10.00"
    });

    expect(await store.deleteExpense(earlierExpense.id)).toBe(true);
    expect(await store.findExpenseById(earlierExpense.id)).toBeNull();

    const remainingExpenses = await store.listExpensesForGroup(groupId);

    expect(remainingExpenses.map((expense) => expense.title)).toEqual([
      "Later expense updated",
      "Same day first",
      "Same day second"
    ]);
  });
});
