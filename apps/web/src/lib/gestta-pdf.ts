import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { GesttaTask, GesttaReportItem } from "./gestta";

/**
 * Sanitiza texto para evitar erros de codificação WinAnsi nas fontes padrão do pdf-lib
 */
function cleanText(text: string | null | undefined, maxLen = 120): string {
  if (!text) return "";
  const cleaned = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentuação para compatibilidade 100% segura com Helvetica
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLen);
}

/**
 * Gera o relatório individual da tarefa em formato PDF profissional
 */
export async function generateTaskPdfReport(
  task: GesttaTask,
  allReports: GesttaReportItem[] = [],
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // Formato A4 padrão
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const margin = 40;
  let y = height;

  // 1. CABEÇALHO INSTITUCIONAL
  page.drawRectangle({
    x: 0,
    y: y - 85,
    width,
    height: 85,
    color: rgb(0.08, 0.09, 0.15), // Fundo escuro premium
  });

  // Barra de destaque roxa/índigo superior
  page.drawRectangle({
    x: 0,
    y: y - 5,
    width,
    height: 5,
    color: rgb(0.55, 0.4, 0.95), // Roxo Mega
  });

  page.drawText("MEGA CONTABILIDADE", {
    x: margin,
    y: y - 35,
    size: 16,
    font: fontBold,
    color: rgb(0.67, 0.54, 0.98),
  });

  page.drawText("RELATORIO INDIVIDUAL DE TAREFA CONTABIL - GESTTA & CRM", {
    x: margin,
    y: y - 52,
    size: 10,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText("Integracao Automatizada com Google Drive e Mega CRM", {
    x: margin,
    y: y - 68,
    size: 8,
    font,
    color: rgb(0.7, 0.7, 0.75),
  });

  // Data de emissão no cabeçalho à direita
  const emissionDate = cleanText(
    new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  );
  page.drawText(`Emitido em: ${emissionDate}`, {
    x: width - margin - 170,
    y: y - 68,
    size: 8,
    font,
    color: rgb(0.65, 0.65, 0.7),
  });

  y -= 110;

  // 2. STATUS BADGE
  const isDone =
    task.status.toUpperCase().includes("DONE") ||
    task.status.toUpperCase().includes("CONCLU");
  const isOverdue = Boolean(task.overdue);

  let statusBg = rgb(0.12, 0.35, 0.65); // Azul padrão
  let statusText = "EM ANDAMENTO";

  if (isDone) {
    statusBg = rgb(0.08, 0.45, 0.28); // Verde
    statusText = "CONCLUIDA";
  } else if (isOverdue) {
    statusBg = rgb(0.65, 0.15, 0.15); // Vermelho
    statusText = "EM ATRASO";
  }

  page.drawRectangle({
    x: margin,
    y: y - 26,
    width: width - margin * 2,
    height: 32,
    color: rgb(0.96, 0.96, 0.98),
    borderColor: rgb(0.85, 0.85, 0.9),
    borderWidth: 1,
  });

  page.drawText("STATUS DA TAREFA NO GESTTA:", {
    x: margin + 12,
    y: y - 14,
    size: 9,
    font: fontBold,
    color: rgb(0.3, 0.3, 0.35),
  });

  // Badge colorido
  page.drawRectangle({
    x: margin + 190,
    y: y - 22,
    width: 110,
    height: 22,
    color: statusBg,
  });

  page.drawText(statusText, {
    x: margin + 200,
    y: y - 14,
    size: 9,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  y -= 45;

  // 3. SEÇÃO: DADOS DA EMPRESA
  drawSectionHeader(page, fontBold, margin, y, "1. IDENTIFICACAO DA EMPRESA (CLIENTE)");
  y -= 25;

  const companyRows = [
    ["Razao Social:", cleanText(task.companyName)],
    ["CNPJ:", cleanText(task.companyCnpj || "Nao informado")],
    ["Codigo no Gestta:", cleanText(task.companyCode || "N/A")],
    ["ID Cliente Gestta:", cleanText(task.companyId || "N/A")],
  ];

  y = drawInfoTable(page, font, fontBold, margin, y, companyRows);
  y -= 15;

  // 4. SEÇÃO: DADOS DA TAREFA CONTÁBIL
  drawSectionHeader(page, fontBold, margin, y, "2. DETALHES DA TAREFA CONTABIL");
  y -= 25;

  const taskRows = [
    ["Nome da Tarefa:", cleanText(task.name)],
    ["ID da Tarefa:", cleanText(task.id)],
    ["Competencia:", cleanText(task.competence)],
    ["Data Competencia:", cleanText(task.competenceDate || "N/A")],
    ["Data de Vencimento:", cleanText(task.dueDate ? task.dueDate.slice(0, 10) : "N/A")],
    ["Prazo Legal:", cleanText(task.legalDate ? task.legalDate.slice(0, 10) : "N/A")],
    ["Departamento:", cleanText(task.department || "Geral")],
    ["Tipo / Subtipo:", `${cleanText(task.type || "RECURRENT")} / ${cleanText(task.subtype || "AUTOMATIC")}`],
    ["Status Gestta:", cleanText(task.status)],
    ["Em Atraso:", isOverdue ? "SIM (Atrasada)" : "NAO"],
  ];

  y = drawInfoTable(page, font, fontBold, margin, y, taskRows);
  y -= 15;

  // 5. SEÇÃO: RASTREABILIDADE DA SINCRONIZAÇÃO
  drawSectionHeader(page, fontBold, margin, y, "3. RASTREABILIDADE & SINCRONIZACAO");
  y -= 25;

  const syncRows = [
    ["Data/Hora do Processamento:", emissionDate],
    ["Destino na Nuvem:", "Google Drive (Empresa / Competencia / Tarefa)"],
    ["Registro no CRM:", "Mega CRM - Modulo Oportunidades & Historico"],
    ["Formato do Arquivo:", "PDF Vetorial Padronizado (application/pdf)"],
    ["Formato OFX:", "Nao aplicavel ao Gestta (exclusivo para extratos bancarios)"],
  ];

  y = drawInfoTable(page, font, fontBold, margin, y, syncRows);
  y -= 15;

  // 6. SEÇÃO: RELATÓRIOS DO SISTEMA DISPONÍVEIS
  if (allReports.length > 0 && y > 120) {
    drawSectionHeader(page, fontBold, margin, y, "4. RELATORIOS DO SISTEMA DISPONIVEIS NO GESTTA");
    y -= 20;

    const sampleReports = allReports.slice(0, 4);
    for (const rep of sampleReports) {
      page.drawText(`- [${cleanText(rep.type)}] ${cleanText(rep.name)}`, {
        x: margin + 10,
        y: y - 5,
        size: 8,
        font,
        color: rgb(0.3, 0.3, 0.35),
      });
      y -= 14;
    }
  }

  // 7. RODAPÉ INSTITUCIONAL
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height: 35,
    color: rgb(0.95, 0.95, 0.97),
    borderColor: rgb(0.88, 0.88, 0.92),
    borderWidth: 1,
  });

  page.drawText("Mega CRM | Sistema de Integracao Gestta & Google Drive | Documento Gerado Automaticamente", {
    x: margin,
    y: 13,
    size: 7.5,
    font,
    color: rgb(0.4, 0.4, 0.45),
  });

  page.drawText("Pagina 1 de 1", {
    x: width - margin - 55,
    y: 13,
    size: 7.5,
    font: fontBold,
    color: rgb(0.4, 0.4, 0.45),
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Gera o relatório consolidado da competência em PDF (com tabela de tarefas)
 */
export async function generateCompetencePdfReport(
  companyName: string,
  competence: string,
  tasks: GesttaTask[],
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const margin = 40;
  let y = height;

  // Cabeçalho
  page.drawRectangle({
    x: 0,
    y: y - 85,
    width,
    height: 85,
    color: rgb(0.08, 0.09, 0.15),
  });

  page.drawRectangle({
    x: 0,
    y: y - 5,
    width,
    height: 5,
    color: rgb(0.55, 0.4, 0.95),
  });

  page.drawText("MEGA CONTABILIDADE - DOSSIE DA COMPETENCIA", {
    x: margin,
    y: y - 35,
    size: 15,
    font: fontBold,
    color: rgb(0.67, 0.54, 0.98),
  });

  page.drawText(`Empresa: ${cleanText(companyName)} | Competencia: ${cleanText(competence)}`, {
    x: margin,
    y: y - 53,
    size: 10,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  const nowStr = cleanText(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }));
  page.drawText(`Total de Tarefas: ${tasks.length} | Gerado em: ${nowStr}`, {
    x: margin,
    y: y - 70,
    size: 8,
    font,
    color: rgb(0.75, 0.75, 0.8),
  });

  y -= 110;

  // Resumo de Estatísticas
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(
    (t) => t.status.toUpperCase().includes("DONE") || t.status.toUpperCase().includes("CONCLU"),
  ).length;
  const overdueTasks = tasks.filter((t) => t.overdue).length;
  const pendingTasks = totalTasks - completedTasks;

  page.drawRectangle({
    x: margin,
    y: y - 35,
    width: width - margin * 2,
    height: 35,
    color: rgb(0.96, 0.96, 0.98),
    borderColor: rgb(0.85, 0.85, 0.9),
    borderWidth: 1,
  });

  const statText = `Total: ${totalTasks}  |  Concluidas: ${completedTasks}  |  Em Atraso: ${overdueTasks}  |  Em Andamento: ${pendingTasks}`;
  page.drawText(statText, {
    x: margin + 15,
    y: y - 22,
    size: 9,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.25),
  });

  y -= 55;

  // Cabeçalho da Tabela
  drawSectionHeader(page, fontBold, margin, y, "RELACAO COMPLETA DE TAREFAS DA COMPETENCIA");
  y -= 25;

  const colX = {
    tarefa: margin,
    status: margin + 240,
    vencimento: margin + 340,
    prazoLegal: margin + 415,
    atraso: margin + 480,
  };

  page.drawRectangle({
    x: margin,
    y: y - 18,
    width: width - margin * 2,
    height: 20,
    color: rgb(0.15, 0.17, 0.25),
  });

  page.drawText("Tarefa", { x: colX.tarefa + 6, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Status", { x: colX.status + 6, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Vencimento", { x: colX.vencimento + 6, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Prazo Legal", { x: colX.prazoLegal + 6, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Atrasada", { x: colX.atraso + 6, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });

  y -= 20;

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];

    // Quebra de página se necessário
    if (y < 60) {
      page = doc.addPage([595.28, 841.89]);
      y = height - 50;
    }

    const rowBg = i % 2 === 0 ? rgb(0.98, 0.98, 0.99) : rgb(0.93, 0.94, 0.96);
    page.drawRectangle({
      x: margin,
      y: y - 18,
      width: width - margin * 2,
      height: 20,
      color: rowBg,
    });

    const isOverdueItem = Boolean(t.overdue);
    const taskNameText = cleanText(t.name, 45);
    const statusLabel = cleanText(t.status, 18);
    const dueLabel = cleanText(t.dueDate ? t.dueDate.slice(0, 10) : "-");
    const legalLabel = cleanText(t.legalDate ? t.legalDate.slice(0, 10) : "-");
    const overdueLabel = isOverdueItem ? "SIM" : "NAO";

    page.drawText(taskNameText, { x: colX.tarefa + 6, y: y - 13, size: 7.5, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(statusLabel, { x: colX.status + 6, y: y - 13, size: 7.5, font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(dueLabel, { x: colX.vencimento + 6, y: y - 13, size: 7.5, font, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(legalLabel, { x: colX.prazoLegal + 6, y: y - 13, size: 7.5, font, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(overdueLabel, {
      x: colX.atraso + 6,
      y: y - 13,
      size: 7.5,
      font: fontBold,
      color: isOverdueItem ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.5, 0.2),
    });

    y -= 22;
  }

  // Rodapé
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height: 30,
    color: rgb(0.95, 0.95, 0.97),
  });

  page.drawText("Mega CRM - Relatorio Consolidado da Competencia | Integracao Gestta & Google Drive", {
    x: margin,
    y: 11,
    size: 7.5,
    font,
    color: rgb(0.4, 0.4, 0.45),
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Gera o relatório geral executivo de sincronização da Mega Contabilidade
 */
export async function generateGeneralSyncSummaryPdf(summary: {
  timestamp: string;
  totalTasks: number;
  totalCompanies: number;
  companies: { companyName: string; competences: { competence: string; tasks: any[] }[] }[];
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const margin = 40;
  let y = height;

  // Header
  page.drawRectangle({
    x: 0,
    y: y - 85,
    width,
    height: 85,
    color: rgb(0.08, 0.09, 0.15),
  });

  page.drawRectangle({
    x: 0,
    y: y - 5,
    width,
    height: 5,
    color: rgb(0.55, 0.4, 0.95),
  });

  page.drawText("MEGA CONTABILIDADE - RELATORIO GERAL DE SINCRONIZACAO", {
    x: margin,
    y: y - 35,
    size: 15,
    font: fontBold,
    color: rgb(0.67, 0.54, 0.98),
  });

  page.drawText("Dossie Executivo: Gestta -> Mega CRM -> Google Drive", {
    x: margin,
    y: y - 53,
    size: 10,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  const timeFormatted = cleanText(new Date(summary.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }));
  page.drawText(`Executado em: ${timeFormatted} | Total Empresas: ${summary.totalCompanies} | Total Tarefas: ${summary.totalTasks}`, {
    x: margin,
    y: y - 70,
    size: 8,
    font,
    color: rgb(0.75, 0.75, 0.8),
  });

  y -= 110;

  drawSectionHeader(page, fontBold, margin, y, "RESUMO EXECUTIVO POR EMPRESA");
  y -= 25;

  for (const comp of summary.companies) {
    if (y < 80) {
      page = doc.addPage([595.28, 841.89]);
      y = height - 50;
    }

    const totalCompTasks = comp.competences.reduce((acc, c) => acc + c.tasks.length, 0);

    page.drawRectangle({
      x: margin,
      y: y - 24,
      width: width - margin * 2,
      height: 24,
      color: rgb(0.95, 0.94, 0.98),
      borderColor: rgb(0.85, 0.8, 0.95),
      borderWidth: 1,
    });

    page.drawText(cleanText(comp.companyName, 55), {
      x: margin + 10,
      y: y - 16,
      size: 9,
      font: fontBold,
      color: rgb(0.2, 0.1, 0.35),
    });

    page.drawText(`${comp.competences.length} comp. | ${totalCompTasks} tarefas`, {
      x: width - margin - 140,
      y: y - 16,
      size: 8.5,
      font: fontBold,
      color: rgb(0.4, 0.2, 0.6),
    });

    y -= 32;
  }

  // Rodapé
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height: 30,
    color: rgb(0.95, 0.95, 0.97),
  });

  page.drawText("Mega CRM - Relatorio Geral de Sincronizacao Gestta & Google Drive", {
    x: margin,
    y: 11,
    size: 7.5,
    font,
    color: rgb(0.4, 0.4, 0.45),
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

// Funções auxiliares de desenho
function drawSectionHeader(
  page: any,
  fontBold: any,
  x: number,
  y: number,
  title: string,
) {
  page.drawText(title, {
    x,
    y: y - 10,
    size: 9,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.25),
  });

  page.drawLine({
    start: { x, y: y - 14 },
    end: { x: x + 515, y: y - 14 },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.9),
  });
}

function drawInfoTable(
  page: any,
  font: any,
  fontBold: any,
  x: number,
  yStart: number,
  rows: Array<[string, string] | string[]>,
): number {
  let curY = yStart;
  for (let i = 0; i < rows.length; i++) {
    const [label, val] = rows[i];
    const rowBg = i % 2 === 0 ? rgb(0.97, 0.97, 0.98) : rgb(1, 1, 1);

    page.drawRectangle({
      x,
      y: curY - 15,
      width: 515,
      height: 16,
      color: rowBg,
    });

    page.drawText(label, {
      x: x + 8,
      y: curY - 11,
      size: 8,
      font: fontBold,
      color: rgb(0.35, 0.35, 0.4),
    });

    page.drawText(val, {
      x: x + 160,
      y: curY - 11,
      size: 8,
      font,
      color: rgb(0.1, 0.1, 0.15),
    });

    curY -= 17;
  }
  return curY;
}
