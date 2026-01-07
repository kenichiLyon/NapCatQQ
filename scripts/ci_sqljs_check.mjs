import { MsgStorageService } from 'napcat-storage';
import fs from 'node:fs/promises';
import path from 'node:path';

const workdir = process.env.NAPCAT_WORKDIR || path.join(process.cwd(), 'workdir');
await fs.mkdir(workdir, { recursive: true });
process.env.NAPCAT_WORKDIR = workdir;

const svc = new MsgStorageService();
await svc.init({
  enable: true,
  type: 'sqljs',
  host: '',
  port: 0,
  username: '',
  password: '',
  database: '',
  redisHost: '',
  redisPort: 0,
  redisPassword: ''
});

await svc.saveMsg({
  msgId: 'ci-init',
  msgSeq: '1',
  msgRandom: '1',
  msgTime: `${Date.now()}`,
  senderUid: 'ci',
  senderUin: '0',
  peerUid: 'ci-peer',
  peerUin: '0',
  chatType: 1,
  elements: [{ textElement: { content: 'ci check' } }]
});

console.log('SQL.js init OK');
