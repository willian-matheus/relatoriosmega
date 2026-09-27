import { generateTaskPdfReport, generateCompetencePdfReport, generateGeneralSyncSummaryPdf } from '../apps/web/src/lib/gestta-pdf.ts';
import fs from 'node:fs';

async function testAllPdfs() {
  const dummyTask = {
    id: "616081b41d89ec000630baf8",
    name: "Envio de Documentos Contabeis",
    companyName: "ESG SERVICOS AUTOMOTIVOS LTDA",
    companyCode: "1024",
    companyCnpj: "12.345.678/0001-90",
    competence: "2026-08",
    competenceDate: "2026-08-01",
    dueDate: "2026-08-15",
    legalDate: "2026-08-20",
    status: "DONE",
    overdue: false,
    department: "Fiscal",
    type: "RECURRENT",
    subtype: "AUTOMATIC"
  };

  const dummyReports = [
    { id: "1", name: "Tarefas por Empresa", type: "CUSTOMER_TASK" },
    { id: "2", name: "Analise Mensal", type: "CUSTOMER_TASK" }
  ];

  console.log("Generating Task PDF...");
  const taskPdf = await generateTaskPdfReport(dummyTask, dummyReports);
  console.log("Task PDF generated:", taskPdf.length, "bytes");

  console.log("Generating Competence PDF...");
  const compPdf = await generateCompetencePdfReport("ESG SERVICOS AUTOMOTIVOS LTDA", "2026-08", [dummyTask, { ...dummyTask, id: "2", name: "Folha de Pagamento", status: "OPEN", overdue: true }]);
  console.log("Competence PDF generated:", compPdf.length, "bytes");

  console.log("Generating General Summary PDF...");
  const genPdf = await generateGeneralSyncSummaryPdf({
    timestamp: new Date().toISOString(),
    totalTasks: 2,
    totalCompanies: 1,
    companies: [{ companyName: "ESG SERVICOS AUTOMOTIVOS LTDA", competences: [{ competence: "2026-08", tasks: [dummyTask] }] }]
  });
  console.log("General Summary PDF generated:", genPdf.length, "bytes");
}

testAllPdfs().catch(console.error);
