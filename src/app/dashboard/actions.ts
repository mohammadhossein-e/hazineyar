"use server";

import { redirect } from "next/navigation";
import { endSession, startSession, verifyAdminPassword } from "@/lib/auth";

const LOGIN_PATH = "/dashboard/login";

/**
 * Both actions end in a redirect: on to the dashboard, or back to the form with
 * an error flag. `redirect` throws internally, so it must stay out of any
 * try/catch here or the navigation would be swallowed.
 */
export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");

  if (!verifyAdminPassword(password)) {
    // The attempt itself is worth seeing; the password never is.
    console.warn("[dashboard] rejected a login attempt");
    // Online-guessing throttle: a fixed delay per failed attempt with no
    // per-IP store. Retarding only the failure path keeps happy-path login
    // instant while making an exhaustive run over an 8+ char password
    // impractical over the network. Not a substitute for real auth.
    await new Promise((resolve) => setTimeout(resolve, 400));
    redirect(`${LOGIN_PATH}?error=1`);
  }

  await startSession();
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect(LOGIN_PATH);
}
