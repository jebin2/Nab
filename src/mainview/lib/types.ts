// App-level domain types shared across pages and components.
// Canvas/annotation-specific types live in annotationTypes.ts.

export type NavPage = "projects" | "annotate" | "train" | "inference" | "export";

export type ProjectStatus = "annotating" | "ready" | "training" | "trained";

export interface Project {
  id: string;
  name: string;
  baseModel?: string;   // set in Train tab
  classes?: string[];   // set in Annotate tab
  status: ProjectStatus;
  imageCount: number;
  mAP?: number;
  updatedAt: string;
  thumbnailColor: string;
}
