export const COOKIE_NAME = "mega_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 dias

export interface SessionUser {
  email: string;
  name: string;
  role?: string;
}

interface TokenPayload extends SessionUser {
  exp: number;
}

function getSecret(): string {
  return process.env.AUTH_SECRET || "mega_crm_secure_session_secret_key_2026";
}

export function getDefaultPassword(): string {
  return process.env.AUTH_PASSWORD || "mega2026";
}

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Assina um token usando Web Crypto HMAC-SHA256 (compatível com Node.js e Edge Runtime)
 */
export async function createSessionToken(user: SessionUser): Promise<string> {
  const secret = getSecret();
  const key = await getCryptoKey(secret);

  const payload: TokenPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${header}.${body}`);

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, data);
  const signature = bufferToBase64Url(signatureBuffer);

  return `${header}.${body}.${signature}`;
}

/**
 * Valida o token de sessão usando Web Crypto
 */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const secret = getSecret();
    const key = await getCryptoKey(secret);

    const data = new TextEncoder().encode(`${header}.${body}`);

    // Decodifica a assinatura esperada
    let base64 = signature.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    const binary = atob(base64);
    const signatureBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      signatureBytes[i] = binary.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      data,
    );

    if (!isValid) return null;

    const payload: TokenPayload = JSON.parse(base64UrlDecode(body));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expirado
    }

    return {
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Valida se a senha informada confere com a senha da plataforma
 */
export function checkPassword(password: string): boolean {
  const expectedPassword = getDefaultPassword();
  return Boolean(password && password === expectedPassword);
}
