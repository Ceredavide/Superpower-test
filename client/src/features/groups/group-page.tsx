import { startTransition, useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";

import { AppShell } from "../../app/app-shell";
import { type AppRouteProps } from "../../app/session";
import { api, ApiError } from "../../core/api";
import type { GroupDetail } from "../../core/types/shared";
import { GroupLedgerSection } from "../ledger/group-ledger-section";

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

export function GroupPage({ session, onUserChange }: AppRouteProps) {
  const { groupId = "" } = useParams();
  const location = useLocation();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [inviteIdentifier, setInviteIdentifier] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isInviting, setIsInviting] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  useEffect(() => {
    void loadGroup();
  }, [groupId, location.key]);

  if (session.isLoading) {
    return <LoadingScreen />;
  }

  if (!session.user) {
    return <Navigate to="/auth" replace />;
  }

  if (!session.user.displayName) {
    return <Navigate to="/profile" replace />;
  }

  const currentUserId = session.user.id;

  async function loadGroup() {
    setIsLoading(true);

    try {
      const response = await api.getGroup(groupId);
      setGroup(response.group);
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load that group.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsInviting(true);
    setError("");
    setSuccessMessage("");

    try {
      await api.inviteToGroup(groupId, inviteIdentifier);
      setInviteIdentifier("");
      setSuccessMessage("Invitation sent.");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to send that invite.");
    } finally {
      setIsInviting(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    setRemovingMemberId(memberId);
    setError("");
    setSuccessMessage("");

    try {
      const response = await api.removeGroupMember(groupId, memberId);
      setGroup(response.group);
      setSuccessMessage("Member removed.");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to remove that member.");
    } finally {
      setRemovingMemberId(null);
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
      <div className="group-layout">
        <Link className="back-link" to="/dashboard">
          ← Back to dashboard
        </Link>

        {isLoading ? <p className="muted-copy">Loading group...</p> : null}
        {error ? <p className="form-error">{error}</p> : null}

        {group ? (
          <>
            <section className="surface-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{group.role === "owner" ? "Owner view" : "Member view"}</p>
                  <h2>{group.name}</h2>
                </div>
              </div>

              <div className="member-grid">
                {group.members.map((member) => (
                  <article className="member-card" key={member.id}>
                    <strong>{member.displayName ?? member.email}</strong>
                    <span>{member.role === "owner" ? "Owner" : "Member"}</span>
                    <small>{member.email}</small>
                    {group.role === "owner" && member.id !== currentUserId ? (
                      <button
                        className="secondary-button member-action-button"
                        disabled={removingMemberId === member.id}
                        onClick={() => void handleRemoveMember(member.id)}
                        type="button"
                      >
                        {removingMemberId === member.id ? "Removing..." : "Remove member"}
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            {group.role === "owner" ? (
              <section className="surface-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Invite someone</p>
                    <h2>Add a registered member</h2>
                  </div>
                </div>

                <form className="inline-form" onSubmit={handleInvite}>
                  <label className="field">
                    <span>Email or display name</span>
                    <input
                      value={inviteIdentifier}
                      onChange={(event) => setInviteIdentifier(event.target.value)}
                      placeholder="avery@example.com or Avery"
                    />
                  </label>
                  <button className="primary-button" disabled={isInviting} type="submit">
                    {isInviting ? "Sending..." : "Send invite"}
                  </button>
                </form>

                {successMessage ? <p className="form-success">{successMessage}</p> : null}
              </section>
            ) : null}

            <GroupLedgerSection currentUserId={currentUserId} group={group} />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
