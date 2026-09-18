import { getOptionalSupabaseServerClient } from "./supabase-server";

export interface GesttaCompany {
  _id: string;
  name: string;
  cnpj: string;
  status?: string;
}

export interface GesttaProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  company: GesttaCompany;
}

export interface GesttaCustomer {
  id: string;
  name: string;
  cnpj?: string;
  code?: string;
  active?: boolean;
}

export interface GesttaIntegrationStatus {
  connected: boolean;
  email?: string;
  userName?: string;
  companyName?: string;
  companyCnpj?: string;
  totalCustomers?: number;
  lastTestedAt?: string | null;
}

// Fallback em memória caso Supabase não esteja disponível
let memoryGestta: {
  token: string | null;
  profile: GesttaProfile | null;
  totalCustomers: number;
  lastTestedAt: string | null;
  active: boolean;
} = {
  token: null,
  profile: null,
  totalCustomers: 0,
  lastTestedAt: null,
  active: true,
};

const BASE_URL = process.env.GESTTA_API_URL || "https://api.gestta.com.br/core";

export function getDefaultGesttaCredentials() {
  return {
    email: process.env.GESTTA_EMAIL || "financeiro@megacontabilidade.com",
    password: process.env.GESTTA_PASSWORD || "Mega@313",
  };
}

/**
 * Autentica no Gestta usando e-mail e senha
 */
export async function authenticateGestta(
  customEmail?: string,
  customPassword?: string,
): Promise<{ token: string; profile: GesttaProfile }> {
  const defaults = getDefaultGesttaCredentials();
  const email = (customEmail || defaults.email).trim();
  const password = (customPassword || defaults.password).trim();

  const response = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      Origin: "https://app.gestta.com.br",
      Referer: "https://app.gestta.com.br/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Falha na autenticação do Gestta (${response.status}): ${errorText || response.statusText}`,
    );
  }

  const token = response.headers.get("authorization");
  if (!token) {
    throw new Error("Token de autorização não recebido no cabeçalho do Gestta.");
  }

  // Busca os dados do usuário autenticado no Gestta
  const profile = await getGesttaProfile(token);

  // Busca total de clientes para compor o status
  let totalCustomers = 0;
  try {
    const custRes = await fetch(`${BASE_URL}/customer?limit=1`, {
      headers: {
        Authorization: token,
        Origin: "https://app.gestta.com.br",
        Referer: "https://app.gestta.com.br/",
      },
    });
    if (custRes.ok) {
      const custData = await custRes.json();
      totalCustomers = custData.total || (Array.isArray(custData) ? custData.length : 0);
    }
  } catch {
    // silencioso
  }

  const now = new Date().toISOString();

  // Persiste no Supabase se disponível
  const supabase = getOptionalSupabaseServerClient();
  if (supabase) {
    await (supabase as any).from("gestta_integrations").upsert(
      {
        user_id: "default_user",
        email: profile.email,
        user_name: profile.name,
        company_name: profile.company?.name || "MEGA CONTABILIDADE",
        company_cnpj: profile.company?.cnpj || "81543407000167",
        auth_token: token,
        active: true,
        total_customers: totalCustomers,
        last_tested_at: now,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );
  }

  // Atualiza cache em memória
  memoryGestta = {
    token,
    profile,
    totalCustomers,
    lastTestedAt: now,
    active: true,
  };

  return { token, profile };
}

/**
 * Consulta o perfil do usuário e da empresa no Gestta
 */
export async function getGesttaProfile(token: string): Promise<GesttaProfile> {
  const res = await fetch(`${BASE_URL}/company/user/me`, {
    headers: {
      Authorization: token,
      Origin: "https://app.gestta.com.br",
      Referer: "https://app.gestta.com.br/",
    },
  });

  if (!res.ok) {
    throw new Error("Não foi possível recuperar dados de perfil do Gestta.");
  }

  const data = await res.json();
  return {
    id: data._id,
    name: data.name,
    email: data.email,
    role: data.role,
    company: {
      _id: data.company?._id,
      name: data.company?.name || "MEGA CONTABILIDADE",
      cnpj: data.company?.cnpj || "81543407000167",
      status: data.company?.status,
    },
  };
}

/**
 * Obtém um token válido do Gestta (reaproveita do banco/memória ou autentica se necessário)
 */
export async function getValidGesttaToken(): Promise<string> {
  // Verifica se há token salvo no Supabase
  const supabase = getOptionalSupabaseServerClient();
  if (supabase) {
    const { data } = await (supabase as any).from("gestta_integrations")
      .select("auth_token, active")
      .eq("user_id", "default_user")
      .single();

    if (data && data.active && data.auth_token) {
      return data.auth_token;
    }
  }

  if (memoryGestta.active && memoryGestta.token) {
    return memoryGestta.token;
  }

  // Se não houver token válido, realiza autenticação automática com credenciais padrão
  const { token } = await authenticateGestta();
  return token;
}

/**
 * Retorna o status atual da integração com o Gestta
 */
export async function getGesttaIntegrationStatus(): Promise<GesttaIntegrationStatus> {
  try {
    const supabase = getOptionalSupabaseServerClient();
    if (supabase) {
      const { data } = await (supabase as any).from("gestta_integrations")
        .select("*")
        .eq("user_id", "default_user")
        .single();

      if (data && data.active) {
        return {
          connected: true,
          email: data.email,
          userName: data.user_name,
          companyName: data.company_name,
          companyCnpj: data.company_cnpj,
          totalCustomers: data.total_customers,
          lastTestedAt: data.last_tested_at,
        };
      }
    }

    if (memoryGestta.active && memoryGestta.profile) {
      return {
        connected: true,
        email: memoryGestta.profile.email,
        userName: memoryGestta.profile.name,
        companyName: memoryGestta.profile.company.name,
        companyCnpj: memoryGestta.profile.company.cnpj,
        totalCustomers: memoryGestta.totalCustomers,
        lastTestedAt: memoryGestta.lastTestedAt,
      };
    }

    // Se ainda não conectado, tenta autenticar automaticamente com as credenciais padrão
    const { profile } = await authenticateGestta();
    return {
      connected: true,
      email: profile.email,
      userName: profile.name,
      companyName: profile.company.name,
      companyCnpj: profile.company.cnpj,
      totalCustomers: memoryGestta.totalCustomers,
      lastTestedAt: memoryGestta.lastTestedAt,
    };
  } catch (err) {
    console.warn("Gestta não conectado automaticamente:", err);
    return { connected: false };
  }
}

/**
 * Busca clientes do Gestta com paginação e busca textual
 */
export async function getGesttaCustomers(options?: {
  page?: number;
  limit?: number;
  search?: string;
}): Promise<{
  customers: GesttaCustomer[];
  total: number;
  page: number;
  pages: number;
}> {
  let token: string;
  try {
    token = await getValidGesttaToken();
  } catch {
    const auth = await authenticateGestta();
    token = auth.token;
  }

  const page = options?.page || 1;
  const limit = options?.limit || 20;
  const searchParam = options?.search
    ? `&name=${encodeURIComponent(options.search)}`
    : "";

  const url = `${BASE_URL}/customer?page=${page}&limit=${limit}${searchParam}`;

  const res = await fetch(url, {
    headers: {
      Authorization: token,
      Origin: "https://app.gestta.com.br",
      Referer: "https://app.gestta.com.br/",
    },
  });

  if (!res.ok) {
    // Se o token expirou, tenta reautenticar uma vez
    if (res.status === 401) {
      const auth = await authenticateGestta();
      const retryRes = await fetch(url, {
        headers: {
          Authorization: auth.token,
          Origin: "https://app.gestta.com.br",
          Referer: "https://app.gestta.com.br/",
        },
      });
      if (retryRes.ok) {
        const data = await retryRes.json();
        return parseCustomerResponse(data, page, limit);
      }
    }
    throw new Error(`Erro ao buscar clientes no Gestta (${res.status})`);
  }

  const data = await res.json();
  return parseCustomerResponse(data, page, limit);
}

function parseCustomerResponse(
  data: any,
  page: number,
  limit: number,
): {
  customers: GesttaCustomer[];
  total: number;
  page: number;
  pages: number;
} {
  const docs = Array.isArray(data) ? data : data.docs || [];
  const total = data.total || docs.length;
  const pages = data.pages || Math.ceil(total / limit) || 1;

  const customers: GesttaCustomer[] = docs.map((doc: any) => ({
    id: doc._id || doc.id,
    name: doc.name,
    cnpj: doc.cnpj,
    code: doc.code,
    active: doc.active !== false,
  }));

  return { customers, total, page, pages };
}

export interface GesttaTask {
  id: string;
  name: string;
  companyName: string;
  companyId?: string;
  companyCode?: string;
  companyCnpj?: string;
  competence: string; // Ex: '2026-08'
  competenceDate?: string;
  dueDate?: string;
  legalDate?: string;
  status: string;
  overdue: boolean;
  department?: string;
  type?: string;
  subtype?: string;
  raw?: any;
}

export interface GesttaReportItem {
  id: string;
  name: string;
  type: string;
}

/**
 * Busca tarefas cadastradas no Gestta
 */
export async function getGesttaTasks(options?: {
  startDate?: string;
  endDate?: string;
  dateType?: "DUE_DATE" | "LEGAL_DATE" | "COMPETENCE_DATE";
  status?: string;
  limit?: number;
  customerId?: string;
}): Promise<{ tasks: GesttaTask[]; total: number }> {
  let token: string;
  try {
    token = await getValidGesttaToken();
  } catch {
    const auth = await authenticateGestta();
    token = auth.token;
  }

  const payload: any = {
    date_type: options?.dateType || "DUE_DATE",
    no_owner: true,
    limit: options?.limit || 50,
  };

  if (options?.startDate) payload.start_date = options.startDate;
  if (options?.endDate) payload.end_date = options.endDate;
  if (options?.status) payload.status = options.status;
  if (options?.customerId) payload.customer = options.customerId;

  const url = `${BASE_URL}/customer/task/search`;
  let res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      Origin: "https://app.gestta.com.br",
      Referer: "https://app.gestta.com.br/",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok && res.status === 401) {
    const auth = await authenticateGestta();
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: auth.token,
        "Content-Type": "application/json",
        Origin: "https://app.gestta.com.br",
        Referer: "https://app.gestta.com.br/",
      },
      body: JSON.stringify(payload),
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erro ao buscar tarefas no Gestta (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const docs = data.docs || (Array.isArray(data) ? data : []);

  const tasks: GesttaTask[] = docs.map((d: any) => {
    // Formatar competência
    let comp = "Sem Competência";
    const compDateStr = d.competence_date || d.competence || d.date || d.due_date;
    if (compDateStr && typeof compDateStr === "string") {
      comp = compDateStr.slice(0, 7); // '2026-08'
    }

    return {
      id: d._id || d.id,
      name: d.name || "Tarefa Sem Nome",
      companyName: d.customer?.name || "Empresa Não Identificada",
      companyId: d.customer?._id || d.customer?.id,
      companyCode: d.customer?.code,
      companyCnpj: d.customer?.cnpj,
      competence: comp,
      competenceDate: d.competence_date,
      dueDate: d.due_date,
      legalDate: d.legal_date,
      status: d.status || "OPEN",
      overdue: Boolean(d.overdue),
      department: d.company_department?.name || d.department?.name,
      type: d.type,
      subtype: d.subtype,
      raw: d,
    };
  });

  return { tasks, total: data.total || tasks.length };
}

/**
 * Consulta detalhes completos de uma tarefa do Gestta
 */
export async function getGesttaTaskDetail(taskId: string): Promise<any> {
  const token = await getValidGesttaToken();
  const res = await fetch(`${BASE_URL}/customer/task/${taskId}`, {
    headers: {
      Authorization: token,
      Origin: "https://app.gestta.com.br",
      Referer: "https://app.gestta.com.br/",
    },
  });

  if (!res.ok) {
    throw new Error(`Erro ao obter detalhes da tarefa ${taskId}: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Lista relatórios do Gestta
 */
export async function getGesttaReports(): Promise<GesttaReportItem[]> {
  const token = await getValidGesttaToken();
  const res = await fetch(`${BASE_URL}/report`, {
    headers: {
      Authorization: token,
      Origin: "https://app.gestta.com.br",
      Referer: "https://app.gestta.com.br/",
    },
  });

  if (!res.ok) {
    throw new Error(`Erro ao listar relatórios do Gestta (${res.status})`);
  }

  const list = await res.json();
  return (list || []).map((r: any) => ({
    id: r._id || r.id,
    name: r.name,
    type: r.type,
  }));
}

/**
 * Desconecta a integração do Gestta
 */
export async function disconnectGestta(): Promise<void> {
  const supabase = getOptionalSupabaseServerClient();
  if (supabase) {
    await (supabase as any).from("gestta_integrations")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("user_id", "default_user");
  }
  memoryGestta.active = false;
  memoryGestta.token = null;
}

