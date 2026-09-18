import { NextResponse } from "next/server";
import { disconnectGestta } from "@/lib/gestta";

export async function POST() {
  try {
    await disconnectGestta();
    return NextResponse.json({ success: true, message: "Gestta desconectado." });
  } catch (err) {
    return NextResponse.json(
      { error: "Erro ao desconectar Gestta." },
      { status: 500 },
    );
  }
}
