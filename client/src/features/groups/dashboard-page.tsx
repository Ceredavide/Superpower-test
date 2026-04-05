import { startTransition, useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { AppShell } from "../../app/app-shell";
import { type AppRouteProps } from "../../app/session";
import { api, ApiError } from "../../core/api";
import type { GroupSummary, Invitation } from "../../core/types/shared";

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-card">
        <p className="eyebrow">Ledger Lane</p>
        <h1>Loading the application...</h1>
      </div>
    </div>
  );
}

export function DashboardPage({ session, onUserChange }: AppRouteProps) {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  useEffect(() => {
    void loadDashboard();
  }, []);

  if (session.isLoading) {
    return <LoadingScreen />;
  }

  if (!session.user) {
    return <Navigate to="/auth" replace />;
  }

  if (!session.user.displayName) {
    return <Navigate to="/profile" replace />;
  }

  async function loadDashboard() {
    setIsLoading(true);

    try {
      const [groupsResponse, invitationsResponse] = await Promise.all([
        api.listGroups(),
        api.listInvitations()
      ]);

      startTransition(() => {
        setGroups(groupsResponse.groups);
        setInvitations(invitationsResponse.invitations);
      });
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load your dashboard.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreatingGroup(true);
    setError("");

    try {
      const response = await api.createGroup(groupName);
      setGroupName("");
      await loadDashboard();
      navigate(`/groups/${response.group.id}`);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to create the group.");
    } finally {
      setIsCreatingGroup(false);
    }
  }

  async function handleInvitationAction(invitationId: string, action: "accept" | "decline") {
    setError("");

    try {
      if (action === "accept") {
        await api.acceptInvitation(invitationId);
      } else {
        await api.declineInvitation(invitationId);
      }

      await loadDashboard();
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError ? caughtError.message : "Unable to update that invitation right now."
      );
    }
  }

  return (
    <AppShell
      user={session.user}
      onLogout={async () => {
        await api.logout();
        startTransition(() => {
          onUserChange(null);
        });
      }}
    >
      <div className="dashboard-grid">
        <section className="surface-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">New group</p>
              <h2>Start a shared tab</h2>
            </div>
          </div>

          <form className="inline-form" onSubmit={handleCreateGroup}>
            <label className="field">
              <span>Group name</span>
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Weekend House"
              />
            </label>
            <button className="primary-button" disabled={isCreatingGroup} type="submit">
              {isCreatingGroup ? "Creating..." : "Create group"}
            </button>
          </form>

          {error ? <p className="form-error">{error}</p> : null}
        </section>

        <section className="surface-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Dashboard</p>
              <h2>Your groups</h2>
            </div>
          </div>

          {isLoading ? <p className="muted-copy">Loading your groups...</p> : null}
          {!isLoading && groups.length === 0 ? (
            <p className="muted-copy">Create your first expense group to get started.</p>
          ) : null}
          <div className="stack-list">
            {groups.map((group) => (
              <Link className="list-card" key={group.id} to={`/groups/${group.id}`}>
                <strong>{group.name}</strong>
                <span>{group.role === "owner" ? "Owner" : "Member"}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="surface-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Pending invites</p>
              <h2>Invitation inbox</h2>
            </div>
          </div>

          {!isLoading && invitations.length === 0 ? (
            <p className="muted-copy">No invites waiting on you right now.</p>
          ) : null}

          <div className="stack-list">
            {invitations.map((invitation) => (
              <article className="list-card invite-card" key={invitation.id}>
                <div>
                  <strong>{invitation.group.name}</strong>
                  <p>Invited by {invitation.invitedBy.displayName ?? invitation.invitedBy.email}</p>
                </div>
                <div className="button-row">
                  <button
                    className="secondary-button"
                    onClick={() => void handleInvitationAction(invitation.id, "decline")}
                    type="button"
                  >
                    Decline
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => void handleInvitationAction(invitation.id, "accept")}
                    type="button"
                  >
                    Accept
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
