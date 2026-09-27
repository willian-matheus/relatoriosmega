async function searchServices() {
  const res = await fetch('https://app.gestta.com.br/scripts/app-5bf4006084.js');
  const code = await res.text();

  // Find all service declarations
  const re = /\.service\(["']([^"']+)["']/g;
  let m;
  const services = [];
  while ((m = re.exec(code)) !== null) {
    services.push(m[1]);
  }
  console.log('Services count:', services.length);
  console.log('Task/Report/Doc services:', services.filter(s => 
    /task|report|doc|competenc|customer|company/i.test(s)
  ));
}

searchServices().catch(console.error);
