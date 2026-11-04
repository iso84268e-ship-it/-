export interface UserProfile {
  id: number;
  email: string;
  displayName: string;
  role: 'owner' | 'admin';
  isPrimaryOwner: boolean;
}

export type MasterBotRuntimeStatus =
  | 'waiting_for_credentials'
  | 'connecting'
  | 'connected'
  | 'stopped'
  | 'error';

export interface DashboardOverview {
  user: UserProfile;
  plan: {
    name: string;
    isFreeForever: boolean;
    priceLabel: string;
  };
  masterBot: {
    botName: string;
    hasToken: boolean;
    hasOwnerId: boolean;
    maskedToken: string;
    maskedOwnerId: string;
    botUsername: string | null;
    botTelegramId: string | null;
    runtimeStatus: MasterBotRuntimeStatus;
    lastError: string | null;
    lastPollAt: string | null;
    processedCommandsCount: number;
  };
  hosting: {
    runningCount: number;
    totalCount: number;
    uptimeSeconds: number;
  };
}

export interface MasterBotConfigData {
  botName: string;
  hasToken: boolean;
  hasOwnerId: boolean;
  botToken: string;
  maskedToken: string;
  ownerId: string;
  extraAdminIds: string[];
  welcomeMessage: string;
  autoStartMaster: boolean;
  autoRestartChildren: boolean;
  notifyUnauthorized: boolean;
  botUsername: string | null;
  botTelegramId: string | null;
  runtimeStatus: MasterBotRuntimeStatus;
  lastError: string | null;
  updatedAt: string;
}

export interface HostedBotSummary {
  id: string;
  name: string;
  description: string;
  runtime: 'nodejs' | 'python';
  entryFile: string;
  code: string;
  status: 'running' | 'stopped' | 'error';
  autoRestart: boolean;
  pid: number | null;
  restartsCount: number;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
  envKeysCount: number;
  recentLogsCount: number;
}

export interface HostedBotDetail {
  id: string;
  name: string;
  description: string;
  runtime: 'nodejs' | 'python';
  entryFile: string;
  code: string;
  envVars: Record<string, string>;
  status: 'running' | 'stopped' | 'error';
  autoRestart: boolean;
  pid: number | null;
  restartsCount: number;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizedAccount {
  id: number;
  maskedEmail: string;
  revealedEmail?: string;
  displayName: string;
  role: 'owner' | 'admin';
  isPrimaryOwner: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AccessLog {
  id: number;
  eventType: string;
  actorMasked: string;
  detail: string;
  createdAt: string;
}

export interface BotSourceFile {
  filename: string;
  language: string;
  description: string;
  code: string;
}

export interface DecoyPaywallData {
  email: string;
  invoiceRef: string;
  monthlyPriceUsd: number;
  yearlyPriceUsd: number;
  message: string;
}
