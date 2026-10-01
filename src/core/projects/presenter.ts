/** A project as the API and the admin screen see it. */
export type PresentedProject = {
  id: string;
  name: string;
  isActive: boolean;
  /** Live (not soft-deleted) expenses; absent unless the caller asked for it. */
  expenseCount?: number;
  createdAt: string;
};

type ProjectRow = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  _count?: { expenses: number };
};

export function presentProject(
  project: ProjectRow,
): PresentedProject {
  return {
    id: project.id,
    name: project.name,
    isActive: project.isActive,
    ...(project._count ? { expenseCount: project._count.expenses } : {}),
    createdAt: project.createdAt.toISOString(),
  };
}

export function presentProjects(projects: ProjectRow[]): PresentedProject[] {
  return projects.map(presentProject);
}
