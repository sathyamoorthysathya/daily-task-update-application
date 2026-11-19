/**
 * Administrator accounts from the command line (after `npm run build`):
 *
 *   npm run admin -- create <username> [--name "Display name"]
 *   npm run admin -- reset <username>     new password, unlock, two-step verification off,
 *                                         every session ended (account recovery)
 *   npm run admin -- list
 *
 * In a container: `docker compose exec api node dist/cli/admin.js create <username>`.
 * The password is typed without being shown. For automation (no terminal), set
 * ADMIN_CLI_PASSWORD in the environment instead.
 */
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MonitoringModule } from '../common/monitoring/monitoring.module.js';
import { envSchema } from '../config/env.schema.js';
import { DatabaseModule } from '../database/database.module.js';
import { adminPasswordProblem, adminUsernameSchema } from '../modules/admin/admin-policy.js';
import { AdminAuthService } from '../modules/admin/auth/admin-auth.service.js';
import { PasswordService } from '../modules/auth/password/password.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validationSchema: envSchema }),
    DatabaseModule,
    MonitoringModule,
  ],
  providers: [PasswordService, AdminAuthService],
})
class AdminCliModule {}

const USAGE = `Usage:
  npm run admin -- create <username> [--name "Display name"]
  npm run admin -- reset <username>
  npm run admin -- list`;

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  const fromEnv = process.env.ADMIN_CLI_PASSWORD;
  if (fromEnv) {
    return Promise.resolve(fromEnv);
  }
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    return Promise.reject(new Error('No terminal: set ADMIN_CLI_PASSWORD to pass the password.'));
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u0003') {
          finish(new Error('Cancelled'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdout.write(question);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function askNewPassword(username: string): Promise<string> {
  const password = await promptHidden('New password: ');
  const problem = adminPasswordProblem(password, username);
  if (problem) {
    throw new Error(problem);
  }
  if (!process.env.ADMIN_CLI_PASSWORD && (await promptHidden('Repeat it: ')) !== password) {
    throw new Error('The passwords do not match.');
  }
  return password;
}

function parseUsername(value: string | undefined): string {
  const parsed = adminUsernameSchema.safeParse(value ?? '');
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid username');
  }
  return parsed.data;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !['create', 'reset', 'list'].includes(command)) {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
    return;
  }

  const app = await NestFactory.createApplicationContext(AdminCliModule, {
    logger: ['error', 'warn'],
  });
  try {
    const admins = app.get(AdminAuthService);
    if (command === 'list') {
      const list = await admins.listAdmins();
      if (list.length === 0) {
        console.log('No administrators yet. Create one with: npm run admin -- create <username>');
      }
      for (const admin of list) {
        console.log(
          `${admin.username.padEnd(32)} ${admin.twoFactorEnabled ? '2-step on ' : '2-step off'}  ${admin.locked ? 'LOCKED  ' : '        '}last sign-in: ${admin.lastLoginAt ?? 'never'}`,
        );
      }
      return;
    }

    const username = parseUsername(args[0]);
    if (command === 'create') {
      const nameIndex = args.indexOf('--name');
      const displayName = nameIndex >= 0 ? (args[nameIndex + 1] ?? username) : username;
      const password = await askNewPassword(username);
      await admins.createAdmin(username, displayName, password, 'cli');
      console.log(`Administrator "${username}" created. Sign in at /admin/login.`);
    } else {
      const password = await askNewPassword(username);
      await admins.resetAdmin(username, password);
      console.log(
        `Administrator "${username}": new password set, unlocked, two-step verification turned off, all sessions ended.`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && 'code' in error && error.code === 'P2002'
      ? 'That username is already taken.'
      : error instanceof Error
        ? error.message
        : String(error);
  new Logger('admin').error(message);
  process.exitCode = 1;
});
