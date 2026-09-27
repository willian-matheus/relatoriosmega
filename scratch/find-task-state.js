async function findTaskEndpoints() {
  const res = await fetch('https://app.gestta.com.br/scripts/app-5bf4006084.js');
  const code = await res.text();

  // Find task/overview/dashboard state in router
  const idx = code.indexOf('task.overview.dashboard');
  if (idx !== -1) {
    console.log('State definition:');
    console.log(code.substring(Math.max(0, idx - 200), idx + 800));
  }
}

findTaskEndpoints().catch(console.error);
