import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getSetupStatus } from "@/lib/setup";

/** Setup is only reachable while the instance has no accounts (unless sign-up is re-enabled). */
export async function requireSetupMode(): Promise<void> {
  const status = await getSetupStatus();
  const allowSignup = process.env.ALLOW_SIGNUP === "true" || process.env.ALLOW_SIGNUP === "1";
  if (!status.needsSetup && !allowSignup) redirect("/login");
}

/** Login is not useful before the first account exists. */
export async function requireLoginMode(): Promise<void> {
  const status = await getSetupStatus();
  const allowSignup = process.env.ALLOW_SIGNUP === "true" || process.env.ALLOW_SIGNUP === "1";
  if (status.needsSetup && !allowSignup) redirect("/setup");
}

export async function redirectIfAuthenticated(): Promise<void> {
  const user = await getSessionUser();
  if (user) redirect("/");
}
