import { startTransition, useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams
} from "react-router-dom";

import { api, ApiError } from "./api";
import { GroupExpensesSection } from "./components/group-expenses-section";
import type { GroupDetail, GroupSummary, Invitation, User } from "./types";

type SessionState = {
  isLoading: boolean;
  user: User | null;
};

type AppRouteProps = {
  session: SessionState;
  onUserChange: (user: User | null) => void;
};

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

function AppShell({
  user,
  onLogout,
  children
}: {
  user: User;
  onLogout: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    await onLogout();
    setIsLoggingOut(false);
  }

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Ledger Lane</p>
          <h1>Shared expense groups, without the spreadsheet sprawl.</h1>
        </div>
        <div className="topbar-actions">
          <div className="identity-card">
            <span className="identity-name">{user.displayName ?? user.email}</span>
            <span className="identity-email">{user.email}</span>
          </div>
          <button className="secondary-button" onClick={handleLogout} disabled={isLoggingOut}>
            {isLoggingOut ? "Logging out..." : "Log out"}
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

function HomeRedirect({ session }: { session: SessionState }) {
  if (session.isLoading) {
    return <LoadingScreen />;
  }

  if (!session.user) {
    return <Navigate to="/auth" replace />;
  }

  if (!session.user.displayName) {
    return <Navigate to="/profile" replace />;
  }

  return <Navigate to="/dashboard" replace />;
}

function ProtectedRoute({
  session,
  requireCompletedProfile = true,
  children
}: {
  session: SessionState;
  requireCompletedProfile?: boolean;
  children: React.ReactNode;
}) {
  if (session.isLoading) {
    return <LoadingScreen />;
  }

  if (!session.user) {
    return <Navigate to="/auth" replace />;
  }

  if (requireCompletedProfile && !session.user.displayName) {
    return <Navigate to="/profile" replace />;
  }

  return <>{children}</>;
}

function AuthPage({ session, onUserChange }: AppRouteProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!session.isLoading && session.user) {
    return <Navigate to={session.user.displayName ? "/dashboard" : "/profile"} replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response =
        mode === "register" ? await api.register(email, password) : await api.login(email, password);

      startTransition(() => {
        onUserChange(response.user);
      });

      navigate(response.user.displayName ? "/dashboard" : "/profile", { replace: true });
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to continue right now.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-layout">
      <section className="hero-panel">
        <p className="eyebrow">Ledger Lane</p>
        <h1>Split your shared costs</h1>
        <p className="hero-copy">
          Create private expense groups, invite registered members, and keep the record anchored in a
          real PostgreSQL database.
        </p>
        <div className="feature-ribbon">
          <span>Persistent auth</span>
          <span>Group ownership</span>
          <span>Invite by email or name</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="mode-switch" role="tablist" aria-label="Authentication mode">
          <button
            className={mode === "register" ? "mode-button is-active" : "mode-button"}
            onClick={() => setMode("register")}
            type="button"
          >
            Sign up
          </button>
          <button
            className={mode === "login" ? "mode-button is-active" : "mode-button"}
            onClick={() => setMode("login")}
            type="button"
          >
            Log in
          </button>
        </div>

        <form className="card-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email address</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting
              ? mode === "register"
                ? "Creating account..."
                : "Logging in..."
              : mode === "register"
                ? "Create account"
                : "Log in"}
          </button>
        </form>
      </section>
    </div>
  );
}

function ProfilePage({ session, onUserChange }: AppRouteProps) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (session.isLoading) {
    return <LoadingScreen />;
  }

  if (!session.user) {
    return <Navigate to="/auth" replace />;
  }

  if (session.user.displayName) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await api.updateProfile(displayName);
      startTransition(() => {
        onUserChange(response.user);
      });
      navigate("/dashboard", { replace: true });
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to save your profile.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="single-panel-layout">
      <section className="profile-panel">
        <p className="eyebrow">Complete your profile</p>
        <h1>Choose your display name</h1>
        <p className="hero-copy">
          Invitations can match you by name or email, so this is the identity other members will see.
        </p>

        <form className="card-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Display name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Morgan"
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Saving..." : "Save profile"}
          </button>
        </form>
      </section>
    </div>
  );
}

function DashboardPage({ session, onUserChange }: AppRouteProps) {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

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

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function handleCreateGroup(event: React.FormEvent<HTMLFormElement>) {
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
    <ProtectedRoute session={session}>
      <AppShell
        user={session.user!}
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
    </ProtectedRoute>
  );
}

function GroupPage({ session, onUserChange }: AppRouteProps) {
  const { groupId = "" } = useParams();
  const location = useLocation();
  const currentUserId = session.user?.id ?? "";
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [inviteIdentifier, setInviteIdentifier] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isInviting, setIsInviting] = useState(false);

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

  useEffect(() => {
    void loadGroup();
  }, [groupId, location.key]);

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
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

  return (
    <ProtectedRoute session={session}>
      <AppShell
        user={session.user!}
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

              <GroupExpensesSection currentUserId={currentUserId} group={group} />
            </>
          ) : null}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}

function AppRoutes() {
  const [session, setSession] = useState<SessionState>({ isLoading: true, user: null });

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await api.getCurrentUser();

        if (!cancelled) {
          startTransition(() => {
            setSession({ isLoading: false, user: response.user });
          });
        }
      } catch {
        if (!cancelled) {
          setSession({ isLoading: false, user: null });
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleUserChange(user: User | null) {
    setSession((current) => ({ ...current, user }));
  }

  return (
    <Routes>
      <Route path="/" element={<HomeRedirect session={session} />} />
      <Route path="/auth" element={<AuthPage onUserChange={handleUserChange} session={session} />} />
      <Route path="/profile" element={<ProfilePage onUserChange={handleUserChange} session={session} />} />
      <Route
        path="/dashboard"
        element={<DashboardPage onUserChange={handleUserChange} session={session} />}
      />
      <Route path="/groups/:groupId" element={<GroupPage onUserChange={handleUserChange} session={session} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
