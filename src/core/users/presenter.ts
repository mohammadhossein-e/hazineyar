export const ROLE_LABELS = {
  ADMIN: "ادمین",
  EMPLOYEE: "کارمند",
} as const;

/** A project reference as it appears in a user's access list. */
export type PresentedUserProject = {
  id: string;
  name: string;
  isActive: boolean;
};

export type PresentedUser = {
  id: string;
  name: string;
  channel: string;
  externalId: string;
  role: string;
  roleLabel: string;
  isActive: boolean;
  projects: PresentedUserProject[];
};

type UserRow = {
  id: string;
  name: string;
  channel: string;
  externalId: string;
  role: "ADMIN" | "EMPLOYEE";
  isActive: boolean;
  userProjects: { project: { id: string; name: string; isActive: boolean } }[];
};

export function presentUser(user: UserRow): PresentedUser {
  return {
    id: user.id,
    name: user.name,
    channel: user.channel,
    externalId: user.externalId,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] ?? user.role,
    isActive: user.isActive,
    projects: user.userProjects.map((link) => ({
      id: link.project.id,
      name: link.project.name,
      isActive: link.project.isActive,
    })),
  };
}

export function presentUsers(users: UserRow[]): PresentedUser[] {
  return users.map(presentUser);
}
