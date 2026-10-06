"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";
import { queryOne } from "@/lib/db";
import { createSession, deleteSession } from "@/lib/session";
import { safeRedirectPath } from "@/lib/safe-redirect";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  next: z.string().optional(),
});

export type LoginState = { error?: string; email?: string } | undefined;

type UserRow = { id: number; name: string; role: "clinician" | "admin"; password_hash: string };

// Server actions are public POST endpoints: validate everything, trust nothing from the client.
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, email: String(formData.get("email") ?? "") };
  }
  const { email, password, next } = parsed.data;

  const user = queryOne<UserRow>("SELECT id, name, role, password_hash FROM users WHERE email = ?", email);
  // Same message whether the email or the password is wrong - don't reveal which accounts exist.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return { error: "Invalid email or password", email };
  }

  await createSession({ userId: user.id, name: user.name, role: user.role });
  redirect(safeRedirectPath(next));
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
