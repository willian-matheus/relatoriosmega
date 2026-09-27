async function testAccountingDocsWithCustomer() {
  const BASE_URL = "https://api.gestta.com.br/core";
  const loginRes = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://app.gestta.com.br",
    },
    body: JSON.stringify({
      email: "financeiro@megacontabilidade.com",
      password: "Mega@313",
    }),
  });

  const token = loginRes.headers.get("authorization");

  // Busca clientes
  const custRes = await fetch(`${BASE_URL}/customer?limit=5`, {
    headers: { Authorization: token, Origin: "https://app.gestta.com.br" },
  });
  const custData = await custRes.json();
  const customers = custData.docs || (Array.isArray(custData) ? custData : []);
  console.log("Customers encontrados:", customers.length);

  for (const c of customers) {
    console.log(`Buscando docs para cliente: ${c.name} (${c._id})`);
    const accRes = await fetch(`https://api.gestta.com.br/accounting/document/search?customer=${c._id}&limit=10`, {
      headers: {
        Authorization: token,
        Origin: "https://app.gestta.com.br",
      },
    });
    if (accRes.ok) {
      const data = await accRes.json();
      console.log(`Documentos para ${c.name}:`, Array.isArray(data) ? data.length : data);
      if (Array.isArray(data) && data.length > 0) {
        console.log("Exemplo de doc:", JSON.stringify(data[0], null, 2));
      }
    } else {
      console.log("Erro:", accRes.status, await accRes.text());
    }
  }
}

testAccountingDocsWithCustomer().catch(console.error);
