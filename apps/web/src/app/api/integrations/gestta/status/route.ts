import { NextResponse } from "next/server";
import { getGesttaIntegrationStatus } from "@/lib/gestta";

export async function GET() {
  try {
    const status = await getGesttaIntegrationStatus();
    return NextResponse.json(status);
  } catch (err) {
    console.error("Erro ao obter status do Gestta:", err);
    return NextResponse.json({ connected: false });
  }
}
