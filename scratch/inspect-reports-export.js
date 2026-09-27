async function inspectReports() {
  const res = await fetch('https://app.gestta.com.br/scripts/app-5bf4006084.js');
  const code = await res.text();

  // Procurar flexmonsterExportTypes
  const idx = code.indexOf('flexmonsterExportTypes');
  if (idx !== -1) {
    console.log("flexmonsterExportTypes context:");
    console.log(code.substring(idx - 100, idx + 400));
  }

  // Procurar ReportService
  const repIdx = code.indexOf('.service("ReportService"');
  if (repIdx !== -1) {
    console.log("\nReportService definition:");
    console.log(code.substring(repIdx, repIdx + 1500));
  }

  // Procurar "exportTo"
  const expIdx = code.indexOf('exportTo');
  if (expIdx !== -1) {
    console.log("\nexportTo context:");
    console.log(code.substring(expIdx - 100, expIdx + 400));
  }

  // Procurar rota de relatórios no angular
  const routeIdx = code.indexOf('/report');
  if (routeIdx !== -1) {
    console.log("\n/report routes:");
    console.log(code.substring(routeIdx - 50, routeIdx + 300));
  }
}

inspectReports().catch(console.error);
