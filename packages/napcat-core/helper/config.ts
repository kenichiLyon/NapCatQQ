import { ConfigBase } from '@/napcat-core/helper/config-base';
import { NapCatCore } from '@/napcat-core/index';
import { Type, Static } from '@sinclair/typebox';
import { AnySchema } from 'ajv';

export const NapcatConfigSchema = Type.Object({
  fileLog: Type.Boolean({ default: false }),
  consoleLog: Type.Boolean({ default: true }),
  fileLogLevel: Type.String({ default: 'debug' }),
  consoleLogLevel: Type.String({ default: 'info' }),
  packetBackend: Type.String({ default: 'auto' }),
  packetServer: Type.String({ default: '' }),
  o3HookMode: Type.Number({ default: 0 }),
  db: Type.Object({
    enable: Type.Boolean({ default: true }),
    type: Type.String({ default: 'mysql' }),
    host: Type.String({ default: 'localhost' }),
    port: Type.Number({ default: 3306 }),
    username: Type.String({ default: 'root' }),
    password: Type.String({ default: '' }),
    database: Type.String({ default: 'napcat_msg' }),
    redisHost: Type.String({ default: 'localhost' }),
    redisPort: Type.Number({ default: 6379 }),
    redisPassword: Type.String({ default: '' }),
  }, { default: {} }),
});

export type NapcatConfig = Static<typeof NapcatConfigSchema>;

export class NapCatConfigLoader extends ConfigBase<NapcatConfig> {
  constructor (core: NapCatCore, configPath: string, schema: AnySchema) {
    super('napcat', core, configPath, schema);
  }
}
