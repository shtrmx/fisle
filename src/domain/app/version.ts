declare const __APP_VERSION__: string | undefined;

/**
 * Semantic application version injected from package.json at build time.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0
    ? __APP_VERSION__
    : '1.0.0';
