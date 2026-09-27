import { createAdminApp, cloudflareAccessVerifier } from './admin/app';
import { depsFromEnv, type Env } from './index';

interface AdminEnv extends Env {
  ACCESS_TEAM_DOMAIN: string; // e.g. implemon.cloudflareaccess.com
  ACCESS_AUD: string;
  ADMIN_EMAILS: string; // comma-separated allowlist
}

let cached: { env: AdminEnv; app: ReturnType<typeof createAdminApp> } | undefined;

export default {
  fetch(request: Request, env: AdminEnv, ctx: ExecutionContext) {
    if (!cached || cached.env !== env) {
      cached = {
        env,
        app: createAdminApp(depsFromEnv(env), cloudflareAccessVerifier({ teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, adminEmails: env.ADMIN_EMAILS.split(',') })),
      };
    }
    return cached.app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AdminEnv>;
