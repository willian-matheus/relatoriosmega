async function findEnv() {
  const res = await fetch('https://app.gestta.com.br/scripts/app-5bf4006084.js');
  const t = await res.text();
  const idx = t.indexOf('.constant("APP_ENV"');
  if (idx !== -1) {
    console.log(t.substring(idx, idx + 500));
  } else {
    // search for CORE_API_URL
    const idxCore = t.indexOf('CORE_API_URL');
    console.log(t.substring(idxCore - 100, idxCore + 300));
  }
}
findEnv();
