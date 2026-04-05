import { Navigate, Route, Routes } from "react-router-dom";

import { type SessionState, useAppSession } from "./session";
import { AuthPage } from "../features/auth/auth-page";
import { ProfilePage } from "../features/auth/profile-page";
import { DashboardPage } from "../features/groups/dashboard-page";
import { GroupPage } from "../features/groups/group-page";

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

export function AppRoutes() {
  const { session, handleUserChange } = useAppSession();

  return (
    <Routes>
      <Route path="/" element={<HomeRedirect session={session} />} />
      <Route path="/auth" element={<AuthPage onUserChange={handleUserChange} session={session} />} />
      <Route path="/profile" element={<ProfilePage onUserChange={handleUserChange} session={session} />} />
      <Route path="/dashboard" element={<DashboardPage onUserChange={handleUserChange} session={session} />} />
      <Route path="/groups/:groupId" element={<GroupPage onUserChange={handleUserChange} session={session} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
