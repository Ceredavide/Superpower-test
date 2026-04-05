import type { Express } from "express";
import { z } from "zod";

import { createAuthHelpers, normalizeDisplayName, normalizeEmail } from "../../app/auth-helpers";
import type { Store } from "../../store/types";

const groupSchema = z.object({
  name: z.string().trim().min(1)
});

const invitationSchema = z.object({
  identifier: z.string().trim().min(1)
});

type GroupRouteDeps = {
  store: Store;
} & Pick<
  ReturnType<typeof createAuthHelpers>,
  "requireCompletedProfile" | "requireUser"
>;

export function registerGroupRoutes(app: Express, deps: GroupRouteDeps) {
  const { requireCompletedProfile, requireUser, store } = deps;

  app.get("/groups", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const groups = await store.listGroupsForUser(user.id);
    response.status(200).json({ groups });
  });

  app.post("/groups", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    if (!requireCompletedProfile(user, response)) {
      return;
    }

    const parsed = groupSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Group name is required." });
    }

    const group = await store.createGroup(parsed.data.name.trim(), user.id);
    return response.status(201).json({ group });
  });

  app.get("/groups/:groupId", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const group = await store.getGroupDetail(request.params.groupId, user.id);

    if (!group) {
      return response.status(404).json({ error: "Group not found." });
    }

    return response.status(200).json({ group });
  });

  app.get("/invitations", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    const invitations = await store.listPendingInvitationsForUser(user.id);
    return response.status(200).json({ invitations });
  });

  app.post("/groups/:groupId/invitations", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    if (!requireCompletedProfile(user, response)) {
      return;
    }

    const parsed = invitationSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({ error: "Enter an email or display name to invite." });
    }

    const groupId = request.params.groupId;
    const canInvite = await store.isGroupOwner(groupId, user.id);

    if (!canInvite) {
      return response.status(403).json({ error: "Only group owners can invite members." });
    }

    const identifier = parsed.data.identifier.trim();
    const target = z.string().email().safeParse(identifier).success
      ? await store.findUserByEmail(normalizeEmail(identifier))
      : await store.findUserByDisplayNameNormalized(normalizeDisplayName(identifier));

    if (!target) {
      return response.status(400).json({ error: "Only registered users can be invited." });
    }

    if (await store.isGroupMember(groupId, target.id)) {
      return response.status(409).json({ error: "That user is already a member of the group." });
    }

    if (await store.hasPendingInvitation(groupId, target.id)) {
      return response.status(409).json({ error: "That user already has a pending invitation." });
    }

    const invitation = await store.createInvitation(groupId, target.id, user.id);
    return response.status(201).json({ invitation });
  });

  app.post("/invitations/:invitationId/accept", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    if (!requireCompletedProfile(user, response)) {
      return;
    }

    const invitation = await store.acceptInvitation(request.params.invitationId, user.id);

    if (!invitation) {
      return response.status(404).json({ error: "Invitation not found." });
    }

    return response.status(200).json({ invitation });
  });

  app.post("/invitations/:invitationId/decline", async (request, response) => {
    const user = await requireUser(request, response);

    if (!user) {
      return;
    }

    if (!requireCompletedProfile(user, response)) {
      return;
    }

    const invitation = await store.declineInvitation(request.params.invitationId, user.id);

    if (!invitation) {
      return response.status(404).json({ error: "Invitation not found." });
    }

    return response.status(200).json({ invitation });
  });
}
