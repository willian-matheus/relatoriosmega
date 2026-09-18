import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  applyReportAction,
  readReportWorkflow,
  reportUpdateSchema,
  ReportUpdateError,
  ReportAuthor,
  Json,
  Activity,
  importSchema,
  Opportunity,
  opportunitySchema,
  Report,
  stageSchema,
  stages,
  WorkspaceData,
} from "@mega/contracts";
import { getSupabaseClient } from "./supabase";

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
    workflow: readReportWorkflow(row.metadata),
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

@Injectable()
export class CrmService {
  private opportunities: Opportunity[] = [];
  private reports: Report[] = [];
  private activities: Activity[] = [];
  private previews = new Map<
    string,
    { data: ReturnType<typeof importSchema.parse>; expires: number }
  >();

  async snapshot(): Promise<WorkspaceData> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return {
        opportunities: this.opportunities,
        reports: this.reports,
        activities: this.activities,
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

    if (oppRes.error || repRes.error || actRes.error)
      throw new Error("Não foi possível carregar os dados do workspace.");
    const opportunities = (oppRes.data || []).map(toOpportunity);

    return {
      opportunities,
      reports: (repRes.data || []).map(toReport),
      activities: (actRes.data || []).map(toActivity),
    };
  }

  private async log(
    company: string,
    description: string,
    opportunityId?: string,
    reportId?: string,
  ) {
    const supabase = getSupabaseClient();
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
      this.activities.unshift({
        id: randomUUID(),
        company,
        description,
        createdAt: new Date().toISOString(),
      });
      this.activities = this.activities.slice(0, 40);
    }
  }

  async save(body: unknown, id?: string): Promise<Opportunity> {
    const parsed = opportunitySchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );

    const supabase = getSupabaseClient();
    if (!supabase) {
      const existing = id
        ? this.opportunities.find((o) => o.id === id)
        : undefined;
      if (id && !existing)
        throw new NotFoundException("Oportunidade não encontrada.");
      const now = new Date().toISOString();
      const result: Opportunity = {
        ...parsed.data,
        id: existing?.id || randomUUID(),
        reportId: existing?.reportId,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      if (existing)
        this.opportunities = this.opportunities.map((o) =>
          o.id === id ? result : o,
        );
      else this.opportunities.unshift(result);
      await this.log(
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
      if (error || !data)
        throw new NotFoundException("Oportunidade não encontrada.");
      await this.log(data.company, "Oportunidade atualizada", data.id);
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
      if (error || !data)
        throw new BadRequestException(
          error?.message || "Erro ao criar oportunidade.",
        );
      await this.log(data.company, "Oportunidade criada", data.id);
      return toOpportunity(data);
    }
  }

  async move(id: string, body: unknown): Promise<Opportunity> {
    const parsed = stageSchema.safeParse((body as { stage?: unknown })?.stage);
    if (!parsed.success) throw new BadRequestException("Etapa inválida.");

    const supabase = getSupabaseClient();
    if (!supabase) {
      const opportunity = this.opportunities.find((o) => o.id === id);
      if (!opportunity)
        throw new NotFoundException("Oportunidade não encontrada.");
      opportunity.stage = parsed.data;
      opportunity.updatedAt = new Date().toISOString();
      await this.log(
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
    if (error || !data)
      throw new NotFoundException("Oportunidade não encontrada.");
    const stageLabel = stages
      .find((s) => s.id === parsed.data)!
      .label.toLowerCase();
    await this.log(data.company, `Movida para ${stageLabel}`, data.id);
    return toOpportunity(data);
  }

  async remove(id: string) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      const opportunity = this.opportunities.find((o) => o.id === id);
      if (!opportunity)
        throw new NotFoundException("Oportunidade não encontrada.");
      this.opportunities = this.opportunities.filter((o) => o.id !== id);
      await this.log(opportunity.company, "Oportunidade excluída");
      return { success: true };
    }

    const { data: existing } = await supabase
      .from("opportunities")
      .select("id, company")
      .eq("id", id)
      .single();
    if (!existing) throw new NotFoundException("Oportunidade não encontrada.");

    await supabase.from("opportunities").delete().eq("id", id);
    await this.log(existing.company, "Oportunidade excluída");
    return { success: true };
  }

  preview(body: unknown) {
    const parsed = importSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    for (const [id, p] of this.previews)
      if (p.expires < Date.now()) this.previews.delete(id);
    if (this.previews.size >= 100)
      throw new BadRequestException(
        "Muitas prévias abertas. Tente novamente em alguns minutos.",
      );
    const token = randomUUID();
    this.previews.set(token, {
      data: parsed.data,
      expires: Date.now() + 15 * 60 * 1000,
    });
    return { token, ...parsed.data };
  }

  async commit(token: string): Promise<Report> {
    const preview = this.previews.get(token);
    if (!preview || preview.expires < Date.now())
      throw new ConflictException(
        "Prévia expirada ou já importada. Selecione o arquivo novamente.",
      );
    this.previews.delete(token);

    const supabase = getSupabaseClient();
    if (!supabase) {
      const now = new Date().toISOString();
      const memoryReportId = randomUUID();
      const records = preview.data.rows.map((row) => ({
        ...row,
        id: randomUUID(),
        reportId: memoryReportId,
        createdAt: now,
        updatedAt: now,
      }));
      this.opportunities.unshift(...records);
      const report: Report = {
        id: memoryReportId,
        name: preview.data.name,
        count: records.length,
        createdAt: now,
      };
      this.reports.unshift(report);
      await this.log(report.name, `${records.length} oportunidades importadas`);
      return report;
    }

    const reportId = randomUUID();
    let filePath: string | null = null;

    // Se o conteúdo bruto do arquivo foi enviado, salva no bucket reports
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

    // 1. Cria o registro na tabela reports
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
      throw new BadRequestException(
        repErr?.message || "Erro ao salvar relatório no banco.",
      );
    }

    // 2. Insere todas as oportunidades vinculadas ao report_id
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

    // 3. Registra a atividade
    await this.log(
      repData.name,
      `${preview.data.rows.length} oportunidades importadas`,
      undefined,
      reportId,
    );

    return toReport(repData);
  }

  async getReportDownloadUrl(
    id: string,
  ): Promise<{ url: string; name: string }> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new NotFoundException("Supabase não configurado.");
    const { data: report, error } = await supabase
      .from("reports")
      .select("name, file_path")
      .eq("id", id)
      .single();
    if (error || !report || !report.file_path) {
      throw new NotFoundException("Arquivo do relatório não encontrado.");
    }
    const { data, error: signErr } = await supabase.storage
      .from("reports")
      .createSignedUrl(report.file_path, 3600);
    if (signErr || !data?.signedUrl) {
      throw new BadRequestException("Erro ao gerar link de download.");
    }
    return { url: data.signedUrl, name: report.name };
  }
  async updateReport(
    id: string,
    body: unknown,
    author: ReportAuthor,
  ): Promise<Report> {
    const parsed = reportUpdateSchema.safeParse(body);
    if (!parsed.success)
      throw new ReportUpdateError(
        parsed.error.issues.map((i) => i.message).join("; "),
        400,
      );
    const { version, action } = parsed.data;
    const supabase = getSupabaseClient();
    if (!supabase) {
      const report = this.reports.find((r) => r.id === id);
      if (!report)
        throw new ReportUpdateError("Relatório não encontrado.", 404);
      if ((report.updatedAt ?? report.createdAt) !== version)
        throw new ReportUpdateError(
          "O relatório foi atualizado por outra pessoa. Atualize a lista e tente novamente.",
          409,
        );
      const now = new Date(
        Math.max(Date.now(), Date.parse(version) + 1),
      ).toISOString();
      try {
        report.workflow = applyReportAction(
          report.workflow ?? readReportWorkflow(null),
          action,
          author,
          this.opportunities.filter((o) => o.reportId === id),
          now,
          randomUUID,
        );
      } catch (error) {
        throw new ReportUpdateError(
          error instanceof Error ? error.message : "Ação inválida.",
          400,
        );
      }
      report.updatedAt = now;
      return report;
    }
    const { data: row, error } = await supabase
      .from("reports")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error)
      throw new ReportUpdateError(
        "Não foi possível carregar o relatório.",
        503,
      );
    if (!row) throw new ReportUpdateError("Relatório não encontrado.", 404);
    if (row.updated_at !== version)
      throw new ReportUpdateError(
        "O relatório foi atualizado por outra pessoa. Atualize a lista e tente novamente.",
        409,
      );
    const records = await supabase
      .from("opportunities")
      .select("*")
      .eq("report_id", id);
    if (records.error)
      throw new ReportUpdateError(
        "Não foi possível carregar os registros.",
        503,
      );
    let workflow;
    try {
      workflow = applyReportAction(
        readReportWorkflow(row.metadata),
        action,
        author,
        (records.data ?? []).map(toOpportunity),
        new Date().toISOString(),
        randomUUID,
      );
    } catch (error) {
      throw new ReportUpdateError(
        error instanceof Error ? error.message : "Ação inválida.",
        400,
      );
    }
    const metadata =
      row.metadata &&
      typeof row.metadata === "object" &&
      !Array.isArray(row.metadata)
        ? row.metadata
        : {};
    // Compare-and-swap prevents one collaborator from overwriting another's reply.
    const saved = await supabase
      .from("reports")
      .update({ metadata: { ...metadata, workflow } as Json })
      .eq("id", id)
      .eq("updated_at", version)
      .select("*")
      .maybeSingle();
    if (saved.error)
      throw new ReportUpdateError(
        "Não foi possível salvar o acompanhamento.",
        503,
      );
    if (!saved.data)
      throw new ReportUpdateError(
        "O relatório mudou enquanto você escrevia. Atualize a lista e tente novamente.",
        409,
      );
    return toReport(saved.data);
  }
}
