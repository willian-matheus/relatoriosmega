async function testAccountingDocs() {
  const BASE_URL = "https://api.gestta.com.br/core";
  const loginRes = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://app.gestta.com.br",
      Referer: "https://app.gestta.com.br/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    },
    body: JSON.stringify({
      email: "financeiro@megacontabilidade.com",
      password: "Mega@313",
    }),
  });

  const token = loginRes.headers.get("authorization");
  console.log("Token obtido:", !!token);

  // Test accounting document search
  const accRes = await fetch("https://api.gestta.com.br/accounting/document/search?limit=10", {
    headers: {
      Authorization: token,
      Origin: "https://app.gestta.com.br",
    },
  });
  console.log("Status /accounting/document/search:", accRes.status);
  if (accRes.ok) {
    const data = await accRes.json();
    console.log("Accounting docs result:", JSON.stringify(data).slice(0, 500));
  } else {
    console.log("Accounting docs err:", await accRes.text());
  }
}

testAccountingDocs().catch(console.error);
