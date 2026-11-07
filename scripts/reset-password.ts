import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { closeMongo, collections, now } from "@/lib/db";

/**
 * Resets the password of a credential (email + password) account directly in the
 * database. Use this when the password is forgotten and no email reset flow is
 * configured — this product deliberately ships with no email sending.
 *
 * Usage:
 *   pnpm password:reset --email you@example.com --password 'new-password' --yes
 *
 * Refuses to run without --yes and without both arguments. Also signs out every
 * other session for that account.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const argValue = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index !== -1 ? args[index + 1] : undefined;
  };
  const email = argValue("email")?.trim().toLowerCase();
  const password = argValue("password");
  const confirmed = args.includes("--yes");

  if (!email || !password) {
    console.error(
      [
        "Usage: pnpm password:reset --email you@example.com --password 'new-password' --yes",
        "The new password must be at least 8 characters.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("Refusing to set a password shorter than 8 characters.");
    process.exitCode = 1;
    return;
  }
  if (!confirmed) {
    console.error(
      [
        `Refusing to reset the password for ${email} without confirmation.`,
        "This signs out every session for that account.",
        "Re-run with --yes to proceed.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const user = await collections.user.findOne({ email });
  if (!user) {
    console.error(`No account exists for ${email}.`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  const result = await collections.account.updateOne(
    { userId: user._id, providerId: "credential" },
    { $set: { password: passwordHash, updatedAt: now() } },
  );
  if (!result.matchedCount) {
    console.error(`The account for ${email} has no credential login.`);
    process.exitCode = 1;
    return;
  }
  await collections.session.deleteMany({ userId: user._id });
  console.log(`Password updated for ${email}. All existing sessions were signed out.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo();
  });
