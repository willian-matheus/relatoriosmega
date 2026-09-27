async function inspectCustomerTaskService() {
  const res = await fetch('https://app.gestta.com.br/scripts/app-5bf4006084.js');
  const code = await res.text();

  const idx = code.indexOf('.service("CustomerTaskService"');
  console.log(code.substring(idx + 1000, idx + 3500));
}

inspectCustomerTaskService().catch(console.error);
