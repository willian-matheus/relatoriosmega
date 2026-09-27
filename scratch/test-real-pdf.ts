import { getGesttaTasks, getGesttaReports } from '../apps/web/src/lib/gestta';
import { generateTaskPdfReport, generateCompetencePdfReport, generateGeneralSyncSummaryPdf } from '../apps/web/src/lib/gestta-pdf';
import fs from 'node:fs';

async function testRealPdfGeneration() {
  console.log('--- Buscando dados reais do Gestta para gerar PDFs ---');
  const [reportsList, tasksData] = await Promise.all([
    getGesttaReports(),
    getGesttaTasks({ limit: 3 }),
  ]);

  console.log(`Tarefas obtidas: ${tasksData.tasks.length}`);
  console.log(`Relatórios obtidos: ${reportsList.length}`);

  // 1. Gera PDF individual para a primeira tarefa real
  const sampleTask = tasksData.tasks[0];
  console.log(`\nGerando PDF da tarefa real: "${sampleTask.name}" (${sampleTask.companyName})...`);
  const taskPdfBuffer = await generateTaskPdfReport(sampleTask, reportsList);
  fs.writeFileSync('scratch/Relatorio_Tarefa_Gestta_REAL.pdf', taskPdfBuffer);
  console.log(`✅ PDF da Tarefa gerado com sucesso! Tamanho: ${taskPdfBuffer.length} bytes.`);

  // 2. Gera PDF consolidado de competência
  console.log(`\nGerando PDF de Competência para "${sampleTask.companyName}" (${sampleTask.competence})...`);
  const compPdfBuffer = await generateCompetencePdfReport(sampleTask.companyName, sampleTask.competence, tasksData.tasks);
  fs.writeFileSync('scratch/Relatorio_Competencia_REAL.pdf', compPdfBuffer);
  console.log(`✅ PDF da Competência gerado com sucesso! Tamanho: ${compPdfBuffer.length} bytes.`);

  // 3. Gera PDF Executivo Geral
  console.log(`\nGerando PDF Geral de Sincronização...`);
  const genPdfBuffer = await generateGeneralSyncSummaryPdf({
    timestamp: new Date().toISOString(),
    totalTasks: tasksData.tasks.length,
    totalCompanies: 2,
    companies: [
      {
        companyName: sampleTask.companyName,
        competences: [{ competence: sampleTask.competence, tasks: tasksData.tasks }],
      },
    ],
  });
  fs.writeFileSync('scratch/Relatorio_Geral_REAL.pdf', genPdfBuffer);
  console.log(`✅ PDF Geral de Sincronização gerado com sucesso! Tamanho: ${genPdfBuffer.length} bytes.`);
}

testRealPdfGeneration().catch(console.error);
