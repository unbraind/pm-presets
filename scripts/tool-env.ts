/** Shared credential policy for disposable Git/npm tool environments. */
const SENSITIVE = /TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|PRIVATE_KEY|NPM_MEDIA_SERVER/i;

/** Copy an environment without credentials, npm config routing or caller exclusions. */
export function stripToolEnv(source: NodeJS.ProcessEnv, extra: (key: string) => boolean = () => false): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (SENSITIVE.test(key) || key.toLowerCase() === "npm_config_userconfig" || extra(key)) delete env[key];
  }
  return env;
}
