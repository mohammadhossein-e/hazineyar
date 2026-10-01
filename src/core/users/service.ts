import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import {
  createUserSchema,
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
 * Creates a staff account the bot can immediately resolve. Telegram is the only
 * adapter, so the channel is fixed here rather than asked for.
 *
 * A repeated Telegram id is refused up front with a readable message: the bot
 * looks users up by (channel, externalId), so a duplicate would silently make
 * the new row unreachable and the old name would be used instead.
 */
export async function createStaffUser(input: CreateStaffUserInput) {
  const data = createUserSchema.parse(input);
  await assertProjectsExist(data.projectIds);

  const existing = await getUserByChannel("telegram", data.externalId);
  if (existing) {
    throw new ValidationError(
      "کاربری با این شناسه تلگرام از قبل ثبت شده است؛ همان کاربر را ویرایش کنید",
    );
  }

  return prisma.user.create({
    data: {
      name: data.name,
      channel: "telegram",
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
