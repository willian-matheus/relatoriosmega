import { syncGesttaToCrmAndDrive } from '../apps/web/src/lib/gestta-sync.ts';

async function runLiveTest() {
  console.log("=== INICIANDO TESTE REAL DE SINCRONIZACAO GESTTA -> PDF -> CRM -> DRIVE ===");
  try {
    const result = await syncGesttaToCrmAndDrive({
      limit: 2, // 2 tarefas para teste rápido
    });

    console.log("\n=== RESULTADO DA SINCRONIZACAO ===");
    console.log("Sucesso:", result.success);
    console.log("Total Empresas:", result.totalCompanies);
    console.log("Total Tarefas:", result.totalTasks);
    console.log("Link PDF Geral no Drive:", result.driveGeneralPdfUrl);
    console.log("Pasta Raiz no Drive:", result.driveRootUrl);

    for (const comp of result.companies) {
      console.log(`\nEmpresa: ${comp.companyName}`);
      for (const group of comp.competences) {
        console.log(`  Competencia: ${group.competence}`);
        console.log(`  PDF Competencia Link: ${group.pdfFileLink}`);
        console.log(`  CSV Competencia Link: ${group.csvFileLink}`);
        for (const t of group.tasks) {
          console.log(`    Tarefa: ${t.name}`);
          console.log(`    Status: ${t.status}`);
          console.log(`    PDF Tarefa Link: ${t.pdfFileLink}`);
          console.log(`    Link Principal: ${t.fileLink}`);
        }
      }
    }
  } catch (err) {
    console.error("Erro no teste:", err);
  }
}

runLiveTest();
