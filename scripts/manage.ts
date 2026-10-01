/**
 * Staff-provisioning CLI.
 *
 * The dashboard's admin screen at /dashboard/admin is the normal way to do all
 * of this; this script is the same operations for a terminal or a deployment
 * script, and it calls exactly the same core services, so validation and
 * Persian error messages are identical either way.
 *
 * Usage:
 *   npm run manage -- list-users
 *   npm run manage -- create-user --name "سعید" --external 100445 \
 *       --role employee --projects proj-saadatabad,proj-pasdaran
 *   npm run manage -- deactivate-user --external 100445
 *   npm run manage -- reactivate-user --external 100445
 *   npm run manage -- list-projects
 *   npm run manage -- create-project --id proj-gharb --name "غرب تهران"
 *   npm run manage -- deactivate-project --id proj-gharb
 *   npm run manage -- reactivate-project --id proj-gharb
 *   npm run manage -- link-user --external 100445 --project proj-gharb
 *
 * `--external` is the user's numeric Telegram id (the value `update.from.id`
 * emits); the bot resolves users by (channel, externalId). `--channel` defaults
 * to `telegram`. The bot is the only adapter, so the channel is not a real
 * choice here and stays hardcoded in the core service.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { DomainError } from "@/core/errors";
import {
  createProject,
  listAllProjects,
  setProjectActive,
} from "@/core/projects/service";
import {
  createStaffUser,
  getUserByChannel,
  listAllUsers,
  setUserActive,
  setUserProjects,
} from "@/core/users/service";
import { createUserSchema } from "@/core/users/schemas";

const [command, ...argv] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function required(name: string): string {
  const value = flag(name);
  if (!value) throw new Error(`Missing required flag ${name}`);
  return value;
}

const ID_PATTERN = /^[a-z][a-z0-9-]{2,}$/;

function externalId(): string {
  return required("--external");
}

async function resolveUser(channel: string, telegramId: string) {
  const user = await getUserByChannel(channel, telegramId);
  if (!user) throw new DomainError("NOT_FOUND", `کاربر ${channel}/${telegramId} یافت نشد`);
  return user;
}

async function listUsers() {
  for (const user of await listAllUsers()) {
    const projects =
      user.userProjects.map((link) => link.project.name).join("، ") || "—";
    console.log(
      `${user.isActive ? "•" : "∘"} ${user.name} (${user.role}) ` +
        `${user.channel}/${user.externalId} — پروژه‌ها: ${projects}`,
    );
  }
}

async function createUser() {
  const { name, externalId: telegramId, role, projectIds } = createUserSchema.parse({
    name: required("--name"),
    externalId: externalId(),
    role: flag("--role") ?? "EMPLOYEE",
    projectIds: (flag("--projects") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  });

  const user = await createStaffUser({
    name,
    externalId: telegramId,
    role,
    projectIds,
  });
  console.log(
    `کاربر «${user.name}» (${user.id}) با نقش ${user.role} و ` +
      `${user.userProjects.length} پروژه ساخته شد.`,
  );
}

async function setUserState(isActive: boolean) {
  const user = await resolveUser(flag("--channel") ?? "telegram", externalId());
  await setUserActive(user.id, isActive);
  console.log(
    isActive
      ? `کاربر «${user.name}» فعال شد.`
      : `کاربر «${user.name}» غیرفعال شد؛ هزینه‌های قبلی او دست‌نخورده می‌ماند.`,
  );
}

async function listProjects() {
  for (const project of await listAllProjects()) {
    console.log(
      `${project.isActive ? "•" : "∘"} ${project.id} — ${project.name} ` +
        `(${project._count.expenses} هزینه)`,
    );
  }
}

async function createProjectCommand() {
  const name = required("--name");
  const id = flag("--id");
  if (id && !ID_PATTERN.test(id)) {
    throw new Error("--id must look like proj-something (lowercase letters, digits, dashes)");
  }

  const project = await createProject(name);
  // The service lets Postgres generate the id; a requested one is only
  // honoured when it is free, so a collision is reported instead of silently
  // re-pointing an existing project.
  const saved = id
    ? await prisma.project.update({ where: { id: project.id }, data: { id } })
    : project;
  console.log(`پروژه «${saved.name}» (${saved.id}) ساخته شد.`);
}

async function setProjectState(isActive: boolean) {
  const project = await setProjectActive(required("--id"), isActive);
  console.log(
    isActive
      ? `پروژه «${project.name}» فعال شد.`
      : `پروژه «${project.name}» غیرفعال شد؛ از انتخاب ربات و فیلترهای پیش‌فرض حذف می‌شود ولی گزارش‌هایش می‌ماند.`,
  );
}

async function linkUser() {
  const user = await resolveUser(flag("--channel") ?? "telegram", externalId());
  const projectId = required("--project");
  const current = await prisma.userProject.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  const merged = [...new Set([...current.map((link) => link.projectId), projectId])];
  await setUserProjects(user.id, { projectIds: merged });
  console.log(`پیوند شد: ${user.name} ↔ ${projectId}`);
}

async function main() {
  switch (command) {
    case "list-users": return listUsers();
    case "create-user": return createUser();
    case "deactivate-user": return setUserState(false);
    case "reactivate-user": return setUserState(true);
    case "list-projects": return listProjects();
    case "create-project": return createProjectCommand();
    case "deactivate-project": return setProjectState(false);
    case "reactivate-project": return setProjectState(true);
    case "link-user": return linkUser();
    default: {
      console.error(
        "Usage: npm run manage -- <command> [flags]\n\n" +
          "commands: list-users, create-user, deactivate-user, reactivate-user,\n" +
          "          list-projects, create-project, deactivate-project, reactivate-project, link-user",
      );
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    // Domain errors already carry the Persian message the UI shows.
    console.error(
      "[manage]",
      error instanceof DomainError || error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
