import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import {
  createUserSchema,
  userNameSchema,
  type CreateStaffUserInput,
  type UserProjectsInput,
} from "./schemas";

/** Active users: the dashboard's recorder filter offers only these by default. */
export async function listUsers() {
  return prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

const USER_WITH_PROJECTS = {
  userProjects: {
    include: { project: true },
    orderBy: { project: { name: "asc" } },
  },
} as const;

/** Every user, active or not, with the projects they may record on. */
export async function listAllUsers() {
  return prisma.user.findMany({
    include: USER_WITH_PROJECTS,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

/** Users are addressed across channels by (channel, externalId). */
export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function getUserByChannel(channel: string, externalId: string) {
  return prisma.user.findUnique({
    where: { channel_externalId: { channel, externalId } },
  });
}

export async function createUser(data: {
  name: string;
  channel: string;
  externalId: string;
  role?: Role;
}) {
  return prisma.user.create({
    data: { ...data, role: data.role ?? "EMPLOYEE" },
  });
}

/** Projects this user is allowed to record expenses for. */
export async function listProjectsForUser(userId: string) {
  const user = await getUserById(userId);
  if (!user) throw new NotFoundError("کاربر یافت نشد");
  if (!user.isActive) throw new ForbiddenError("کاربر غیرفعال است");

  if (user.role === "ADMIN") {
    return prisma.project.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
  }

  const links = await prisma.userProject.findMany({
    where: { userId },
    include: { project: true },
    orderBy: { project: { name: "asc" } },
  });

  return links.map((l) => l.project).filter((p) => p.isActive);
}

/** Throws unless every id is a real project, so links cannot dangle. */
async function assertProjectsExist(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) return;
  const found = await prisma.project.count({ where: { id: { in: projectIds } } });
  if (found !== projectIds.length) {
    throw new ValidationError("یک یا چند پروژه انتخاب‌شده وجود ندارد");
  }
}

/**
 * Creates a staff account the bot can immediately resolve on its channel.
 *
 * A repeated (channel, externalId) is refused up front with a readable message:
 * the bot looks users up by that pair, so a duplicate would silently make the
 * new row unreachable and the old name would be used instead. The same id is
 * fine on a *different* channel, which is why the check is scoped to one.
 */
export async function createStaffUser(input: CreateStaffUserInput) {
  const data = createUserSchema.parse(input);
  await assertProjectsExist(data.projectIds);

  const existing = await getUserByChannel(data.channel, data.externalId);
  if (existing) {
    throw new ValidationError(
      "کاربری با این شناسه در این پیام‌رسان از قبل ثبت شده است؛ همان کاربر را ویرایش کنید",
    );
  }

  return prisma.user.create({
    data: {
      name: data.name,
      channel: data.channel,
      externalId: data.externalId,
      role: data.role,
      userProjects: { create: data.projectIds.map((projectId) => ({ projectId })) },
    },
    include: USER_WITH_PROJECTS,
  });
}

export async function getUserOrThrow(id: string) {
  const user = await getUserById(id);
  if (!user) throw new NotFoundError("کاربر یافت نشد");
  return user;
}

/**
 * The first active user already carrying this name, ignoring `exceptId`.
 *
 * Names are deliberately not unique — two employees can genuinely share one —
 * so this only feeds a soft "someone else has this name" warning; it never
 * blocks a write.
 */
export async function findActiveUserByName(name: string, exceptId?: string) {
  return prisma.user.findFirst({
    where: {
      isActive: true,
      name,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, name: true },
  });
}

/** The soft warning shown when an active user already shares a name, if any. */
export async function duplicateNameWarning(
  name: string,
  exceptId?: string,
): Promise<string | undefined> {
  const existing = await findActiveUserByName(name, exceptId);
  return existing ? "کاربر دیگری با این نام وجود دارد" : undefined;
}

/**
 * Renames a user in place.
 *
 * Expenses reference the user by id, so every historical row, the dashboard and
 * the Excel export start showing the new name at once — that is the intended
 * behaviour, not a data migration. There is no user-audit table, so the change
 * is recorded with the existing logging approach (a structured console line).
 */
export async function renameUser(id: string, name: string) {
  const parsed = userNameSchema.parse(name);
  const before = await getUserOrThrow(id);

  if (before.name === parsed) {
    return prisma.user.findUniqueOrThrow({
      where: { id },
      include: USER_WITH_PROJECTS,
    });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { name: parsed },
    include: USER_WITH_PROJECTS,
  });

  console.info(`[users] renamed user ${id} from "${before.name}" to "${parsed}"`);

  return updated;
}

/**
 * Deactivating a user keeps their expenses: the history stays attributed to
 * them, the dashboard still reports it, and the bot refuses new entries because
 * `listProjectsForUser` and `assertCanRecordFor` both check `isActive`.
 */
export async function setUserActive(id: string, isActive: boolean) {
  await getUserOrThrow(id);
  return prisma.user.update({
    where: { id },
    data: { isActive },
    include: USER_WITH_PROJECTS,
  });
}

/**
 * Replaces a user's project links in one transaction, so the access list is
 * never briefly empty. Unchecking every project is allowed: that is how access
 * is revoked without deactivating the account.
 */
export async function setUserProjects(
  id: string,
  input: UserProjectsInput,
) {
  await getUserOrThrow(id);
  const projectIds = [...new Set(input.projectIds)];
  await assertProjectsExist(projectIds);

  await prisma.$transaction(async (tx) => {
    await tx.userProject.deleteMany({ where: { userId: id } });
    if (projectIds.length > 0) {
      await tx.userProject.createMany({
        data: projectIds.map((projectId) => ({ userId: id, projectId })),
      });
    }
  });

  return prisma.user.findUniqueOrThrow({
    where: { id },
    include: USER_WITH_PROJECTS,
  });
}
