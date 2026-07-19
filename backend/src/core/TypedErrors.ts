export type ErrorCategory =
  | 'validation'
  | 'provider'
  | 'media'
  | 'pipeline'
  | 'configuration'
  | 'plugin'
  | 'rendering'
  | 'system';

export class OpenClipError extends Error {
  constructor(
    public message: string,
    public category: ErrorCategory,
    public recoverySuggestion?: string,
    public rawError?: any
  ) {
    super(message);
    this.name = 'OpenClipError';
  }
}
