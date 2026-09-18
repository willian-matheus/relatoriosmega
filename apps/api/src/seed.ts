import { Opportunity, Stage } from "@mega/contracts";

export function seed(): Opportunity[] {
  const now = new Date();
  const date = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const records: [string, string, number, Stage, number, string, string][] = [
    [
      "Nexus Tecnologia",
      "Mariana Alves",
      18500,
      "new",
      1,
      "Relatório comercial",
      "Solução para acompanhar a operação comercial de três unidades.",
    ],
    [
      "Verde & Co.",
      "Rafael Mendes",
      8200,
      "new",
      3,
      "Indicação",
      "Primeira conversa sobre organização do processo de vendas.",
    ],
    [
      "Studio Forma",
      "Juliana Dias",
      6400,
      "new",
      4,
      "Website",
      "Interesse no plano para equipes pequenas.",
    ],
    [
      "Órbita Logística",
      "Lucas Ribeiro",
      32000,
      "contact",
      0,
      "Relatório comercial",
      "Reunião de diagnóstico agendada com o time de operações.",
    ],
    [
      "Café Aurora",
      "Beatriz Santos",
      4800,
      "contact",
      2,
      "Website",
      "Mapear necessidades das lojas e apresentar o produto.",
    ],
    [
      "Grupo Horizonte",
      "Pedro Oliveira",
      45000,
      "proposal",
      1,
      "Relatório comercial",
      "Proposta enviada. Aguardando avaliação do comitê.",
    ],
    [
      "Lume Arquitetura",
      "Isabela Rocha",
      12800,
      "proposal",
      5,
      "Indicação",
      "Proposta para centralizar os contatos e projetos.",
    ],
    [
      "Atlas Engenharia",
      "Felipe Costa",
      28500,
      "negotiation",
      -1,
      "Relatório comercial",
      "Alinhar condições de pagamento e cronograma de implantação.",
    ],
    [
      "Casa Botânica",
      "Clara Ferreira",
      9600,
      "negotiation",
      2,
      "Website",
      "Últimos ajustes de escopo com a diretoria.",
    ],
    [
      "Vértice Digital",
      "André Lima",
      22000,
      "won",
      -2,
      "Indicação",
      "Contrato aprovado. Preparar o início do projeto.",
    ],
    [
      "Essenza Design",
      "Sofia Martins",
      7500,
      "won",
      -3,
      "Website",
      "Boas-vindas enviadas e equipe alinhada.",
    ],
  ];
  return records.map(
    ([company, contact, value, stage, days, source, notes], i) => ({
      id: `demo-${i + 1}`,
      company,
      contact,
      value,
      stage,
      source,
      notes,
      email: "",
      owner: (["Ana Martins", "Bruno Costa", "Camila Lima"] as const)[i % 3],
      priority: i % 4 === 0 ? "high" : i % 3 === 0 ? "low" : "medium",
      dueDate: date(days),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }),
  );
}
