import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { CrmService } from "../src/crm.service";

const input = {
  company: "Empresa de teste",
  contact: "Contato de teste",
  value: 1250.5,
  dueDate: "2026-09-20",
};

test("cria, edita, move e remove uma oportunidade sem banco", async () => {
  delete process.env.SUPABASE_URL;
  const service = new CrmService();
  const initial = (await service.snapshot()).opportunities.length;
  assert.deepEqual(await service.snapshot(), {
    opportunities: [],
    reports: [],
    activities: [],
  });
  const created = await service.save(input);
  assert.equal(created.stage, "new");
  assert.equal((await service.snapshot()).opportunities.length, initial + 1);
  assert.equal(
    (await service.save({ ...input, value: 2500 }, created.id)).value,
    2500,
  );
  assert.equal((await service.move(created.id, { stage: "won" })).stage, "won");
  await service.remove(created.id);
  assert.equal((await service.snapshot()).opportunities.length, initial);
  assert.equal((await service.snapshot()).activities.length, 4);
});

test("rejeita etapa, valor e datas inválidos sem alterar o pipeline", async () => {
  delete process.env.SUPABASE_URL;
  const service = new CrmService();
  const before = structuredClone(await service.snapshot());
  await assert.rejects(
    async () => service.save({ ...input, value: -1 }),
    BadRequestException,
  );
  await assert.rejects(
    async () => service.save({ ...input, value: NaN }),
    BadRequestException,
  );
  await assert.rejects(
    async () => service.save({ ...input, dueDate: "2026-02-30" }),
    BadRequestException,
  );
  await assert.rejects(
    async () => service.move("demo-1", { stage: "inventada" }),
    BadRequestException,
  );
  await assert.rejects(
    async () => service.move("nao-existe", { stage: "won" }),
    NotFoundException,
  );
  assert.deepEqual(await service.snapshot(), before);
});

test("importação só grava após confirmação e não repete o mesmo token", async () => {
  delete process.env.SUPABASE_URL;
  const service = new CrmService();
  const initial = (await service.snapshot()).opportunities.length;
  const preview = service.preview({
    name: "exemplo.csv",
    rows: [input, { ...input, company: "Outra Empresa" }],
  });
  assert.equal((await service.snapshot()).opportunities.length, initial);
  const report = await service.commit(preview.token);
  assert.equal(report.count, 2);
  assert.equal((await service.snapshot()).opportunities.length, initial + 2);
  assert.equal((await service.snapshot()).reports.length, 1);
  await assert.rejects(
    async () => service.commit(preview.token),
    ConflictException,
  );
  assert.equal((await service.snapshot()).opportunities.length, initial + 2);
});

test("linha inválida e lote acima de 500 são recusados integralmente", async () => {
  delete process.env.SUPABASE_URL;
  const service = new CrmService();
  const before = structuredClone(await service.snapshot());
  assert.throws(
    () =>
      service.preview({
        name: "invalido.csv",
        rows: [input, { ...input, company: "" }],
      }),
    BadRequestException,
  );
  assert.throws(
    () => service.preview({ name: "vazio.csv", rows: [] }),
    BadRequestException,
  );
  assert.throws(
    () =>
      service.preview({ name: "grande.csv", rows: Array(501).fill(input) }),
    BadRequestException,
  );
  assert.deepEqual(await service.snapshot(), before);
});
