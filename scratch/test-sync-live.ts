import { syncGesttaToCrmAndDrive } from '../apps/web/src/lib/gestta-sync';

async function runTest() {
  console.log('=== TESTANDO FLUXO COMPLETO GESTTA -> PDF -> CRM -> GOOGLE DRIVE ===\n');

  const result = await syncGesttaToCrmAndDrive({
    limit: 3, // testa com 3 tarefas reais do Gestta
  });

  console.log('\n========================================');
  console.log('        RESULTADO DA SINCRONIZAÇÃO       ');
  console.log('========================================');
  console.log('Status: Sucesso =', result.success);
  console.log('Data/Hora:', result.timestamp);
  console.log('Total Tarefas Processadas:', result.totalTasks);
  console.log('Total Empresas Agrupadas:', result.totalCompanies);
  console.log('Pasta Raiz Google Drive:', result.driveRootUrl);
  console.log('PDF Geral Sincronizado:', result.driveGeneralPdfUrl);

  console.log('\n--- Empresas e Arquivos Gerados ---');
  for (const comp of result.companies) {
    console.log(`\n🏢 Empresa: ${comp.companyName} (Cód: ${comp.companyCode || 'N/A'}, CNPJ: ${comp.companyCnpj || 'N/A'})`);
    for (const group of comp.competences) {
      console.log(`  📅 Competência: ${group.competence}`);
      console.log(`     📄 PDF Consolidado da Competência: ${group.pdfFileLink || 'N/A'}`);
      console.log(`     📊 CSV da Competência: ${group.csvFileLink || 'N/A'}`);
      for (const t of group.tasks) {
        console.log(`     -> Tarefa: "${t.name}" [${t.status}]`);
        console.log(`        📄 Relatório Tarefa em PDF: ${t.pdfFileLink || 'N/A'}`);
        console.log(`        🔗 Link Principal (Drive): ${t.fileLink || 'N/A'}`);
        if (t.attachedDocsCount && t.attachedDocsCount > 0) {
          console.log(`        📎 Anexos Gestta baixados: ${t.attachedDocsCount}`);
        }
      }
    }
  }
}

runTest().catch((err) => {
  console.error('\n❌ Erro durante o teste de sincronização:', err);
  process.exit(1);
});
