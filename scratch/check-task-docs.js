const BASE_URL = 'https://api.gestta.com.br/core';
(async () => {
  const loginRes = await fetch(BASE_URL + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.gestta.com.br' },
    body: JSON.stringify({ email: 'financeiro@megacontabilidade.com', password: 'Mega@313' })
  });
  const token = loginRes.headers.get('authorization');
  
  // Buscar 50 tarefas
  const taskRes = await fetch(BASE_URL + '/customer/task/search', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json', Origin: 'https://app.gestta.com.br' },
    body: JSON.stringify({ limit: 50, no_owner: true })
  });
  const taskData = await taskRes.json();
  const tasks = taskData.docs || taskData;
  console.log('Total tarefas pesquisadas:', tasks.length);

  let tasksWithDocs = 0;
  for (const t of tasks) {
    if ((t.documents && t.documents.length > 0) || (t.company_documents && t.company_documents.length > 0)) {
      console.log(`Tarefa com docs: ${t.name} (${t._id}) - Docs: ${t.documents?.length || 0}`);
      tasksWithDocs++;
    }
  }
  console.log('Total tarefas com docs no payload inicial:', tasksWithDocs);

  // Também consultar /customer/task/report
  const repRes = await fetch(BASE_URL + '/customer/task/report', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json', Origin: 'https://app.gestta.com.br' },
    body: JSON.stringify({ limit: 5 })
  });
  console.log('Status /customer/task/report:', repRes.status);
  if (repRes.ok) {
    const data = await repRes.json();
    console.log('Report data sample:', JSON.stringify(data).slice(0, 300));
  }
})().catch(console.error);
