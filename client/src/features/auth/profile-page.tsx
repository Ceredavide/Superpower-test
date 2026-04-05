import { startTransition, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { type AppRouteProps } from "../../app/session";
import { api, ApiError } from "../../core/api";

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

export function ProfilePage({ session, onUserChange }: AppRouteProps) {
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
