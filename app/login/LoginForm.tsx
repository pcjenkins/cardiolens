"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export default function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);

  return (
    <form action={action} className="card login-card" noValidate>
      <h1>Sign in</h1>
      <p className="muted">CardioLens case analytics</p>

      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="username"
             defaultValue={state?.email ?? "demo@cardiolens.test"} required />

      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />

      {next && <input type="hidden" name="next" value={next} />}
      {state?.error && <p role="alert" className="error">{state.error}</p>}

      <button type="submit" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</button>
      <p className="hint">Demo login: demo@cardiolens.test / Demo123!</p>
    </form>
  );
}
