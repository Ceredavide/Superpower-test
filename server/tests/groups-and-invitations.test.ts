import request from "supertest";
import { describe, expect, test } from "vitest";

import { createApp } from "../src/app";
import { InMemoryStore } from "./support/in-memory-store";

async function registerAndCompleteProfile(app: ReturnType<typeof createApp>, input: {
  email: string;
  password?: string;
  displayName: string;
}) {
  const password = input.password ?? "supersecret";
  const registerResponse = await request(app).post("/auth/register").send({
    email: input.email,
    password
  });

  const cookie = registerResponse.headers["set-cookie"][0];

  await request(app).patch("/users/me/profile").set("Cookie", cookie).send({
    displayName: input.displayName
  });

  return { cookie, password };
}

describe("group and invitation routes", () => {
  test("creates a group and lists it on the dashboard", async () => {
    const app = createApp({ store: new InMemoryStore() });
    const owner = await registerAndCompleteProfile(app, {
      email: "owner@example.com",
      displayName: "Morgan"
    });

    const createGroupResponse = await request(app).post("/groups").set("Cookie", owner.cookie).send({
      name: "April Trip"
    });

    expect(createGroupResponse.status).toBe(201);
    expect(createGroupResponse.body.group).toMatchObject({
      name: "April Trip",
      role: "owner"
    });

    const listGroupsResponse = await request(app).get("/groups").set("Cookie", owner.cookie);

    expect(listGroupsResponse.status).toBe(200);
    expect(listGroupsResponse.body.groups).toHaveLength(1);
    expect(listGroupsResponse.body.groups[0]).toMatchObject({
      name: "April Trip",
      role: "owner"
    });
  });

  test("invites a registered user by email, then accepts the invite into the group", async () => {
    const app = createApp({ store: new InMemoryStore() });
    const owner = await registerAndCompleteProfile(app, {
      email: "owner@example.com",
      displayName: "Morgan"
    });
    const member = await registerAndCompleteProfile(app, {
      email: "member@example.com",
      displayName: "Avery"
    });

    const createGroupResponse = await request(app).post("/groups").set("Cookie", owner.cookie).send({
      name: "Weekend House"
    });
    const groupId = createGroupResponse.body.group.id as string;

    const inviteResponse = await request(app)
      .post(`/groups/${groupId}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ identifier: "member@example.com" });

    expect(inviteResponse.status).toBe(201);

    const invitationsResponse = await request(app).get("/invitations").set("Cookie", member.cookie);

    expect(invitationsResponse.status).toBe(200);
    expect(invitationsResponse.body.invitations).toHaveLength(1);
    expect(invitationsResponse.body.invitations[0]).toMatchObject({
      group: { name: "Weekend House" },
      invitedBy: { displayName: "Morgan" }
    });

    const invitationId = invitationsResponse.body.invitations[0].id as string;

    const acceptResponse = await request(app)
      .post(`/invitations/${invitationId}/accept`)
      .set("Cookie", member.cookie);

    expect(acceptResponse.status).toBe(200);

    const groupDetailResponse = await request(app).get(`/groups/${groupId}`).set("Cookie", member.cookie);

    expect(groupDetailResponse.status).toBe(200);
    expect(groupDetailResponse.body.group.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: "Morgan", role: "owner" }),
        expect.objectContaining({ displayName: "Avery", role: "member" })
      ])
    );
  });

  test("invites a registered user by display name and blocks duplicate pending invites", async () => {
    const app = createApp({ store: new InMemoryStore() });
    const owner = await registerAndCompleteProfile(app, {
      email: "owner@example.com",
      displayName: "Morgan"
    });

    await registerAndCompleteProfile(app, {
      email: "member@example.com",
      displayName: "Avery"
    });

    const createGroupResponse = await request(app).post("/groups").set("Cookie", owner.cookie).send({
      name: "Ski Trip"
    });
    const groupId = createGroupResponse.body.group.id as string;

    const firstInvite = await request(app)
      .post(`/groups/${groupId}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ identifier: "Avery" });

    expect(firstInvite.status).toBe(201);

    const duplicateInvite = await request(app)
      .post(`/groups/${groupId}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ identifier: "avery" });

    expect(duplicateInvite.status).toBe(409);
    expect(duplicateInvite.body.error).toBe("That user already has a pending invitation.");
  });
});
