import { NextRequest, NextResponse } from "next/server";
import { ReportUpdateError } from "@mega/contracts";
import { updateReport } from "@/lib/crm-backend";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await verifySessionToken(token) : null;
  if (!user)
    return NextResponse.json(
      { message: "Faça login para registrar o acompanhamento." },
      { status: 401 },
    );
  const body = await request.json().catch(() => null);
  try {
    const { id } = await params;
    return NextResponse.json(
      await updateReport(id, body, {
        name: user.name || user.email,
        email: user.email,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof ReportUpdateError
            ? error.message
            : "Não foi possível salvar o relatório.",
      },
      { status: error instanceof ReportUpdateError ? error.status : 500 },
    );
  }
}
