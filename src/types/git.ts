export type GitCredentials = {
  username: string;
  password: string;
  remember: boolean;
};

export type GitIdentity = {
  name: string;
  email: string;
};

export type GitStatus = {
  branch: string;
  localChangeCount: number;
  updatesAvailable: boolean;
};

export type GitCommandError = {
  code: string;
  message: string;
  actionLabel: string;
  details: string;
  requiresAuth: boolean;
};

export type GitCloneResult = {
  ok: boolean;
  openedPath: string | null;
  status: GitStatus | null;
  error: GitCommandError | null;
};

export type GitSyncResult = {
  outcome: "synced" | "conflict" | "failed" | "aborted";
  status: GitStatus;
  conflictingFiles: string[];
  error: GitCommandError | null;
};

export type GitStatusResult = {
  status: GitStatus | null;
  error: GitCommandError | null;
};

