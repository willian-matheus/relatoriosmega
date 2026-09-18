import { google } from "googleapis";
import { TablesUpdate } from "@mega/contracts";
import { getSupabaseServerClient } from "./supabase-server";

export function getGoogleOAuthClient(customRedirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    customRedirectUri ||
    process.env.GOOGLE_REDIRECT_URI ||
    "https://relatoriosmega.vercel.app/api/integrations/google/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET precisam estar configurados no .env",
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getAuthenticatedDriveClient(userId = "default_user") {
  const supabase = getSupabaseServerClient();
  const { data: integration, error } = await supabase
    .from("google_drive_integrations")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !integration || !integration.active) {
    return null;
  }

  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials({
    access_token: integration.access_token || undefined,
    refresh_token: integration.refresh_token || undefined,
    expiry_date: integration.expires_at
      ? new Date(integration.expires_at).getTime()
      : undefined,
  });

  // Atualização automática do token no Supabase ao renovar
  oauth2Client.on("tokens", async (tokens) => {
    const updates: TablesUpdate<"google_drive_integrations"> = {
      updated_at: new Date().toISOString(),
    };
    if (tokens.access_token) updates.access_token = tokens.access_token;
    if (tokens.refresh_token) updates.refresh_token = tokens.refresh_token;
    if (tokens.expiry_date) {
      updates.expires_at = new Date(tokens.expiry_date).toISOString();
    }
    await supabase
      .from("google_drive_integrations")
      .update(updates)
      .eq("user_id", userId);
  });

  const drive = google.drive({ version: "v3", auth: oauth2Client });
  return { drive, integration, oauth2Client };
}

/**
 * Encontra ou cria uma pasta no Google Drive pelo nome dentro do pai especificado.
 */
export async function findOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  folderName: string,
  parentId?: string,
): Promise<string> {
  const safeName = folderName.replace(/['\\]/g, "").trim();
  const parentQuery = parentId ? `'${parentId}' in parents` : "'root' in parents";
  const query = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and ${parentQuery}`;

  const res = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  const createRes = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id, name",
  });

  return createRes.data.id!;
}

/**
 * Cria ou navega por uma sequência hierárquica de pastas no Google Drive
 */
export async function findOrCreateFolderPath(
  drive: ReturnType<typeof google.drive>,
  folderNames: string[],
  rootParentId?: string,
): Promise<string> {
  let currentParentId = rootParentId;
  for (const name of folderNames) {
    currentParentId = await findOrCreateFolder(drive, name, currentParentId);
  }
  return currentParentId!;
}

/**
 * Faz upload de um arquivo para uma pasta no Google Drive.
 */
export async function uploadFileToFolder(
  drive: ReturnType<typeof google.drive>,
  options: {
    fileName: string;
    mimeType: string;
    content: string | Buffer;
    parentId: string;
  },
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const { Readable } = await import("node:stream");
  const safeName = options.fileName.replace(/['\\]/g, "").trim();

  // Verifica se o arquivo já existe na pasta para atualizar em vez de duplicar
  const checkQuery = `name = '${safeName}' and '${options.parentId}' in parents and trashed = false`;
  const existing = await drive.files.list({
    q: checkQuery,
    fields: "files(id, name)",
  });

  const bodyStream = Readable.from(
    Buffer.isBuffer(options.content)
      ? options.content
      : Buffer.from(options.content, "utf-8"),
  );

  if (existing.data.files && existing.data.files.length > 0) {
    const fileId = existing.data.files[0].id!;
    const updateRes = await drive.files.update({
      fileId,
      media: {
        mimeType: options.mimeType,
        body: bodyStream,
      },
      fields: "id, name, webViewLink",
    });
    return {
      id: updateRes.data.id!,
      name: updateRes.data.name!,
      webViewLink: updateRes.data.webViewLink || undefined,
    };
  }

  const createRes = await drive.files.create({
    requestBody: {
      name: safeName,
      parents: [options.parentId],
    },
    media: {
      mimeType: options.mimeType,
      body: bodyStream,
    },
    fields: "id, name, webViewLink",
  });

  return {
    id: createRes.data.id!,
    name: createRes.data.name!,
    webViewLink: createRes.data.webViewLink || undefined,
  };
}
