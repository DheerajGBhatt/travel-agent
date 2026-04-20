import { Logger } from '@aws-lambda-powertools/logger';

export const logger = new Logger({
  serviceName: process.env.POWERTOOLS_SERVICE_NAME ?? 'travel-agency-agent',
  logLevel: (process.env.LOG_LEVEL as 'INFO' | 'DEBUG' | 'WARN' | 'ERROR') ?? 'INFO',
});
