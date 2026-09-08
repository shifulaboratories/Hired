import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { sweepArchive } from "@/lib/data/archive";
import { generatePassphrase } from "@/lib/passphrase";
import { CLAIMED, ensureDefaultConnection, hashPassword } from "@/lib/auth";

/**
 * First-boot provisioning.
 *
 * Self-hosting should not begin with "invent a password and paste it into an
 * environment variable". On first start this creates the owner account, makes
 * up a strong password, and prints it once to the server log. The only variable
 * you have to set anywhere is DATABASE_URL, and your host fills that in for you.
 *
 * Claiming the instance at boot rather than through an open /setup page also
 * closes the window where a stranger who found the URL could claim it first.
 */


function banner(lines: string[]) {
  const width = Math.max(...lines.map((line) => line.length), 58);
  const rule = "═".repeat(width + 2);
  // Written straight to stdout so it survives whatever log formatting is in play.
  process.stdout.write(
    `\n╔${rule}╗\n` +
      lines.map((line) => `║ ${line.padEnd(width)} ║`).join("\n") +
      `\n╚${rule}╝\n\n`,
  );
}

function publicUrl() {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL;
  if (!domain) return null;
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

async function ownerEmail() {
  const configured = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (configured) return configured;
  return "owner@localhost";
}

/**
 * Creates the owner if nobody has claimed the instance yet. Adopts the
 * placeholder row left by the multi-tenant migration, so data from a
 * single-user install changes hands instead of being orphaned.
 */
export async function ensureOwner() {
  const claimed = await db.user.count({ where: CLAIMED });
  if (claimed > 0) {
    await maybeResetOwnerPassword();
    return;
  }

  const email = await ownerEmail();
  // APP_PASSWORD is honoured if you set one, but you never have to.
  const provided = process.env.APP_PASSWORD?.trim();
  const password = provided || generatePassphrase();

  const placeholder = await db.user.findFirst({ where: { passwordHash: "", googleId: null } });
  const data = {
    email,
    name: "",
    passwordHash: hashPassword(password),
    role: "SUPER_ADMIN" as const,
    isActive: true,
    emailProvenAt: new Date(),
  };

  const owner = placeholder
    ? await db.user.update({ where: { id: placeholder.id }, data })
    : await db.user.create({ data });
  await ensureDefaultConnection(owner.id);

  const url = publicUrl();
  banner([
    "Hired is ready — this is your owner account.",
    "",
    ...(url ? [`  Sign in   ${url}`] : []),
    `  Email     ${email}`,
    `  Password  ${password}`,
    "",
    provided
      ? "  (password taken from your APP_PASSWORD variable)"
      : "  This password was generated for you and is shown ONCE.",
    "  Copy it now, then change both from Settings once you're in.",
    "",
    "  Lost it? Set RESET_OWNER_PASSWORD=1 and redeploy to get a new one.",
  ]);
}

/**
 * Recovery hatch for a self-hoster who closed the log. Set
 * RESET_OWNER_PASSWORD=1, redeploy, read the new password, then remove the
 * variable. Signs every existing session out.
 */
async function maybeResetOwnerPassword() {
  const flag = process.env.RESET_OWNER_PASSWORD?.trim().toLowerCase();
  if (!flag || flag === "0" || flag === "false") return;

  const owner = await db.user.findFirst({
    where: { role: "SUPER_ADMIN", ...CLAIMED },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) return;

  const password = generatePassphrase();
  await db.user.update({
    where: { id: owner.id },
    data: { passwordHash: hashPassword(password), isActive: true },
  });
  await db.session.deleteMany({ where: { userId: owner.id } });

  const url = publicUrl();
  banner([
    "Owner password reset.",
    "",
    ...(url ? [`  Sign in   ${url}`] : []),
    `  Email     ${owner.email}`,
    `  Password  ${password}`,
    "",
    "  Remove the RESET_OWNER_PASSWORD variable now, or it will",
    "  reset again on the next deploy.",
  ]);
}

/** Never let provisioning take the server down; log and carry on. */
export async function bootstrap() {
  // Anything whose window ran out while the instance was down. Same rule as
  // ensureOwner: a failure here must not take the server with it.
  void sweepArchive().catch(() => {});
  try {
    await ensureOwner();
  } catch (error) {
    console.error(
      "[bootstrap] Could not provision the owner account:",
      error instanceof Error ? error.message : error,
    );
    console.error("[bootstrap] Visit /setup to create it by hand.");
  }
}
