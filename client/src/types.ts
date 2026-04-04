export type User = {
  id: string;
  email: string;
  displayName: string | null;
};

export type GroupSummary = {
  id: string;
  name: string;
  ownerId: string;
  role: "owner" | "member";
  createdAt: string;
  updatedAt: string;
};

export type GroupDetail = GroupSummary & {
  members: Array<{
    id: string;
    email: string;
    displayName: string | null;
    role: "owner" | "member";
  }>;
};

export type Invitation = {
  id: string;
  status: "pending";
  createdAt: string;
  respondedAt: string | null;
  group: {
    id: string;
    name: string;
  };
  invitedBy: {
    id: string;
    email: string;
    displayName: string | null;
  };
};
