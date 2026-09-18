import { z } from "zod";

export const stages = [
  { id: "new", label: "Novos leads", color: "#9d8dff", short: "Novos" },
  { id: "contact", label: "Em contato", color: "#62b4ff", short: "Contato" },
  {
    id: "proposal",
    label: "Proposta enviada",
    color: "#e5b967",
    short: "Proposta",
  },
  {
    id: "negotiation",
    label: "Em negociação",
    color: "#e18bcc",
    short: "Negociação",
  },
  { id: "won", label: "Fechados", color: "#5bceb0", short: "Fechados" },
] as const;
export const stageSchema = z.enum([
  "new",
  "contact",
  "proposal",
  "negotiation",
  "won",
]);
export type Stage = z.infer<typeof stageSchema>;
export const owners = ["Ana Martins", "Bruno Costa", "Camila Lima"] as const;
export const opportunitySchema = z.object({
  company: z.string().trim().min(2, "Informe a empresa.").max(100),
  contact: z.string().trim().min(2, "Informe o contato.").max(100),
  email: z.union([z.email(), z.literal("")]).default(""),
  value: z.number().finite().min(0).max(999999999),
  stage: stageSchema.default("new"),
  owner: z.enum(owners).default("Ana Martins"),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  source: z.string().trim().min(1).max(80).default("Cadastro manual"),
  dueDate: z.iso.date(),
  notes: z.string().max(2000).default(""),
});
export type OpportunityInput = z.infer<typeof opportunitySchema>;
export type Opportunity = OpportunityInput & {
  id: string;
  reportId?: string | null;
  createdAt: string;
  updatedAt: string;
};
export const importSchema = z.object({
  name: z.string().trim().min(1).max(180),
  rows: z.array(opportunitySchema).min(1).max(500),
  rawContent: z.string().optional(),
  fileSize: z.number().optional(),
  mimeType: z.string().optional(),
});
export type Report = {
  id: string;
  name: string;
  count: number;
  filePath?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  status?: string;
  createdAt: string;
  updatedAt?: string;
};
export type Activity = {
  id: string;
  company: string;
  description: string;
  createdAt: string;
};
export type WorkspaceData = {
  opportunities: Opportunity[];
  reports: Report[];
  activities: Activity[];
};

export * from "./database.types";
