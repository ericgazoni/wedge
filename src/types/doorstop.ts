export type DocSettings = {
  digits: number;
  itemformat: "yaml" | "markdown";
  prefix: string;
  parent: string | null;
  sep: string;
  child_links: boolean;
};

export type DocumentConfig = {
  settings: DocSettings;
  attributes?: {
    defaults?: Record<string, unknown>;
    reviewed?: unknown[];
    [k: string]: unknown;
  };
};

export type DoorstopItem = {
  uid: string;
  filePath: string;
  docPrefix: string;
  data: Record<string, unknown>;
};

export type DoorstopDocument = {
  name: string;
  dirPath: string;
  configPath: string;
  config: DocumentConfig;
  items: DoorstopItem[];
};

export type RepoModel = {
  rootPath: string;
  documents: DoorstopDocument[];
};

export type DoorstopIssueLevel = "error" | "warning";

export type DoorstopIssue = {
  level: DoorstopIssueLevel;
  uid: string;
  message: string;
};

export type DoorstopCheckResult = {
  available: boolean;
  issues: DoorstopIssue[];
};

export type DoorstopReviewResult = {
  available: boolean;
  success: boolean;
};

export const STANDARD_FIELDS = [
  "active",
  "derived",
  "header",
  "level",
  "links",
  "normative",
  "ref",
  "reviewed",
  "text",
] as const;

export type StandardField = (typeof STANDARD_FIELDS)[number];
