async function inspectDocTypes() {
  const res = await fetch('https://app.gestta.com.br/scripts/app-5bf4006084.js');
  const code = await res.text();

  const idx = code.indexOf('.service("CustomerTaskDocumentService"');
  if (idx !== -1) {
    console.log("CustomerTaskDocumentService definition:");
    console.log(code.substring(idx, idx + 1200));
  }

  // Verificar se há menções a extensões permitidas de upload
  const fileExtIdx = code.indexOf('allowedExtensions');
  if (fileExtIdx !== -1) {
    console.log("allowedExtensions:");
    console.log(code.substring(fileExtIdx - 50, fileExtIdx + 200));
  }
}

inspectDocTypes().catch(console.error);
