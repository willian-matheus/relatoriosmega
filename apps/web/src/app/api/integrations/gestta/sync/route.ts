import { NextRequest, NextResponse } from "next/server";
import { syncGesttaToCrmAndDrive } from "@/lib/gestta-sync";
import { getGesttaIntegrationStatus } from "@/lib/gestta";
import { getAuthenticatedDriveClient } from "@/lib/google";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { startDate, endDate, limit, customerId } = body;

    const summary = await syncGesttaToCrmAndDrive({
      startDate,
      endDate,
      limit: limit ? Number(limit) : 20,
      customerId,
    });

    return NextResponse.json(summary);
  } catch (err) {
    console.error("Erro na sincronização Gestta -> CRM -> Google Drive:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Falha ao sincronizar dados do Gestta",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const [gesttaStatus, driveClient] = await Promise.all([
      getGesttaIntegrationStatus(),
      getAuthenticatedDriveClient("default_user"),
    ]);

    return NextResponse.json({
      gestta: gesttaStatus,
      googleDrive: {
        connected: Boolean(driveClient?.drive),
        email: driveClient?.integration?.google_email,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erro ao obter status das integrações",
      },
      { status: 500 },
    );
  }
}
