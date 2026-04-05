import { useState, type ReactNode } from "react";

import type { User } from "../core/types/shared";

export function AppShell({
  user,
  onLogout,
  children
}: {
  user: User;
  onLogout: () => Promise<void>;
  children: ReactNode;
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
