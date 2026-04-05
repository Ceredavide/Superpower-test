import { startTransition, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { type AppRouteProps } from "../../app/session";
import { api, ApiError } from "../../core/api";

export function AuthPage({ session, onUserChange }: AppRouteProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!session.isLoading && session.user) {
    return <Navigate to={session.user.displayName ? "/dashboard" : "/profile"} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
