import { Decimal } from "@prisma/client/runtime/library";
import { describe, expect, test, vi } from "vitest";

import { PrismaStore } from "../src/store/prisma-store";

function createPrismaMock() {
  const prisma = {
    expense: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn()
    }
  };

  return prisma;
}

describe("PrismaStore expense persistence", () => {
  test("supports expenses and creates expenses with normalized payer amounts", async () => {
    const prisma = createPrismaMock();
    const store = new PrismaStore(prisma as never);

    const createdAt = new Date("2026-04-04T10:00:00.000Z");
    prisma.expense.create.mockResolvedValue({
      id: "expense_1",
      groupId: "group_1",
      title: "Dinner",
      expenseDate: new Date("2026-04-03T00:00:00.000Z"),
      createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
      createdAt,
      updatedAt: createdAt,
      payers: [
        {
          id: "payer_1",
          amountPaid: new Decimal("12.50"),
          user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }
        },
        {
          id: "payer_2",
          amountPaid: new Decimal("7.5"),
          user: { id: "user_2", email: "member@example.com", displayName: "Avery" }
        }
      ]
    });

    expect(store.supportsExpenses()).toBe(true);

    const expense = await store.createExpense({
      groupId: "group_1",
      createdByUserId: "user_1",
      title: "Dinner",
      expenseDate: new Date("2026-04-03T00:00:00.000Z"),
      payers: [
        { userId: "user_1", amountPaid: "12.5" },
        { userId: "user_2", amountPaid: "7.50" }
      ]
    });

    expect(prisma.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payers: {
            create: [
              { userId: "user_1", amountPaid: new Decimal("12.50") },
              { userId: "user_2", amountPaid: new Decimal("7.50") }
            ]
          }
        })
      })
    );
    expect(expense).toMatchObject({
      totalAmount: "20.00",
      payers: [
        { amountPaid: "12.50", user: { id: "user_1" } },
        { amountPaid: "7.50", user: { id: "user_2" } }
      ]
    });
  });

  test("lists expenses oldest-first and updates payer rows", async () => {
    const prisma = createPrismaMock();
    const store = new PrismaStore(prisma as never);

    prisma.expense.findMany.mockResolvedValue([
      {
        id: "expense_2",
        groupId: "group_1",
        title: "Earlier expense",
        expenseDate: new Date("2026-04-06T00:00:00.000Z"),
        createdBy: { id: "user_2", email: "member@example.com", displayName: "Avery" },
        createdAt: new Date("2026-04-06T12:00:00.000Z"),
        updatedAt: new Date("2026-04-06T12:00:00.000Z"),
        payers: [
          {
            id: "payer_2",
            amountPaid: new Decimal("30.00"),
            user: { id: "user_2", email: "member@example.com", displayName: "Avery" }
          }
        ]
      },
      {
        id: "expense_1",
        groupId: "group_1",
        title: "Later expense",
        expenseDate: new Date("2026-04-08T00:00:00.000Z"),
        createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
        createdAt: new Date("2026-04-08T12:00:00.000Z"),
        updatedAt: new Date("2026-04-08T12:00:00.000Z"),
        payers: [
          {
            id: "payer_1",
            amountPaid: new Decimal("10.00"),
            user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }
          }
        ]
      }
    ]);

    const expenses = await store.listExpensesForGroup("group_1");

    expect(prisma.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { groupId: "group_1" },
        orderBy: [{ expenseDate: "asc" }, { createdAt: "asc" }]
      })
    );
    expect(expenses.map((expense) => expense.title)).toEqual([
      "Earlier expense",
      "Later expense"
    ]);

    prisma.expense.findUnique.mockResolvedValueOnce({
      id: "expense_1",
      groupId: "group_1",
      title: "Later expense",
      expenseDate: new Date("2026-04-08T00:00:00.000Z"),
      createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
      createdAt: new Date("2026-04-08T12:00:00.000Z"),
      updatedAt: new Date("2026-04-08T12:00:00.000Z"),
      payers: [
        {
          id: "payer_1",
          amountPaid: new Decimal("10.00"),
          user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }
        }
      ]
    });

    const foundExpense = await store.findExpenseById("expense_1");

    expect(foundExpense).toMatchObject({
      id: "expense_1",
      totalAmount: "10.00"
    });

    prisma.expense.findUnique.mockResolvedValueOnce({
      id: "expense_1",
      groupId: "group_1",
      title: "Later expense",
      expenseDate: new Date("2026-04-08T00:00:00.000Z"),
      createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
      createdAt: new Date("2026-04-08T12:00:00.000Z"),
      updatedAt: new Date("2026-04-08T12:00:00.000Z"),
      payers: []
    });
    prisma.expense.update.mockResolvedValueOnce({
      id: "expense_1",
      groupId: "group_1",
      title: "Updated expense",
      expenseDate: new Date("2026-04-09T00:00:00.000Z"),
      createdBy: { id: "user_1", email: "owner@example.com", displayName: "Morgan" },
      createdAt: new Date("2026-04-08T12:00:00.000Z"),
      updatedAt: new Date("2026-04-09T12:00:00.000Z"),
      payers: [
        {
          id: "payer_3",
          amountPaid: new Decimal("5.00"),
          user: { id: "user_1", email: "owner@example.com", displayName: "Morgan" }
        }
      ]
    });

    const updatedExpense = await store.updateExpense({
      expenseId: "expense_1",
      title: "Updated expense",
      expenseDate: new Date("2026-04-09T00:00:00.000Z"),
      payers: [{ userId: "user_1", amountPaid: "5" }]
    });

    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "expense_1" },
        data: expect.objectContaining({
          payers: {
            deleteMany: {},
            create: [{ userId: "user_1", amountPaid: new Decimal("5.00") }]
          }
        })
      })
    );
    expect(updatedExpense?.totalAmount).toBe("5.00");
    prisma.expense.deleteMany.mockResolvedValueOnce({ count: 1 });
    prisma.expense.count.mockResolvedValueOnce(1);

    expect(await store.deleteExpense("expense_1")).toBe(true);
    expect(await store.isExpenseCreator("expense_1", "user_1")).toBe(true);
  });
});
