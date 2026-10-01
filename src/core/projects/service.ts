import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "../errors";
import { projectNameSchema } from "./schemas";

/** Active projects: what the expense filters and the bot's picker offer. */
export async function listProjects() {
  return prisma.project.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Every project, active or not, with its live expense count. The admin screen
 * needs the inactive ones to show (and re-activate) them, while the expense
 * list needs both sets to report on history. Soft-deleted expenses are left out
 * of the count, since they are invisible everywhere else.
 */
export async function listAllProjects() {
  return prisma.project.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { expenses: { where: { deletedAt: null } } } },
    },
  });
}

export async function getProject(id: string) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw new NotFoundError("پروژه یافت نشد");
  return project;
}

/**
 * Names only have to be unique among the active projects: a name may be reused
 * once the old project is deactivated, which is how a site that is finished and
 * a new one under the same name can coexist.
 */
export async function createProject(name: string) {
  const clean = projectNameSchema.parse(name);

  const duplicate = await prisma.project.findFirst({
    where: { isActive: true, name: { equals: clean } },
    select: { id: true },
  });
  if (duplicate) {
    throw new ValidationError("پروژه‌ای فعال با این نام از قبل وجود دارد");
  }

  return prisma.project.create({ data: { name: clean } });
}

/**
 * Deactivating a project only closes it for new expenses: its history stays in
 * the database, stays reportable, and the number sequence for it is untouched.
 */
export async function setProjectActive(id: string, isActive: boolean) {
  await getProject(id);
  return prisma.project.update({ where: { id }, data: { isActive } });
}
