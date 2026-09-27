async function inspectServiceDefinitions() {
  const res = await fetch('https://app.gestta.com.br/scripts/app-5bf4006084.js');
  const code = await res.text();

  const services = ['CustomerTaskService', 'ReportService', 'CustomerTaskDocumentService', 'AutomationDocumentService'];
  for (const s of services) {
    console.log(`\n================ Service: ${s} ================`);
    const idx = code.indexOf(`.service("${s}"`);
    if (idx !== -1) {
      console.log(code.substring(idx, idx + 1200));
    }
  }
}

inspectServiceDefinitions().catch(console.error);
