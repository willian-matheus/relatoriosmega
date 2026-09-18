import { randomUUID } from "node:crypto";
import {
  Activity,
  importSchema,
  Opportunity,
  opportunitySchema,
  Report,
  stageSchema,
  stages,
  WorkspaceData,
} from "@mega/contracts";
import { getOptionalSupabaseServerClient } from "./supabase-server";
import { seed } from "./seed";

// Memória temporária caso Supabase não esteja configurado
let memoryOpportunities: Opportunity[] = seed();
let memoryReports: Report[] = [];
let memoryActivities: Activity[] = [];
const previews = new Map<
  string,
  { data: ReturnType<typeof importSchema.parse>; expires: number }
>();

function toOpportunity(row: any): Opportunity {
  return {
    id: row.id,
    company: row.company,
    contact: row.contact,
    email: row.email || "",
    value: Number(row.value),
    stage: row.stage,
    owner: row.owner,
    priority: row.priority,
    source: row.source,
    dueDate:
      typeof row.due_date === "string"
        ? row.due_date.slice(0, 10)
        : row.due_date,
    notes: row.notes || "",
    reportId: row.report_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toReport(row: any): Report {
  return {
    id: row.id,
    name: row.name,
    count: row.count,
    filePath: row.file_path,
    fileSize: row.file_size ? Number(row.file_size) : null,
    mimeType: row.mime_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toActivity(row: any): Activity {
  return {
    id: row.id,
    company: row.company,
    description: row.description,
    createdAt: row.created_at,
  };
}

async function logActivity(
  company: string,
  description: string,
  opportunityId?: string,
  reportId?: string,
) {
  const supabase = getOptionalSupabaseServerClient();
  if (supabase) {
    try {
      await supabase.from("activities").insert({
        company,
        description,
        opportunity_id: opportunityId || null,
        report_id: reportId || null,
      });
    } catch (err) {
      console.warn("Falha ao registrar atividade:", err);
    }
  } else {
    memoryActivities.unshift({
      id: randomUUID(),
      company,
      description,
      createdAt: new Date().toISOString(),
    });
    memoryActivities = memoryActivities.slice(0, 40);
  }
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceData> {
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    return {
      opportunities: memoryOpportunities,
      reports: memoryReports,
      activities: memoryActivities,
    };
  }

  const [oppRes, repRes, actRes] = await Promise.all([
    supabase
      .from("opportunities")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("activities")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  let opportunities = (oppRes.data || []).map(toOpportunity);

  // Se o banco estiver vazio na primeira execução, popula os dados iniciais
  if (opportunities.length === 0 && (repRes.data || []).length === 0) {
    const initialRecords = seed().map((s) => ({
      company: s.company,
      contact: s.contact,
      email: s.email,
      value: s.value,
      stage: s.stage,
      owner: s.owner,
      priority: s.priority,
      source: s.source,
      due_date: s.dueDate,
      notes: s.notes,
    }));
    const inserted = await supabase
      .from("opportunities")
      .insert(initialRecords)
      .select();
    if (inserted.data) {
      opportunities = inserted.data.map(toOpportunity);
    }
  }

  return {
    opportunities,
    reports: (repRes.data || []).map(toReport),
    activities: (actRes.data || []).map(toActivity),
  };
}

export async function saveOpportunity(
  body: unknown,
  id?: string,
): Promise<Opportunity> {
  const parsed = opportunitySchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  }

  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    const existing = id
      ? memoryOpportunities.find((o) => o.id === id)
      : undefined;
    if (id && !existing) {
      throw new Error("Oportunidade não encontrada.");
    }
    const now = new Date().toISOString();
    const result: Opportunity = {
      ...parsed.data,
      id: existing?.id || randomUUID(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existing) {
      memoryOpportunities = memoryOpportunities.map((o) =>
        o.id === id ? result : o,
      );
    } else {
      memoryOpportunities.unshift(result);
    }
    await logActivity(
      result.company,
      existing ? "Oportunidade atualizada" : "Oportunidade criada",
    );
    return result;
  }

  if (id) {
    const { data, error } = await supabase
      .from("opportunities")
      .update({
        company: parsed.data.company,
        contact: parsed.data.contact,
        email: parsed.data.email,
        value: parsed.data.value,
        stage: parsed.data.stage,
        owner: parsed.data.owner,
        priority: parsed.data.priority,
        source: parsed.data.source,
        due_date: parsed.data.dueDate,
        notes: parsed.data.notes,
      })
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      throw new Error("Oportunidade não encontrada.");
    }
    await logActivity(data.company, "Oportunidade atualizada", data.id);
    return toOpportunity(data);
  } else {
    const { data, error } = await supabase
      .from("opportunities")
      .insert({
        company: parsed.data.company,
        contact: parsed.data.contact,
        email: parsed.data.email,
        value: parsed.data.value,
        stage: parsed.data.stage,
        owner: parsed.data.owner,
        priority: parsed.data.priority,
        source: parsed.data.source,
        due_date: parsed.data.dueDate,
        notes: parsed.data.notes,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Erro ao criar oportunidade.");
    }
    await logActivity(data.company, "Oportunidade criada", data.id);
    return toOpportunity(data);
  }
}

export async function moveOpportunity(
  id: string,
  body: unknown,
): Promise<Opportunity> {
  const parsed = stageSchema.safeParse((body as { stage?: unknown })?.stage);
  if (!parsed.success) {
    throw new Error("Etapa inválida.");
  }

  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    const opportunity = memoryOpportunities.find((o) => o.id === id);
    if (!opportunity) {
      throw new Error("Oportunidade não encontrada.");
    }
    opportunity.stage = parsed.data;
    opportunity.updatedAt = new Date().toISOString();
    await logActivity(
      opportunity.company,
      `Movida para ${stages.find((s) => s.id === parsed.data)!.label.toLowerCase()}`,
    );
    return opportunity;
  }

  const { data, error } = await supabase
    .from("opportunities")
    .update({ stage: parsed.data })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw new Error("Oportunidade não encontrada.");
  }
  const stageLabel = stages
    .find((s) => s.id === parsed.data)!
    .label.toLowerCase();
  await logActivity(data.company, `Movida para ${stageLabel}`, data.id);
  return toOpportunity(data);
}

export async function removeOpportunity(id: string) {
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    const opportunity = memoryOpportunities.find((o) => o.id === id);
    if (!opportunity) {
      throw new Error("Oportunidade não encontrada.");
    }
    memoryOpportunities = memoryOpportunities.filter((o) => o.id !== id);
    await logActivity(opportunity.company, "Oportunidade excluída");
    return { success: true };
  }

  const { data: existing } = await supabase
    .from("opportunities")
    .select("id, company")
    .eq("id", id)
    .single();

  if (!existing) {
    throw new Error("Oportunidade não encontrada.");
  }

  await supabase.from("opportunities").delete().eq("id", id);
  await logActivity(existing.company, "Oportunidade excluída");
  return { success: true };
}

export function previewImport(body: unknown) {
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  }
  for (const [id, p] of previews) {
    if (p.expires < Date.now()) previews.delete(id);
  }
  if (previews.size >= 100) {
    throw new Error(
      "Muitas prévias abertas. Tente novamente em alguns minutos.",
    );
  }
  const token = randomUUID();
  previews.set(token, {
    data: parsed.data,
    expires: Date.now() + 15 * 60 * 1000,
  });
  return { token, ...parsed.data };
}

export async function commitImport(token: string): Promise<Report> {
  const preview = previews.get(token);
  if (!preview || preview.expires < Date.now()) {
    throw new Error(
      "Prévia expirada ou já importada. Selecione o arquivo novamente.",
    );
  }
  previews.delete(token);

  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    const now = new Date().toISOString();
    const records = preview.data.rows.map((row) => ({
      ...row,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }));
    memoryOpportunities.unshift(...records);
    const report: Report = {
      id: randomUUID(),
      name: preview.data.name,
      count: records.length,
      createdAt: now,
    };
    memoryReports.unshift(report);
    await logActivity(
      report.name,
      `${records.length} oportunidades importadas`,
    );
    return report;
  }

  const reportId = randomUUID();
  let filePath: string | null = null;

  if (preview.data.rawContent) {
    const cleanName = preview.data.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    filePath = `${reportId}/${cleanName}`;
    const { error: uploadErr } = await supabase.storage
      .from("reports")
      .upload(filePath, preview.data.rawContent, {
        contentType: preview.data.mimeType || "text/csv",
        upsert: true,
      });
    if (uploadErr) {
      console.warn(
        "Falha ao salvar arquivo no Supabase Storage:",
        uploadErr.message,
      );
      filePath = null;
    }
  }

  const { data: repData, error: repErr } = await supabase
    .from("reports")
    .insert({
      id: reportId,
      name: preview.data.name,
      file_path: filePath,
      file_size: preview.data.fileSize || null,
      mime_type: preview.data.mimeType || "text/csv",
      count: preview.data.rows.length,
      status: "completed",
      metadata: { importedBy: "web" },
    })
    .select()
    .single();

  if (repErr || !repData) {
    throw new Error(repErr?.message || "Erro ao salvar relatório no banco.");
  }

  const rowsToInsert = preview.data.rows.map((row) => ({
    report_id: reportId,
    company: row.company,
    contact: row.contact,
    email: row.email,
    value: row.value,
    stage: row.stage,
    owner: row.owner,
    priority: row.priority,
    source: row.source || "Relatório CSV",
    due_date: row.dueDate,
    notes: row.notes,
  }));

  const { error: oppsErr } = await supabase
    .from("opportunities")
    .insert(rowsToInsert);
  if (oppsErr) {
    console.error(
      "Erro ao inserir oportunidades vinculadas:",
      oppsErr.message,
    );
  }

  await logActivity(
    repData.name,
    `${preview.data.rows.length} oportunidades importadas`,
    undefined,
    reportId,
  );

  return toReport(repData);
}

export async function getReportDownloadUrl(
  id: string,
): Promise<{ url: string; name: string }> {
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data: report, error } = await supabase
    .from("reports")
    .select("name, file_path")
    .eq("id", id)
    .single();
  if (error || !report || !report.file_path) {
    throw new Error("Arquivo do relatório não encontrado.");
  }
  const { data, error: signErr } = await supabase.storage
    .from("reports")
    .createSignedUrl(report.file_path, 3600);
  if (signErr || !data?.signedUrl) {
    throw new Error("Erro ao gerar link de download.");
  }
  return { url: data.signedUrl, name: report.name };
}
