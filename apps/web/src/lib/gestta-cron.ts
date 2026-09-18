import { syncGesttaToCrmAndDrive } from "./gestta-sync";
import { getOptionalSupabaseServerClient } from "./supabase-server";

export interface GesttaCronStatus {
  active: boolean;
  isRunning: boolean;
  intervalMinutes: number;
  lastRun?: string;
  nextRun?: string;
  lastLog?: {
    id?: string;
    startedAt?: string;
    finishedAt?: string;
    status?: "success" | "error" | "running";
    tasksChecked?: number;
    companiesCount?: number;
    errorMessage?: string;
  };
}

interface GlobalGesttaCronState {
  timer: NodeJS.Timeout | null;
  isRunning: boolean;
  active: boolean;
  lastRun?: string;
  nextRun?: string;
  lastLog?: GesttaCronStatus["lastLog"];
}

const INTERVAL_MINUTES = 10;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

// Utiliza globalThis para manter o estado único mesmo com hot-reload no Next.js
const globalState: GlobalGesttaCronState =
  (globalThis as any).__gestta_cron_state__ || {
    timer: null,
    isRunning: false,
    active: false,
    lastRun: undefined,
    nextRun: undefined,
    lastLog: undefined,
  };

(globalThis as any).__gestta_cron_state__ = globalState;

/**
 * Executa uma rodada de sincronização do Gestta -> CRM -> Google Drive
 */
export async function runGesttaSyncCycle(triggerReason = "cron_10m"): Promise<{
  success: boolean;
  tasksCount: number;
  companiesCount: number;
  error?: string;
}> {
  if (globalState.isRunning) {
    console.log(`[Gestta Cron] Ciclo já em andamento. Ignorando disparo (${triggerReason}).`);
    return {
      success: false,
      tasksCount: 0,
      companiesCount: 0,
      error: "Ciclo de sincronização já em andamento.",
    };
  }

  globalState.isRunning = true;
  const startedAt = new Date().toISOString();
  globalState.lastRun = startedAt;

  const supabase = getOptionalSupabaseServerClient();
  let logId: string | undefined;

  if (supabase) {
    try {
      const { data, error } = await (supabase as any)
        .from("gestta_sync_logs")
        .insert({
          started_at: startedAt,
          status: "running",
          metadata: { trigger: triggerReason },
        })
        .select("id")
        .single();

      if (!error && data) {
        logId = data.id;
      }
    } catch (e) {
      console.warn("[Gestta Cron] Erro ao registrar início do log:", e);
    }
  }

  globalState.lastLog = {
    id: logId,
    startedAt,
    status: "running",
  };

  try {
    console.log(`\n======================================================`);
    console.log(`[Gestta Cron] Iniciando verificação a cada 10 min (${triggerReason}) em ${startedAt}...`);
    console.log(`======================================================`);

    const result = await syncGesttaToCrmAndDrive({
      rootFolderName: "Mega Contabilidade - Gestta",
    });

    const finishedAt = new Date().toISOString();
    globalState.lastLog = {
      id: logId,
      startedAt,
      finishedAt,
      status: "success",
      tasksChecked: result.totalTasks,
      companiesCount: result.totalCompanies,
    };

    if (supabase && logId) {
      await (supabase as any)
        .from("gestta_sync_logs")
        .update({
          finished_at: finishedAt,
          tasks_checked: result.totalTasks,
          new_tasks_count: result.totalTasks,
          companies_count: result.totalCompanies,
          status: "success",
          metadata: {
            trigger: triggerReason,
            reportId: result.reportId,
            driveRootFolderId: result.driveRootFolderId,
          },
        })
        .eq("id", logId);
    }

    console.log(`[Gestta Cron] Sucesso! ${result.totalTasks} tarefas sincronizadas de ${result.totalCompanies} empresas.`);
    return {
      success: true,
      tasksCount: result.totalTasks,
      companiesCount: result.totalCompanies,
    };
  } catch (err: any) {
    const finishedAt = new Date().toISOString();
    const errMsg = err?.message || String(err);
    console.error(`[Gestta Cron] Falha na sincronização:`, errMsg);

    globalState.lastLog = {
      id: logId,
      startedAt,
      finishedAt,
      status: "error",
      errorMessage: errMsg,
    };

    if (supabase && logId) {
      try {
        await (supabase as any)
          .from("gestta_sync_logs")
          .update({
            finished_at: finishedAt,
            status: "error",
            error_message: errMsg,
          })
          .eq("id", logId);
      } catch (e) {
        console.warn("[Gestta Cron] Erro ao atualizar status de erro no log:", e);
      }
    }

    return {
      success: false,
      tasksCount: 0,
      companiesCount: 0,
      error: errMsg,
    };
  } finally {
    globalState.isRunning = false;
    globalState.nextRun = new Date(Date.now() + INTERVAL_MS).toISOString();
  }
}

/**
 * Inicia o cron job de 10 minutos se ainda não estiver ativo
 */
export function startGesttaCron(): GesttaCronStatus {
  if (!globalState.active) {
    globalState.active = true;
    globalState.nextRun = new Date(Date.now() + INTERVAL_MS).toISOString();

    if (globalState.timer) {
      clearInterval(globalState.timer);
    }

    globalState.timer = setInterval(() => {
      runGesttaSyncCycle("scheduled_interval_10m").catch((err) => {
        console.error("[Gestta Cron] Erro não tratado no intervalo:", err);
      });
    }, INTERVAL_MS);

    console.log(`[Gestta Cron] Serviço agendado iniciado. Rodará a cada ${INTERVAL_MINUTES} minutos.`);
  }

  return getGesttaCronStatus();
}

/**
 * Para o cron job de 10 minutos
 */
export function stopGesttaCron(): GesttaCronStatus {
  if (globalState.timer) {
    clearInterval(globalState.timer);
    globalState.timer = null;
  }
  globalState.active = false;
  globalState.nextRun = undefined;
  console.log("[Gestta Cron] Serviço agendado pausado.");
  return getGesttaCronStatus();
}

/**
 * Dispara uma execução imediata (manual via UI)
 */
export async function triggerGesttaCronNow(): Promise<{
  status: GesttaCronStatus;
  result: { success: boolean; tasksCount: number; companiesCount: number; error?: string };
}> {
  // Garante que o cron está ativo para os próximos ciclos
  startGesttaCron();

  const result = await runGesttaSyncCycle("manual_trigger");
  return {
    status: getGesttaCronStatus(),
    result,
  };
}

/**
 * Retorna o status atual do serviço
 */
export function getGesttaCronStatus(): GesttaCronStatus {
  return {
    active: globalState.active,
    isRunning: globalState.isRunning,
    intervalMinutes: INTERVAL_MINUTES,
    lastRun: globalState.lastRun,
    nextRun: globalState.nextRun,
    lastLog: globalState.lastLog,
  };
}
