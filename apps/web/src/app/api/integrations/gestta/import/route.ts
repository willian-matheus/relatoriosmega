import { NextRequest, NextResponse } from "next/server";
import { saveOpportunity } from "@/lib/crm-backend";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customers, owner, priority, defaultDueDate } = body;

    if (!Array.isArray(customers) || customers.length === 0) {
      return NextResponse.json(
        { error: "Nenhum cliente selecionado para importação." },
        { status: 400 },
      );
    }

    const assignedOwner = owner || "Ana Martins";
    const assignedPriority = priority || "medium";
    const today = new Date();
    today.setDate(today.getDate() + 7);
    const dueDateStr =
      defaultDueDate || today.toISOString().split("T")[0];

    const results = [];
    for (const cust of customers) {
      const companyName = cust.name || "Cliente Gestta";
      const notes = [
        cust.cnpj ? `CNPJ: ${cust.cnpj}` : "",
        cust.code ? `Código Gestta: ${cust.code}` : "",
        "Origem: Importação direta do Gestta (Mega Contabilidade)",
      ]
        .filter(Boolean)
        .join(" | ");

      try {
        const opp = await saveOpportunity({
          company: companyName,
          contact: companyName,
          email: cust.email || "",
          value: typeof cust.value === "number" ? cust.value : 0,
          stage: "new",
          owner: assignedOwner,
          priority: assignedPriority,
          source: "Gestta",
          dueDate: dueDateStr,
          notes,
        });
        results.push(opp);
      } catch (oppErr) {
        console.warn(`Erro ao importar cliente ${companyName}:`, oppErr);
      }
    }

    return NextResponse.json({
      success: true,
      importedCount: results.length,
      opportunities: results,
    });
  } catch (err) {
    console.error("Erro na importação de clientes do Gestta:", err);
    return NextResponse.json(
      { error: "Erro interno ao processar a importação de clientes." },
      { status: 500 },
    );
  }
}
