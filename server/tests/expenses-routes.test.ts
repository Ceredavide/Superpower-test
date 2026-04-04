import request from "supertest";
import { describe, expect, test } from "vitest";

import { createApp } from "../src/app";
import { InMemoryStore } from "./support/in-memory-store";

async function registerMember(
  app: ReturnType<typeof createApp>,
  email: string,
  displayName: string
) {
  const registerResponse = await request(app).post("/auth/register").send({
    email,
    password: "supersecret"
  });

  const cookie = registerResponse.headers["set-cookie"][0];

  await request(app).patch("/users/me/profile").set("Cookie", cookie).send({
    displayName
  });

  return {
    cookie,
    userId: registerResponse.body.user.id as string
  };
}

async function createGroup(app: ReturnType<typeof createApp>, cookie: string, name: string) {
  const response = await request(app).post("/groups").set("Cookie", cookie).send({ name });
  return response.body.group.id as string;
}

describe("expense routes", () => {
  test("creates expenses, lists them oldest-first, and returns computed totals", async () => {
    const app = createApp({ store: new InMemoryStore() });
    const owner = await registerMember(app, "owner@example.com", "Morgan");
    const member = await registerMember(app, "member@example.com", "Avery");
    const groupId = await createGroup(app, owner.cookie, "Weekend House");

    await request(app)
      .post(`/groups/${groupId}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ identifier: "Avery" });

    const invitations = await request(app).get("/invitations").set("Cookie", member.cookie);

    await request(app)
      .post(`/invitations/${invitations.body.invitations[0].id}/accept`)
      .set("Cookie", member.cookie);

    await request(app).post(`/groups/${groupId}/expenses`).set("Cookie", owner.cookie).send({
      title: "Newer expense",
      expenseDate: "2026-04-10",
      payers: [
        { userId: owner.userId, amountPaid: "12.50" },
        { userId: member.userId, amountPaid: "7.50" }
      ]
    });

    const olderExpense = await request(app)
      .post(`/groups/${groupId}/expenses`)
      .set("Cookie", member.cookie)
      .send({
        title: "Older expense",
        expenseDate: "2026-04-06",
        payers: [{ userId: member.userId, amountPaid: "30.00" }]
      });

    expect(olderExpense.status).toBe(201);

    const listResponse = await request(app)
      .get(`/groups/${groupId}/expenses`)
      .set("Cookie", member.cookie);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.expenses.map((expense: { title: string }) => expense.title)).toEqual([
      "Older expense",
      "Newer expense"
    ]);
    expect(listResponse.body.expenses[1]).toMatchObject({
      totalAmount: "20.00",
      payers: [
        expect.objectContaining({ amountPaid: "12.50" }),
        expect.objectContaining({ amountPaid: "7.50" })
      ]
    });
  });

  test("rejects non-members, non-member payers, duplicate payers, and zero-value amounts", async () => {
    const app = createApp({ store: new InMemoryStore() });
    const owner = await registerMember(app, "owner@example.com", "Morgan");
    const member = await registerMember(app, "member@example.com", "Avery");
    const outsider = await registerMember(app, "outsider@example.com", "Jules");
    const groupId = await createGroup(app, owner.cookie, "Ski Trip");

    await request(app)
      .post(`/groups/${groupId}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ identifier: "Avery" });

    const invitations = await request(app).get("/invitations").set("Cookie", member.cookie);

    await request(app)
      .post(`/invitations/${invitations.body.invitations[0].id}/accept`)
      .set("Cookie", member.cookie);

    const createAsOutsider = await request(app)
      .post(`/groups/${groupId}/expenses`)
      .set("Cookie", outsider.cookie)
      .send({
        title: "Lift passes",
        expenseDate: "2026-04-08",
        payers: [{ userId: outsider.userId, amountPaid: "55.00" }]
      });

    expect(createAsOutsider.status).toBe(403);

    const invalidPayer = await request(app)
      .post(`/groups/${groupId}/expenses`)
      .set("Cookie", owner.cookie)
      .send({
        title: "Cab",
        expenseDate: "2026-04-08",
        payers: [{ userId: outsider.userId, amountPaid: "18.00" }]
      });

    expect(invalidPayer.status).toBe(400);
    expect(invalidPayer.body.error).toBe("Each payer must be a current group member.");

    const duplicatePayer = await request(app)
      .post(`/groups/${groupId}/expenses`)
      .set("Cookie", owner.cookie)
      .send({
        title: "Shared dinner",
        expenseDate: "2026-04-08",
        payers: [
          { userId: member.userId, amountPaid: "12.00" },
          { userId: member.userId, amountPaid: "3.00" }
        ]
      });

    expect(duplicatePayer.status).toBe(400);
    expect(duplicatePayer.body.error).toBe("Each payer can only appear once per expense.");

    const zeroAmount = await request(app)
      .post(`/groups/${groupId}/expenses`)
      .set("Cookie", owner.cookie)
      .send({
        title: "Station parking",
        expenseDate: "2026-04-08",
        payers: [{ userId: owner.userId, amountPaid: "0.00" }]
      });

    expect(zeroAmount.status).toBe(400);
    expect(zeroAmount.body.error).toBe("Amounts must be positive numbers with up to 2 decimal places.");
  });

  test("allows only the creator to edit or delete an expense", async () => {
    const app = createApp({ store: new InMemoryStore() });
    const owner = await registerMember(app, "owner@example.com", "Morgan");
    const member = await registerMember(app, "member@example.com", "Avery");
    const groupId = await createGroup(app, owner.cookie, "Cabin");

    await request(app)
      .post(`/groups/${groupId}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ identifier: "Avery" });

    const invitations = await request(app).get("/invitations").set("Cookie", member.cookie);

    await request(app)
      .post(`/invitations/${invitations.body.invitations[0].id}/accept`)
      .set("Cookie", member.cookie);

    const createExpense = await request(app)
      .post(`/groups/${groupId}/expenses`)
      .set("Cookie", owner.cookie)
      .send({
        title: "Groceries",
        expenseDate: "2026-04-07",
        payers: [{ userId: owner.userId, amountPaid: "42.00" }]
      });

    const expenseId = createExpense.body.expense.id as string;

    const forbiddenEdit = await request(app).patch(`/expenses/${expenseId}`).set("Cookie", member.cookie).send({
      title: "Groceries and snacks",
      expenseDate: "2026-04-07",
      payers: [{ userId: owner.userId, amountPaid: "45.00" }]
    });

    expect(forbiddenEdit.status).toBe(403);

    const ownerEdit = await request(app).patch(`/expenses/${expenseId}`).set("Cookie", owner.cookie).send({
      title: "Groceries and snacks",
      expenseDate: "2026-04-07",
      payers: [
        { userId: owner.userId, amountPaid: "40.00" },
        { userId: member.userId, amountPaid: "5.00" }
      ]
    });

    expect(ownerEdit.status).toBe(200);
    expect(ownerEdit.body.expense.totalAmount).toBe("45.00");

    const forbiddenDelete = await request(app).delete(`/expenses/${expenseId}`).set("Cookie", member.cookie);
    expect(forbiddenDelete.status).toBe(403);

    const ownerDelete = await request(app).delete(`/expenses/${expenseId}`).set("Cookie", owner.cookie);
    expect(ownerDelete.status).toBe(204);
  });
});
