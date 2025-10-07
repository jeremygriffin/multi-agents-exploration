import OpenAI, { type ClientOptions } from 'openai';

const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://useast.prompt.security/v1/';

const buildDefaultHeaders = (overrides?: ClientOptions['defaultHeaders']) => ({
  ...(overrides ?? {}),
});

export const buildOpenAIClientOptions = (overrides?: ClientOptions): ClientOptions => {
  const baseOptions: ClientOptions = {
    apiKey: process.env.OPENAI_API_KEY,
    ...overrides,
  };

  const useGateway = process.env.USE_PROMPT_SECURITY === 'true';

  if (useGateway) {
    const appId = process.env.PROMPT_SECURITY_APP_ID?.trim();
    if (!appId) {
      throw new Error('PROMPT_SECURITY_APP_ID must be set when USE_PROMPT_SECURITY is not "false".');
    }

    const baseURL = overrides?.baseURL ?? DEFAULT_BASE_URL;

    return {
      ...baseOptions,
      baseURL,
      defaultHeaders: buildDefaultHeaders({
        'ps-app-id': appId,
        ...(overrides?.defaultHeaders ?? {}),
      }),
    } satisfies ClientOptions;
  }

  return {
    ...baseOptions,
    ...(overrides?.baseURL ? {} : { baseURL: process.env.OPENAI_BASE_URL }),
    defaultHeaders: buildDefaultHeaders(overrides?.defaultHeaders),
  } satisfies ClientOptions;
};

export const createOpenAIClient = (overrides?: ClientOptions): OpenAI =>
  new OpenAI(buildOpenAIClientOptions(overrides));
