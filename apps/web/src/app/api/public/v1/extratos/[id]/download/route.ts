import { NextRequest, NextResponse } from "next/server";
import {
  readApiTokenFromHeaders,
  STATEMENTS_READ_SCOPE,
  verifyApiToken,
} from "@/lib/api-tokens";
import { getStatementContent } from "@/lib/statements";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/v1/extratos/:id/download
 * Devolve o arquivo OFX ou PDF. Exige o mesmo token da listagem.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifyApiToken(
    readApiTokenFromHeaders(request.headers),
    STATEMENTS_READ_SCOPE,
  );
  if (!auth.ok) {
    return NextResponse.json(
      { erro: auth.error },
      {
        status: auth.status,
        headers: auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
      },
    );
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ erro: "Extrato não encontrado." }, { status: 404 });
  }

  try {
    const content = await getStatementContent(id);
    if (!content) {
      return NextResponse.json({ erro: "Extrato não encontrado." }, { status: 404 });
    }

    const { file, buffer } = content;
    const asciiName = file.fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${asciiName || "extrato"}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "X-Content-SHA256": file.sha256,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    console.error("Erro ao baixar extrato:", error);
    return NextResponse.json({ erro: "Não foi possível baixar o extrato." }, { status: 500 });
  }
}
