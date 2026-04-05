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

async function addMemberToGroup(
  store: InMemoryStore,
  groupId: string,
  ownerUserId: string,
  memberUserId: string
) {
  const invitation = await store.createInvitation(groupId, memberUserId, ownerUserId);
  await store.acceptInvitation(invitation.id, memberUserId);
}

describe("ledger routes", () => {
  test("returns balances, settle-up suggestions, and settlement history for group members only", async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });
    const owner = await registerMember(app, "owner@example.com", "Morgan");
    const member = await registerMember(app, "member@example.com", "Avery");
    const outsider = await registerMember(app, "outsider@example.com", "Jules");
    const groupId = await createGroup(app, owner.cookie, "Weekend House");

    await addMemberToGroup(store, groupId, owner.userId, member.userId);

    await store.createExpense({
      groupId,
      createdByUserId: owner.userId,
      title: "Dinner",
      category: "food",
      splitMode: "equal",
      expenseDate: new Date("2026-04-08T00:00:00.000Z"),
      participants: [
        { userId: owner.userId, included: true },
        { userId: member.userId, included: true }
      ],
      payers: [{ userId: owner.userId, amountPaid: "30.00" }]
    });

    await store.createSettlement({
      groupId,
      fromUserId: member.userId,
      toUserId: owner.userId,
      amount: "5.00",
      paidAt: new Date("2026-04-09T09:30:00.000Z"),
      createdByUserId: member.userId
    });

    const ledgerResponse = await request(app)
      .get(`/groups/${groupId}/ledger`)
      .set("Cookie", member.cookie);

    expect(ledgerResponse.status).toBe(200);
    expect(ledgerResponse.body.balances).toEqual([
      { userId: owner.userId, balance: "20.00" },
      { userId: member.userId, balance: "-20.00" }
    ]);
    expect(ledgerResponse.body.settleUpSuggestions).toEqual([
      { fromUserId: member.userId, toUserId: owner.userId, amount: "20.00" }
    ]);
    expect(ledgerResponse.body.settlements).toEqual([
      expect.objectContaining({
        fromUserId: member.userId,
        toUserId: owner.userId,
        amount: "5.00",
        paidAt: "2026-04-09T09:30:00.000Z"
      })
    ]);

    const outsiderResponse = await request(app)
      .get(`/groups/${groupId}/ledger`)
      .set("Cookie", outsider.cookie);

    expect(outsiderResponse.status).toBe(403);
    expect(outsiderResponse.body.error).toBe("Only group members can view the ledger.");
  });

  test("validates percentage and exact split payloads with ledger normalization rules", async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });
    const owner = await registerMember(app, "owner@example.com", "Morgan");
    const member = await registerMember(app, "member@example.com", "Avery");
    const groupId = await createGroup(app, owner.cookie, "Ski Trip");

    await addMemberToGroup(store, groupId, owner.userId, member.userId);

    const invalidPercentage = await request(app)
      .post(`/groups/${groupId}/expenses`)
      .set("Cookie", owner.cookie)
      .send({
        title: "Dinner",
        category: "food",
        splitMode: "percentage",
        expenseDate: "2026-04-10",
        payers: [{ userId: owner.userId, amountPaid: "20.00" }],
        participants: [
          { userId: owner.userId, percentage: "60" },
          { userId: member.userId, percentage: "30" }
        ]
      });

    expect(invalidPercentage.status).toBe(400);
    expect(invalidPercentage.body.error).toBe("Percentages must sum to exactly 100.");

    const invalidExact = await request(app)
      .post(`/groups/${groupId}/expenses`)
      .set("Cookie", owner.cookie)
      .send({
        title: "Cab",
        category: "transport",
        splitMode: "exact",
        expenseDate: "2026-04-10",
        payers: [{ userId: owner.userId, amountPaid: "20.00" }],
        participants: [
          { userId: owner.userId, amountOwed: "12.00" },
          { userId: member.userId, amountOwed: "7.00" }
        ]
      });

    expect(invalidExact.status).toBe(400);
    expect(invalidExact.body.error).toBe("Exact split amounts must sum to the expense total.");
  });

  test("rejects incomplete rich expense payloads missing category, split mode, or participants", async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });
    const owner = await registerMember(app, "owner@example.com", "Morgan");
    const member = await registerMember(app, "member@example.com", "Avery");
    const groupId = await createGroup(app, owner.cookie, "Road Trip");

    await addMemberToGroup(store, groupId, owner.userId, member.userId);

    for (const body of [
      {
        title: "Dinner",
        splitMode: "equal",
        expenseDate: "2026-04-10",
        payers: [{ userId: owner.userId, amountPaid: "20.00" }],
        participants: [
          { userId: owner.userId },
          { userId: member.userId }
        ]
      },
      {
        title: "Dinner",
        category: "food",
        expenseDate: "2026-04-10",
        payers: [{ userId: owner.userId, amountPaid: "20.00" }],
        participants: [
          { userId: owner.userId },
          { userId: member.userId }
        ]
      },
      {
        title: "Dinner",
        category: "food",
        splitMode: "equal",
        expenseDate: "2026-04-10",
        payers: [{ userId: owner.userId, amountPaid: "20.00" }]
      }
    ]) {
      const response = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .set("Cookie", owner.cookie)
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "Enter a title, category, split mode, date, at least one payer, and participants."
      );
    }
  });

  test("creates settlements with the same direction supplied by the request and rejects amounts above the current debt", async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });
    const owner = await registerMember(app, "owner@example.com", "Morgan");
    const member = await registerMember(app, "member@example.com", "Avery");
    const outsider = await registerMember(app, "outsider@example.com", "Jules");
    const groupId = await createGroup(app, owner.cookie, "Lake Trip");

    await addMemberToGroup(store, groupId, owner.userId, member.userId);

    await store.createExpense({
      groupId,
      createdByUserId: owner.userId,
      title: "Dinner",
      category: "food",
      splitMode: "equal",
      expenseDate: new Date("2026-04-08T00:00:00.000Z"),
      participants: [
        { userId: owner.userId, included: true },
        { userId: member.userId, included: true }
      ],
      payers: [{ userId: owner.userId, amountPaid: "30.00" }]
    });

    const outsiderResponse = await request(app)
      .post(`/groups/${groupId}/settlements`)
      .set("Cookie", outsider.cookie)
      .send({
        fromUserId: member.userId,
        toUserId: owner.userId,
        amount: "10.00"
      });

    expect(outsiderResponse.status).toBe(403);
    expect(outsiderResponse.body.error).toBe("Only group members can record settlements.");

    const tooLargeResponse = await request(app)
      .post(`/groups/${groupId}/settlements`)
      .set("Cookie", member.cookie)
      .send({
        fromUserId: member.userId,
        toUserId: owner.userId,
        amount: "20.00"
      });

    expect(tooLargeResponse.status).toBe(400);
    expect(tooLargeResponse.body.error).toBe("Settlement amount exceeds the current outstanding balance.");

    const settlementResponse = await request(app)
      .post(`/groups/${groupId}/settlements`)
      .set("Cookie", member.cookie)
      .send({
        fromUserId: member.userId,
        toUserId: owner.userId,
        amount: "10.00"
      });

    expect(settlementResponse.status).toBe(201);
    expect(settlementResponse.body.settlement).toEqual(
      expect.objectContaining({
        fromUserId: member.userId,
        toUserId: owner.userId,
        amount: "10.00"
      })
    );

    const ledgerResponse = await request(app)
      .get(`/groups/${groupId}/ledger`)
      .set("Cookie", owner.cookie);

    expect(ledgerResponse.status).toBe(200);
    expect(ledgerResponse.body.settlements).toEqual([
      expect.objectContaining({
        fromUserId: member.userId,
        toUserId: owner.userId,
        amount: "10.00"
      })
    ]);
  });

  test("removes members only for owners and updates the active ledger roster", async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });
    const owner = await registerMember(app, "owner@example.com", "Morgan");
    const member = await registerMember(app, "member@example.com", "Avery");
    const groupId = await createGroup(app, owner.cookie, "Cabin");

    await addMemberToGroup(store, groupId, owner.userId, member.userId);

    const forbiddenRemoval = await request(app)
      .post(`/groups/${groupId}/members/${owner.userId}/remove`)
      .set("Cookie", member.cookie)
      .send();

    expect(forbiddenRemoval.status).toBe(403);
    expect(forbiddenRemoval.body.error).toBe("Only group owners can remove members.");

    const removalResponse = await request(app)
      .post(`/groups/${groupId}/members/${member.userId}/remove`)
      .set("Cookie", owner.cookie)
      .send();

    expect(removalResponse.status).toBe(200);
    expect(removalResponse.body.group.members).toEqual([
      expect.objectContaining({
        id: owner.userId,
        role: "owner"
      })
    ]);

    const ledgerResponse = await request(app)
      .get(`/groups/${groupId}/ledger`)
      .set("Cookie", owner.cookie);

    expect(ledgerResponse.status).toBe(200);
    expect(ledgerResponse.body.members).toEqual([
      expect.objectContaining({
        id: owner.userId,
        status: "active"
      })
    ]);
    expect(ledgerResponse.body.balances).toEqual([{ userId: owner.userId, balance: "0.00" }]);
    expect(ledgerResponse.body.settleUpSuggestions).toEqual([]);
  });

  test("rejects removing the last active member", async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });
    const owner = await registerMember(app, "owner@example.com", "Morgan");
    const groupId = await createGroup(app, owner.cookie, "Solo Trip");

    const removalResponse = await request(app)
      .post(`/groups/${groupId}/members/${owner.userId}/remove`)
      .set("Cookie", owner.cookie)
      .send();

    expect(removalResponse.status).toBe(400);
    expect(removalResponse.body.error).toBe("You cannot remove the last active member.");
  });
});
