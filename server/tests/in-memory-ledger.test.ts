import { describe, expect, test } from "vitest";

import { InMemoryStore } from "./support/in-memory-store";

describe("InMemoryStore core ledger persistence", () => {
  test("keeps settlement effects after removing a departed member", async () => {
    const store = new InMemoryStore();

    const owner = await store.createUser({
      email: "owner@example.com",
      passwordHash: "hash"
    });
    const member = await store.createUser({
      email: "member@example.com",
      passwordHash: "hash"
    });
    const departed = await store.createUser({
      email: "departed@example.com",
      passwordHash: "hash"
    });

    const group = await store.createGroup("Weekend House", owner.id);

    const memberInvitation = await store.createInvitation(group.id, member.id, owner.id);
    await store.acceptInvitation(memberInvitation.id, member.id);

    const departedInvitation = await store.createInvitation(group.id, departed.id, owner.id);
    await store.acceptInvitation(departedInvitation.id, departed.id);

    await store.createExpense({
      groupId: group.id,
      createdByUserId: owner.id,
      title: "Shared dinner",
      expenseDate: new Date("2026-04-08T00:00:00.000Z"),
      category: "food",
      splitMode: "equal",
      participants: [
        { userId: owner.id, included: true },
        { userId: member.id, included: true },
        { userId: departed.id, included: true }
      ],
      payers: [
        { userId: owner.id, amountPaid: "12.00" },
        { userId: departed.id, amountPaid: "18.00" }
      ]
    });

    await store.updateExpense({
      expenseId: (await store.listExpensesForGroup(group.id))[0].id,
      title: "Shared dinner updated",
      expenseDate: new Date("2026-04-09T00:00:00.000Z"),
      category: "transport",
      splitMode: "exact",
      participants: [
        { userId: owner.id, included: true, amountOwed: "6.00" },
        { userId: member.id, included: true, amountOwed: "12.00" },
        { userId: departed.id, included: true, amountOwed: "12.00" }
      ],
      payers: [
        { userId: owner.id, amountPaid: "18.00" },
        { userId: departed.id, amountPaid: "12.00" }
      ]
    });

    await store.createSettlement({
      groupId: group.id,
      fromUserId: member.id,
      toUserId: owner.id,
      amount: "2.50",
      paidAt: new Date("2026-04-10T00:00:00.000Z"),
      createdByUserId: owner.id
    });

    await store.createSettlement({
      groupId: group.id,
      fromUserId: departed.id,
      toUserId: owner.id,
      amount: "4.00",
      paidAt: new Date("2026-04-10T12:00:00.000Z"),
      createdByUserId: owner.id
    });

    const removedGroup = await store.removeGroupMember(group.id, departed.id);
    expect(removedGroup?.members.map((entry) => entry.id)).toEqual([owner.id, member.id]);

    const ledger = await store.getLedger(group.id, owner.id);

    expect(ledger?.balances).toEqual([
      { userId: owner.id, balance: "16.50" },
      { userId: member.id, balance: "-16.50" }
    ]);
    expect(ledger?.settleUpSuggestions).toEqual([
      { fromUserId: member.id, toUserId: owner.id, amount: "16.50" }
    ]);
    expect(ledger?.settlements.map((entry) => [entry.fromUserId, entry.toUserId, entry.amount])).toEqual([
      [member.id, owner.id, "2.50"],
      [departed.id, owner.id, "4.00"]
    ]);
  });

  test("transfers ownership when the current owner removes themself", async () => {
    const store = new InMemoryStore();

    const owner = await store.createUser({
      email: "owner-self@example.com",
      passwordHash: "hash"
    });
    const member = await store.createUser({
      email: "member-self@example.com",
      passwordHash: "hash"
    });

    const group = await store.createGroup("Weekend House", owner.id);
    const invitation = await store.createInvitation(group.id, member.id, owner.id);
    await store.acceptInvitation(invitation.id, member.id);

    const removedGroup = await store.removeGroupMember(group.id, owner.id);

    expect(removedGroup?.ownerId).toBe(member.id);
    expect(removedGroup?.members).toEqual([
      expect.objectContaining({
        id: member.id,
        role: "owner"
      })
    ]);
    expect(await store.isGroupMember(group.id, owner.id)).toBe(false);
    expect(await store.isGroupOwner(group.id, member.id)).toBe(true);

    const memberView = await store.getGroupDetail(group.id, member.id);
    expect(memberView?.ownerId).toBe(member.id);
    expect(memberView?.members).toEqual([
      expect.objectContaining({
        id: member.id,
        role: "owner"
      })
    ]);
  });
});
