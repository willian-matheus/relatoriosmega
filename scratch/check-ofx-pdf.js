async function checkGestta() {
  console.log("=== 1. CHECANDO BUNDLE FRONTEND DO GESTTA ===");
  try {
    const htmlRes = await fetch("https://app.gestta.com.br/");
    const html = await htmlRes.text();
    const scriptMatches = [...html.matchAll(/src="([^"]*scripts\/[^"]+)"/g)].map(m => m[1]);
    console.log("Scripts encontrados no Gestta:", scriptMatches);

    for (const scriptUrl of scriptMatches) {
      const fullUrl = scriptUrl.startsWith("http") ? scriptUrl : `https://app.gestta.com.br/${scriptUrl.replace(/^\//, '')}`;
      console.log(`Baixando e analisando ${fullUrl}...`);
      const scriptRes = await fetch(fullUrl);
      const code = await scriptRes.text();

      // Checa OFX
      const ofxMatches = [...code.matchAll(/.{0,50}ofx.{0,50}/gi)];
      console.log(`Menções a 'ofx' em ${scriptUrl}:`, ofxMatches.length);
      for (const m of ofxMatches.slice(0, 10)) {
        console.log("  OFX match:", m[0]);
      }

      // Checa PDF
      const pdfMatches = [...code.matchAll(/.{0,50}\.pdf.{0,50}/gi)];
      console.log(`Menções a '.pdf' em ${scriptUrl}:`, pdfMatches.length);
      for (const m of pdfMatches.slice(0, 10)) {
        console.log("  PDF match:", m[0]);
      }

      // Checa exportações de relatórios / formatos
      const exportMatches = [...code.matchAll(/format[s]?:.{0,50}/gi)];
      console.log(`Menções a format em ${scriptUrl}:`, exportMatches.slice(0, 5).map(m => m[0]));
    }
  } catch (err) {
    console.error("Erro ao analisar bundle:", err);
  }

  console.log("\n=== 2. AUTENTICANDO NA API DO GESTTA ===");
  const BASE_URL = "https://api.gestta.com.br/core";
  try {
    const loginRes = await fetch(`${BASE_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Origin: "https://app.gestta.com.br",
        Referer: "https://app.gestta.com.br/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
      },
      body: JSON.stringify({
        email: "financeiro@megacontabilidade.com",
        password: "Mega@313",
      }),
    });

    console.log("Status login:", loginRes.status);
    const token = loginRes.headers.get("authorization");
    if (!token) {
      console.error("Token não recebido!");
      return;
    }
    console.log("Token obtido com sucesso!");

    // 2.1 Consulta relatórios disponíveis em /report
    console.log("\n--- Consultando /report ---");
    const repRes = await fetch(`${BASE_URL}/report`, {
      headers: { Authorization: token, Origin: "https://app.gestta.com.br" },
    });
    console.log("Status /report:", repRes.status);
    if (repRes.ok) {
      const reports = await repRes.json();
      console.log("Total relatórios encontrados:", Array.isArray(reports) ? reports.length : reports);
      if (Array.isArray(reports)) {
        reports.forEach((r, idx) => {
          console.log(`[${idx + 1}] ID: ${r._id || r.id} | Nome: ${r.name} | Tipo: ${r.type} | Descrição: ${r.description || ''}`);
        });
      }
    } else {
      console.log("Erro /report:", await repRes.text());
    }

    // 2.2 Consulta tarefas recentes para ver se possuem anexos / documentos / PDFs / OFX
    console.log("\n--- Consultando tarefas recentes e seus documentos ---");
    const taskRes = await fetch(`${BASE_URL}/customer/task/search`, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        Origin: "https://app.gestta.com.br",
      },
      body: JSON.stringify({
        limit: 10,
        no_owner: true,
      }),
    });
    if (taskRes.ok) {
      const taskData = await taskRes.json();
      const docs = taskData.docs || (Array.isArray(taskData) ? taskData : []);
      console.log(`Tarefas obtidas: ${docs.length}`);
      for (const t of docs.slice(0, 5)) {
        console.log(`Tarefa: ${t.name} (ID: ${t._id})`);
        console.log("  Documents array:", t.documents ? t.documents.length : 0);
        console.log("  Attachments array:", t.attachments ? t.attachments.length : 0);
        console.log("  Keys na tarefa:", Object.keys(t).filter(k => /doc|file|report|attach|pdf|ofx/i.test(k)));
        
        // Vamos checar endpoints de documentos para esta tarefa
        const docRes = await fetch(`${BASE_URL}/customer/task/${t._id}/document`, {
          headers: { Authorization: token, Origin: "https://app.gestta.com.br" },
        });
        if (docRes.ok) {
          const docData = await docRes.json();
          console.log(`  Documentos em /customer/task/${t._id}/document:`, JSON.stringify(docData).slice(0, 200));
        }
      }
    }

    // 2.3 Checar outros endpoints comuns de documentos e relatórios
    console.log("\n--- Testando outros endpoints de documentos/arquivos ---");
    const endpointsToTest = [
      "/document",
      "/document/type",
      "/report/types",
      "/company/document",
      "/customer/document",
      "/bank",
      "/financial",
      "/statement",
      "/extract",
    ];

    for (const ep of endpointsToTest) {
      const res = await fetch(`${BASE_URL}${ep}`, {
        headers: { Authorization: token, Origin: "https://app.gestta.com.br" },
      });
      console.log(`Endpoint ${ep}: ${res.status}`);
      if (res.ok) {
        const data = await res.json().catch(() => null);
        console.log(`  Sucesso em ${ep}! Resposta:`, JSON.stringify(data).slice(0, 150));
      }
    }

  } catch (err) {
    console.error("Erro na consulta à API:", err);
  }
}

checkGestta();
