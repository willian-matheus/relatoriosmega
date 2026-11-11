import { test } from "node:test";
import assert from "node:assert/strict";

// Arquivo separado: o cliente do Supabase fica em cache no processo.
// Endereço local inalcançável: nada é gravado em lugar nenhum.
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";

test("cliente null explícito é no-op mesmo com Supabase no ambiente", async () => {
  const { saveTaskSnapshot } = await import("../src/lib/dashboard/snapshot");
  const res = await saveTaskSnapshot(
    [{ gestta_task_id: "t1", synced_at: "2026-11-11T13:00:00Z" } as any],
    null,
  );
  assert.equal(res.enabled, false);
  assert.equal(res.batches, 0);
  assert.deepEqual(res.errors, []);
});

test("cliente do ambiente: erro de conexão vira erro no resultado, sem lançar", async () => {
  const { saveTaskSnapshot } = await import("../src/lib/dashboard/snapshot");
  const res = await saveTaskSnapshot([{ gestta_task_id: "t1", synced_at: "2026-11-11T13:00:00Z" } as any]);
  assert.equal(res.enabled, true);
  assert.equal(res.written, 0);
  assert.equal(res.errors.length, 1);
});
