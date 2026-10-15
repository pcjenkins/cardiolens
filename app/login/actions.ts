"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { ApiError, gqlService } from "@/lib/api";
import { createSession, deleteSession } from "@/lib/session";
import { safeRedirectPath } from "@/lib/safe-redirect";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  next: z.string().optional(),
});

export type LoginState = { error?: string; email?: string } | undefined;

type AuthResult = { authenticate: { user: { id: string; name: string; role: "clinician" | "admin" } | null; error: string | null } };

const AUTHENTICATE = `mutation Authenticate($email: String!, $password: String!) {
  authenticate(email: $email, password: $password) { user { id name role } error }
}`;

// Server actions are public POST endpoints: validate everything, trust nothing from the client.
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, email: String(formData.get("email") ?? "") };
  }
  const { email, password, next } = parsed.data;

  // The password check happens in the data tier (which holds the hashes); this tier never sees a hash.
  let result: AuthResult;
  try {
    result = await gqlService<AuthResult>(AUTHENTICATE, { email, password });
  } catch (e) {
    return { error: e instanceof ApiError && e.code === "UNAVAILABLE" ? "Sign-in is unavailable: the data service is not running." : "Sign-in failed. Try again.", email };
  }
  const user = result.authenticate.user;
  // Same message whether the email or the password is wrong - don't reveal which accounts exist.
  if (!user) return { error: "Invalid email or password", email };

  await createSession({ userId: Number(user.id), name: user.name, role: user.role });
  redirect(safeRedirectPath(next));
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
