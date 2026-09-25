export type ServiceName =
  | 'AUTH_SERVICE'
  | 'SERVER_SERVICE'
  | 'CHAT_SERVICE'
  | 'PRESENCE_SERVICE'
  | 'NOTIFICATION_SERVICE'
  | 'CALL_SERVICE'
  | 'REMOTE_GATEWAY';

export function parseEnv(text: string): Record<string, string>;

export function serviceUrls(
  env?: Record<string, string | undefined>,
  file?: Record<string, string>,
): Record<ServiceName, string>;

export function reportServices(
  urls?: Record<ServiceName, string>,
  warn?: (message: string) => void,
): Promise<string[]>;
