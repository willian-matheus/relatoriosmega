import { randomUUID } from "node:crypto";
import { getOptionalSupabaseServerClient } from "./supabase-server";
import {
  getGesttaTasks,
  getGesttaReports,
  getGesttaTaskDocuments,
  downloadGesttaDocumentFile,
  GesttaTask,
  GesttaReportItem,
} from "./gestta";
import {
  generateTaskPdfReport,
  generateCompetencePdfReport,
  generateGeneralSyncSummaryPdf,
} from "./gestta-pdf";
import {
  getAuthenticatedDriveClient,
  findOrCreateFolder,
  uploadFileToFolder,
} from "./google";

export interface SyncOptions {
  startDate?: string;
  endDate?: string;
  limit?: number;
  customerId?: string;
  rootFolderName?: string;
}

export interface SyncTaskResult {
  id: string;
  name: string;
  status: string;
  driveFolderId?: string;
  fileLink?: string;
  pdfFileLink?: string;
  jsonFileLink?: string;
  attachedDocsCount?: number;
}

export interface SyncCompetenceResult {
  competence: string;
  tasks: SyncTaskResult[];
  csvFileLink?: string;
  pdfFileLink?: string;
}

export interface SyncCompanyResult {
  companyName: string;
  companyCode?: string;
  companyCnpj?: string;
  competences: SyncCompetenceResult[];
}

export interface SyncSummary {
  success: boolean;
  timestamp: string;
  totalTasks: number;
  totalCompanies: number;
  reportId?: string;
  driveRootFolderId?: string;
  driveRootUrl?: string;
  driveGeneralPdfUrl?: string;
  gesttaReportsAvailable: GesttaReportItem[];
  companies: SyncCompanyResult[];
}

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function formatTaskReportText(
  task: GesttaTask,
  allReports: GesttaReportItem[],
): string {
  const nowStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return `========================================================================
RELATÓRIO DE TAREFA - MEGA CONTABILIDADE (INTEGRAÇÃO GESTTA & CRM)
========================================================================
EMPRESA:       ${task.companyName}
CÓDIGO GESTTA: ${task.companyCode || "N/A"}
CNPJ:          ${task.companyCnpj || "N/A"}
------------------------------------------------------------------------
TAREFA:        ${task.name}
ID NO GESTTA:  ${task.id}
COMPETÊNCIA:   ${task.competence}
DATA COMP.:    ${task.competenceDate || "N/A"}
STATUS:        ${task.status} (${task.status === "DONE" ? "Concluída" : task.overdue ? "Em Atraso" : "Em Aberto"})
VENCIMENTO:    ${task.dueDate ? task.dueDate.slice(0, 10) : "N/A"}
PRAZO LEGAL:   ${task.legalDate ? task.legalDate.slice(0, 10) : "N/A"}
DEPARTAMENTO:  ${task.department || "Geral"}
TIPO:          ${task.type || "RECURRENT"} / ${task.subtype || "AUTOMATIC"}
------------------------------------------------------------------------
SINCRONIZAÇÃO:
Processado em: ${nowStr}
Armazenado em: Google Drive (Estrutura: Empresa / Competência / Tarefa)
Registrado em: Mega CRM (Oportunidades, Relatórios e Atividades)
------------------------------------------------------------------------
RELATÓRIOS DO SISTEMA GESTTA DISPONÍVEIS NA CONTA (${allReports.length}):
${allReports.slice(0, 10).map((r) => ` - [${r.type}] ${r.name}`).join("\n")}
========================================================================
`;
}

export async function syncGesttaToCrmAndDrive(
  options?: SyncOptions,
): Promise<SyncSummary> {
  const timestamp = new Date().toISOString();
  const dateStr = new Date().toLocaleDateString("pt-BR");

  console.log("[1/5] Conectando ao Gestta e buscando relatórios e tarefas...");
  // 1. Busca relatórios e tarefas no Gestta
  const [reportsList, tasksData] = await Promise.all([
    getGesttaReports().catch((err) => {
      console.warn("Aviso ao buscar relatórios Gestta:", err);
      return [] as GesttaReportItem[];
    }),
    getGesttaTasks({
      startDate: options?.startDate || "2026-08-01T00:00:00.000Z",
      endDate: options?.endDate || "2026-10-31T23:59:59.999Z",
      limit: options?.limit || 30,
      customerId: options?.customerId,
    }),
  ]);

  const tasks = tasksData.tasks;
  console.log(`[2/5] Gestta: ${tasks.length} tarefas encontradas e ${reportsList.length} relatórios de sistema identificados.`);
  if (!tasks.length) {
    throw new Error("Nenhuma tarefa encontrada no Gestta para o período especificado.");
  }

  // 2. Agrupa tarefas por Empresa -> Competência -> Tarefas
  const companiesMap = new Map<string, Map<string, GesttaTask[]>>();
  const companyInfoMap = new Map<
    string,
    { code?: string; cnpj?: string; rawName: string }
  >();
  const historyRecordsToUpsert: any[] = [];

  for (const t of tasks) {
    const compName = t.companyName || "Empresa Desconhecida";
    if (!companiesMap.has(compName)) {
      companiesMap.set(compName, new Map());
      companyInfoMap.set(compName, {
        code: t.companyCode,
        cnpj: t.companyCnpj,
        rawName: compName,
      });
    }

    const compMap = companiesMap.get(compName)!;
    const competence = t.competence || "Sem Competencia";
    if (!compMap.has(competence)) {
      compMap.set(competence, []);
    }
    compMap.get(competence)!.push(t);
  }

  // 3. Conexão com o Google Drive
  console.log("[3/5] Conectando ao Google Drive e obtendo pasta raiz...");
  const driveClient = await getAuthenticatedDriveClient("default_user");
  let driveRootFolderId: string | undefined;
  let driveRootUrl: string | undefined;

  if (driveClient?.drive) {
    try {
      const rootName = options?.rootFolderName || "Mega Contabilidade - Gestta";
      driveRootFolderId = await findOrCreateFolder(driveClient.drive, rootName);
      driveRootUrl = `https://drive.google.com/drive/folders/${driveRootFolderId}`;
      console.log(`      Pasta Raiz: "${rootName}" (ID: ${driveRootFolderId})`);

      // Garante acesso público para leitura/download e editor para crmmegadev@gmail.com
      try {
        await driveClient.drive.permissions.create({
          fileId: driveRootFolderId,
          requestBody: { role: "reader", type: "anyone" },
        });
        await driveClient.drive.permissions.create({
          fileId: driveRootFolderId,
          sendNotificationEmail: false,
          requestBody: {
            role: "writer",
            type: "user",
            emailAddress: "crmmegadev@gmail.com",
          },
        });
      } catch {
        // silencioso caso já exista permissão
      }
    } catch (driveAuthErr: any) {
      console.warn(
        "⚠️ Aviso: Falha ao acessar Google Drive (token precisa ser reconectado):",
        driveAuthErr?.message || driveAuthErr,
      );
      driveRootFolderId = undefined;
      driveRootUrl = undefined;
    }
  }

  // 4. Criação do Relatório no CRM (Supabase)
  console.log(`[4/5] Registrando relatório e ${tasks.length} oportunidades no Mega CRM...`);
  const supabase = getOptionalSupabaseServerClient();
  const reportId = randomUUID();

  if (supabase) {
    await supabase.from("reports").insert({
      id: reportId,
      name: `Sincronização Gestta - Tarefas & Competências em PDF (${dateStr})`,
      status: "completed",
      count: tasks.length,
      mime_type: "application/pdf",
      metadata: {
        source: "gestta",
        format: "PDF",
        pdfReportsGenerated: true,
        ofxSupported: false,
        ofxNote:
          "Formato OFX e exclusivo para extratos bancarios; tarefas do Gestta consolidadas em PDF.",
        totalTasks: tasks.length,
        totalCompanies: companiesMap.size,
        googleDriveFolderId: driveRootFolderId,
        googleDriveUrl: driveRootUrl,
        period: {
          start: options?.startDate || "2026-08-01",
          end: options?.endDate || "2026-10-31",
        },
      },
    });

    // Registra as tarefas no CRM como oportunidades vinculadas
    const oppsToInsert = tasks.map((t) => ({
      report_id: reportId,
      company: t.companyName,
      contact: t.companyCode ? `Cód. ${t.companyCode}` : t.companyCnpj || "Gestta",
      email: "",
      value: 0,
      stage:
        t.status === "DONE"
          ? "won"
          : t.overdue
            ? "contact"
            : "proposal",
      owner: "Gestta Automático",
      priority: t.overdue ? "high" : "medium",
      source: "Gestta",
      due_date: t.dueDate ? t.dueDate.slice(0, 10) : undefined,
      notes: `Tarefa: ${t.name} | Competência: ${t.competence} | Status: ${t.status} | Prazo Legal: ${t.legalDate ? t.legalDate.slice(0, 10) : "N/A"}`,
    }));

    const { error: oppErr } = await supabase.from("opportunities").insert(oppsToInsert);
    if (oppErr) {
      console.warn("Aviso ao inserir oportunidades no CRM:", oppErr.message);
    }

    // Registra atividade no CRM
    await supabase.from("activities").insert({
      report_id: reportId,
      company: "Gestta & Google Drive",
      description: `Sincronizadas ${tasks.length} tarefas de ${companiesMap.size} empresas. Organizadas no Google Drive por Empresa/Competência/Tarefa.`,
    });
    console.log("      Registros persistidos com sucesso no Supabase CRM.");
  }

  // 5. Envio e Organização no Google Drive
  console.log(`[5/5] Organizando ${companiesMap.size} empresas no Google Drive...`);
  const resultCompanies: SyncCompanyResult[] = [];

  for (const [companyName, competencesMap] of companiesMap.entries()) {
    console.log(`  -> Processando Empresa: ${companyName} (${competencesMap.size} competências)`);
    const compInfo = companyInfoMap.get(companyName);
    const resultCompetences: SyncCompetenceResult[] = [];

    let companyFolderId: string | undefined;
    if (driveClient?.drive && driveRootFolderId) {
      const safeCompFolder = sanitizeFolderName(companyName);
      companyFolderId = await findOrCreateFolder(
        driveClient.drive,
        safeCompFolder,
        driveRootFolderId,
      );
    }

    for (const [competence, taskList] of competencesMap.entries()) {
      let competenceFolderId: string | undefined;
      let csvFileLink: string | undefined;
      let pdfCompLink: string | undefined;

      if (driveClient?.drive && companyFolderId) {
        competenceFolderId = await findOrCreateFolder(
          driveClient.drive,
          `Competência ${competence}`,
          companyFolderId,
        );

        // 1. Gera e faz upload do Relatório Consolidado da Competência em PDF
        try {
          const compPdfBuffer = await generateCompetencePdfReport(
            companyName,
            competence,
            taskList,
          );
          const compPdfUploaded = await uploadFileToFolder(driveClient.drive, {
            fileName: `Relatorio_Competencia_${competence}.pdf`,
            mimeType: "application/pdf",
            content: compPdfBuffer,
            parentId: competenceFolderId,
          });
          pdfCompLink = compPdfUploaded.webViewLink;
        } catch (pdfErr) {
          console.warn(`Aviso ao gerar PDF da competência ${competence}:`, pdfErr);
        }

        // 2. Gera CSV consolidado da competência
        const csvLines = [
          "Empresa,Código,Competência,Tarefa,Status,Vencimento,Prazo Legal,Em Atraso,ID Gestta",
          ...taskList.map(
            (t) =>
              `"${t.companyName}","${t.companyCode || ""}","${t.competence}","${t.name.replace(/"/g, '""')}","${t.status}","${t.dueDate?.slice(0, 10) || ""}","${t.legalDate?.slice(0, 10) || ""}","${t.overdue ? "SIM" : "NÃO"}","${t.id}"`,
          ),
        ];

        const csvUploaded = await uploadFileToFolder(driveClient.drive, {
          fileName: `Resumo_Competencia_${competence}.csv`,
          mimeType: "text/csv",
          content: csvLines.join("\n"),
          parentId: competenceFolderId,
        });
        csvFileLink = csvUploaded.webViewLink;
      }

      const taskResults: SyncTaskResult[] = [];

      for (const t of taskList) {
        let taskFolderId: string | undefined;
        let fileLink: string | undefined;
        let pdfFileLink: string | undefined;
        let attachedDocsCount = 0;

        if (driveClient?.drive && competenceFolderId) {
          const safeTaskFolder = sanitizeFolderName(t.name);
          taskFolderId = await findOrCreateFolder(
            driveClient.drive,
            safeTaskFolder,
            competenceFolderId,
          );

          // 1. Upload do Relatório Formatado da Tarefa em PDF
          let pdfUploadedFile: { id: string; name: string; webViewLink?: string } | undefined;
          try {
            const taskPdfBuffer = await generateTaskPdfReport(t, reportsList);
            pdfUploadedFile = await uploadFileToFolder(driveClient.drive, {
              fileName: "Relatorio_Tarefa_Gestta.pdf",
              mimeType: "application/pdf",
              content: taskPdfBuffer,
              parentId: taskFolderId,
            });
            pdfFileLink = pdfUploadedFile.webViewLink;
          } catch (pdfErr) {
            console.warn(`Aviso ao gerar PDF para tarefa ${t.id}:`, pdfErr);
          }

          // 2. Upload do Relatório Formatado da Tarefa (.txt)
          const reportContent = formatTaskReportText(t, reportsList);
          const txtFile = await uploadFileToFolder(driveClient.drive, {
            fileName: "Relatorio_Tarefa_Gestta.txt",
            mimeType: "text/plain",
            content: reportContent,
            parentId: taskFolderId,
          });

          // 3. Upload dos Dados Completos da Tarefa em JSON
          const jsonFile = await uploadFileToFolder(driveClient.drive, {
            fileName: "detalhes_tarefa.json",
            mimeType: "application/json",
            content: JSON.stringify(t.raw || t, null, 2),
            parentId: taskFolderId,
          });

          // 4. Verifica e baixa documentos anexos no Gestta (PDFs/arquivos contábeis)
          try {
            const attachedDocs = await getGesttaTaskDocuments(t.id);
            if (Array.isArray(attachedDocs) && attachedDocs.length > 0) {
              for (const docItem of attachedDocs) {
                const docId = docItem._id || docItem.id;
                if (docId) {
                  const downloadedDoc = await downloadGesttaDocumentFile(docId);
                  if (downloadedDoc) {
                    await uploadFileToFolder(driveClient.drive, {
                      fileName: downloadedDoc.filename || `anexo_${docId}.pdf`,
                      mimeType: downloadedDoc.contentType || "application/pdf",
                      content: downloadedDoc.buffer,
                      parentId: taskFolderId,
                    });
                    attachedDocsCount++;
                  }
                }
              }
            }
          } catch (attErr) {
            // Silencioso se não houver anexos
          }

          // Prioriza o link do PDF como link principal do arquivo
          fileLink = pdfUploadedFile?.webViewLink || txtFile.webViewLink;

          // Armazena para gravação no histórico do banco
          historyRecordsToUpsert.push({
            gestta_task_id: t.id,
            company_name: t.companyName,
            company_code: t.companyCode || null,
            company_cnpj: t.companyCnpj || null,
            competence: t.competence,
            task_name: t.name,
            status: t.status,
            due_date: t.dueDate ? t.dueDate.slice(0, 10) : null,
            legal_date: t.legalDate ? t.legalDate.slice(0, 10) : null,
            department: t.department || null,
            overdue: Boolean(t.overdue),
            drive_folder_id: taskFolderId || null,
            drive_file_id: pdfUploadedFile?.id || txtFile.id || null,
            drive_file_link: fileLink || null,
            drive_pdf_id: pdfUploadedFile?.id || null,
            drive_pdf_link: pdfFileLink || null,
            drive_json_link: jsonFile.webViewLink || null,
            report_id: reportId,
            raw_data: t.raw || t,
            synced_at: timestamp,
            updated_at: timestamp,
          });
        }

        taskResults.push({
          id: t.id,
          name: t.name,
          status: t.status,
          driveFolderId: taskFolderId,
          fileLink,
          pdfFileLink,
          attachedDocsCount,
        });
      }

      resultCompetences.push({
        competence,
        tasks: taskResults,
        csvFileLink,
        pdfFileLink: pdfCompLink,
      });
    }

    resultCompanies.push({
      companyName,
      companyCode: compInfo?.code,
      companyCnpj: compInfo?.cnpj,
      competences: resultCompetences,
    });
  }

  // Persiste os registros individuais no histórico do CRM
  if (supabase && historyRecordsToUpsert.length > 0) {
    try {
      const { error: histErr } = await (supabase as any)
        .from("gestta_history_records")
        .upsert(historyRecordsToUpsert, { onConflict: "gestta_task_id" });
      if (histErr) {
        console.warn("Aviso ao salvar gestta_history_records:", histErr.message);
      } else {
        console.log(`      ${historyRecordsToUpsert.length} registros salvos no histórico (gestta_history_records).`);
      }
    } catch (err) {
      console.warn("Falha ao salvar no histórico:", err);
    }
  }

  // 6. Geração e envio do Relatório Executivo Geral em PDF
  let generalPdfDriveLink: string | undefined;
  try {
    const generalPdfBuffer = await generateGeneralSyncSummaryPdf({
      timestamp,
      totalTasks: tasks.length,
      totalCompanies: resultCompanies.length,
      companies: resultCompanies,
    });

    if (driveClient?.drive && driveRootFolderId) {
      const genPdfUploaded = await uploadFileToFolder(driveClient.drive, {
        fileName: "Relatorio_Geral_Sincronizacao.pdf",
        mimeType: "application/pdf",
        content: generalPdfBuffer,
        parentId: driveRootFolderId,
      });
      generalPdfDriveLink = genPdfUploaded.webViewLink;
    }

    if (supabase && reportId) {
      // Salva arquivo no Supabase Storage se disponível
      try {
        const storagePath = `gestta/${reportId}/Relatorio_Geral_Sincronizacao.pdf`;
        const { error: storageErr } = await (supabase as any).storage
          .from("reports")
          .upload(storagePath, generalPdfBuffer, {
            contentType: "application/pdf",
            upsert: true,
          });

        if (!storageErr) {
          await (supabase as any)
            .from("reports")
            .update({
              file_path: storagePath,
              file_size: generalPdfBuffer.length,
            })
            .eq("id", reportId);
        }
      } catch (stErr) {
        console.warn("Aviso ao salvar PDF no Supabase Storage:", stErr);
      }

      // Atualiza metadata com o link do PDF Geral
      await (supabase as any)
        .from("reports")
        .update({
          metadata: {
            source: "gestta",
            format: "PDF",
            pdfReportsGenerated: true,
            ofxSupported: false,
            ofxNote:
              "Formato OFX e exclusivo para extratos bancarios; relatorios consolidados em PDF.",
            totalTasks: tasks.length,
            totalCompanies: resultCompanies.length,
            googleDriveFolderId: driveRootFolderId,
            googleDriveUrl: driveRootUrl,
            googleDriveGeneralPdfUrl: generalPdfDriveLink,
          },
        })
        .eq("id", reportId);
    }
  } catch (genPdfErr) {
    console.warn("Aviso ao gerar Relatorio Geral em PDF:", genPdfErr);
  }

  return {
    success: true,
    timestamp,
    totalTasks: tasks.length,
    totalCompanies: resultCompanies.length,
    reportId,
    driveRootFolderId,
    driveRootUrl,
    driveGeneralPdfUrl: generalPdfDriveLink,
    gesttaReportsAvailable: reportsList,
    companies: resultCompanies,
  };
}

export interface HistoryTaskItem {
  id: string;
  taskId: string;
  name: string;
  status: string;
  dueDate?: string;
  legalDate?: string;
  department?: string;
  overdue: boolean;
  fileLink?: string;
  pdfLink?: string;
  jsonLink?: string;
  syncedAt?: string;
}

export interface HistoryCompetenceItem {
  competence: string;
  tasks: HistoryTaskItem[];
}

export interface HistoryCompanyItem {
  companyName: string;
  companyCode?: string;
  companyCnpj?: string;
  totalTasks: number;
  driveFolderId?: string;
  competences: HistoryCompetenceItem[];
}

/**
 * Consulta o histórico completo de relatórios e tarefas agrupados por Empresa -> Competência
 */
export async function getGesttaHistoryGrouped(filter?: {
  search?: string;
  competence?: string;
  status?: string;
}): Promise<{
  companies: HistoryCompanyItem[];
  totalTasks: number;
  totalCompanies: number;
  competencesList: string[];
}> {
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    return {
      companies: [],
      totalTasks: 0,
      totalCompanies: 0,
      competencesList: [],
    };
  }

  let query = (supabase as any)
    .from("gestta_history_records")
    .select("*")
    .order("company_name", { ascending: true })
    .order("competence", { ascending: false })
    .order("task_name", { ascending: true });

  if (filter?.competence && filter.competence !== "all") {
    query = query.eq("competence", filter.competence);
  }

  if (filter?.status && filter.status !== "all") {
    if (filter.status === "overdue") {
      query = query.eq("overdue", true);
    } else {
      query = query.eq("status", filter.status);
    }
  }

  if (filter?.search) {
    const s = filter.search.trim();
    query = query.or(`company_name.ilike.%${s}%,task_name.ilike.%${s}%,company_code.ilike.%${s}%`);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error("Erro ao carregar histórico do Gestta:", error);
    throw new Error("Não foi possível carregar o histórico de relatórios.");
  }

  const list = rows || [];
  const compMap = new Map<string, HistoryCompanyItem>();
  const allCompetences = new Set<string>();

  for (const r of list) {
    if (r.competence) allCompetences.add(r.competence);

    if (!compMap.has(r.company_name)) {
      compMap.set(r.company_name, {
        companyName: r.company_name,
        companyCode: r.company_code,
        companyCnpj: r.company_cnpj,
        totalTasks: 0,
        driveFolderId: r.drive_folder_id,
        competences: [],
      });
    }

    const compItem = compMap.get(r.company_name)!;
    compItem.totalTasks += 1;

    let compGroup = compItem.competences.find(
      (c) => c.competence === r.competence,
    );
    if (!compGroup) {
      compGroup = { competence: r.competence, tasks: [] };
      compItem.competences.push(compGroup);
    }

    const primaryFile = r.drive_pdf_link || r.drive_file_link;

    compGroup.tasks.push({
      id: r.id,
      taskId: r.gestta_task_id,
      name: r.task_name,
      status: r.status,
      dueDate: r.due_date,
      legalDate: r.legal_date,
      department: r.department,
      overdue: Boolean(r.overdue),
      fileLink: primaryFile,
      pdfLink: r.drive_pdf_link || primaryFile,
      jsonLink: r.drive_json_link,
      syncedAt: r.synced_at,
    });
  }

  const sortedCompetences = Array.from(allCompetences).sort().reverse();

  return {
    companies: Array.from(compMap.values()),
    totalTasks: list.length,
    totalCompanies: compMap.size,
    competencesList: sortedCompetences,
  };
}

export { syncGesttaToCrmAndDrive as syncGesttaToDriveAndCrm };

