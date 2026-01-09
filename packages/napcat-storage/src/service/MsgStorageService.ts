import { DataSource, Repository, Between, Like } from 'typeorm';
import { MsgData, MsgDataLight, MsgDataFull, MsgBlob, UserInfo, GroupInfo, DbVersion } from '../entities';
import Redis from 'ioredis';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LRUCache } from 'napcat-common/src/lru-cache';
import { compressToBuffer, safeDecompress } from '../utils/compress';

export interface DbConfig {
  enable: boolean;
  type: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  redisHost: string;
  redisPort: number;
  redisPassword: string;
  enableWal?: boolean;
}

export interface MsgQueryParams {
  startTime?: number;
  endTime?: number;
  senderId?: string;
  groupId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export class MsgStorageService {
  private dataSource!: DataSource;
  private redis!: Redis;
  private msgRepo!: Repository<MsgData>;
  private blobRepo!: Repository<MsgBlob>;
  private userRepo!: Repository<UserInfo>;
  private groupRepo!: Repository<GroupInfo>;
  private isEnabled: boolean = false;
  private memoryStore: any[] = [];
  /** 轻量缓存，不含 raw_elements 以节省内存 */
  private cache!: LRUCache<string, MsgDataLight>;
  private slowThresholdMs = 200;
  private fallbackFilePath: string | null = null;

  constructor () {
    // Init hot cache with 5000 capacity and 1 hour TTL
    this.cache = new LRUCache<string, MsgDataLight>(5000, 3600 * 1000);
  }

  async init (config: DbConfig) {
    this.fallbackFilePath = this.resolveFallbackPath();
    if (!config.enable) {
      console.log('[MsgStorage] Disabled in config');
      await this.ensureFallbackFile();
      return;
    }

    try {
      const type = config.type as any;
      if (type === 'sqljs') {
        if (!this.canUseSqljs()) {
          console.warn('[MsgStorage] SQL.js runtime asset not available, fallback to file storage');
          await this.ensureFallbackFile();
          this.isEnabled = false;
          return;
        }
        const dbFile = this.resolveSqlJsDbFile();
        let database: Uint8Array | undefined;
        try {
          const buf = await fs.readFile(dbFile);
          database = new Uint8Array(buf);
        } catch {}
        this.dataSource = new DataSource({
          type: 'sqljs',
          entities: [MsgData, MsgBlob, UserInfo, GroupInfo, DbVersion],
          synchronize: true,
          logging: false,
          location: 'napcat_sqljs',
          autoSave: true,
          autoSaveCallback: async (db: Uint8Array) => {
            await fs.mkdir(path.dirname(dbFile), { recursive: true });
            await fs.writeFile(dbFile, Buffer.from(db));
          },
          database,
          sqlJsConfig: {
            locateFile: (file: string) => {
              const envPath = process.env['NAPCAT_SQLJS_WASM_PATH'];
              if (envPath && file.endsWith('.wasm')) return envPath;
              const staticPath = path.join(process.cwd(), 'static', file);
              try { require('fs').accessSync(staticPath); return staticPath; } catch {}
              return path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file);
            },
          },
        } as any);
      } else if (type === 'better-sqlite3' || type === 'sqlite') {
        const dbPath = this.resolveSqliteDbFile();
        await fs.mkdir(path.dirname(dbPath), { recursive: true });
        this.dataSource = new DataSource({
          type: 'better-sqlite3',
          database: dbPath,
          entities: [MsgData, MsgBlob, UserInfo, GroupInfo, DbVersion],
          synchronize: true,
          logging: false,
          enableWAL: config.enableWal !== false, // Default to true
        });
      } else {
        this.dataSource = new DataSource({
          type,
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          database: config.database,
          entities: [MsgData, MsgBlob, UserInfo, GroupInfo, DbVersion],
          synchronize: true, // Auto schema sync for now
          logging: false,
          poolSize: 10, // Equivalent to HikariCP pooling
          extra: {
            connectionLimit: 10, // For mysql2
          },
        });
      }

      await this.dataSource.initialize();
      console.log(`[MsgStorage] Database connected (${config.type})`);

      this.msgRepo = this.dataSource.getRepository(MsgData);
      this.blobRepo = this.dataSource.getRepository(MsgBlob);
      this.userRepo = this.dataSource.getRepository(UserInfo);
      this.groupRepo = this.dataSource.getRepository(GroupInfo);

      await this.ensureIndexes(config.type);
      await this.ensureSqliteFts(config.type);

      this.redis = new Redis({
        host: config.redisHost,
        port: config.redisPort,
        password: config.redisPassword,
        lazyConnect: true,
      });
      await this.redis.connect();
      console.log('[MsgStorage] Redis connected');

      this.isEnabled = true;
    } catch (error) {
      console.error('[MsgStorage] Init failed', error);
      await this.ensureFallbackFile();
    }
  }

  private resolveFallbackPath (): string {
    const base = process.env['NAPCAT_WORKDIR'] || process.cwd();
    const dir = path.join(base, 'storage');
    return path.join(dir, 'msg_fallback.jsonl');
  }

  private resolveSqliteDbFile (): string {
    const override = process.env['NAPCAT_DB_PATH'];
    if (override) return override;
    const base = process.env['NAPCAT_WORKDIR'] || process.cwd();
    const dir = path.join(base, 'config', 'db');
    return path.join(dir, 'napcat.db');
  }

  private async ensureFallbackFile () {
    if (!this.fallbackFilePath) return;
    const dir = path.dirname(this.fallbackFilePath);
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.access(this.fallbackFilePath);
    } catch {
      await fs.writeFile(this.fallbackFilePath, '');
    }
  }

  private async appendFallback (msg: any) {
    if (!this.fallbackFilePath) return;
    const line = JSON.stringify(msg) + '\n';
    try {
      await fs.appendFile(this.fallbackFilePath, line, 'utf-8');
    } catch {}
  }

  private async ensureIndexes (dbType: string) {
    try {
      if (dbType === 'mysql') {
        await this.dataSource.query('ALTER TABLE msg_data ADD INDEX idx_msg_time (msg_time)');
        await this.dataSource.query('ALTER TABLE msg_data ADD FULLTEXT INDEX ft_content (content)');
      } else if (dbType === 'postgres' || dbType === 'postgresql') {
        await this.dataSource.query('CREATE INDEX IF NOT EXISTS idx_msg_time ON msg_data (msg_time)');
        await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        await this.dataSource.query("CREATE INDEX IF NOT EXISTS idx_content_fts ON msg_data USING GIN (to_tsvector('simple', content))");
      } else if (dbType === 'sqljs' || dbType === 'better-sqlite3' || dbType === 'sqlite') {
        await this.dataSource.query('CREATE INDEX IF NOT EXISTS idx_msg_time ON msg_data (msg_time)');
      }
    } catch {}
  }

  /**
   * 确保 SQLite/SQL.js 的 FTS5 虚拟表与触发器就绪
   * 使用外部内容表模式，MsgData.id 作为 content_rowid
   */
  private async ensureSqliteFts (dbType: string) {
    if (dbType !== 'sqljs' && dbType !== 'better-sqlite3' && dbType !== 'sqlite') return;

    try {
      // 创建 FTS5 外部内容虚拟表
      await this.dataSource.query(`
        CREATE VIRTUAL TABLE IF NOT EXISTS msg_data_fts USING fts5(
          content,
          content='msg_data',
          content_rowid='id',
          tokenize='unicode61'
        );
      `);

      // 创建插入触发器
      await this.dataSource.query(`
        CREATE TRIGGER IF NOT EXISTS msg_data_ai AFTER INSERT ON msg_data BEGIN
          INSERT INTO msg_data_fts(rowid, content) VALUES (new.id, new.content);
        END;
      `);

      // 创建更新触发器
      await this.dataSource.query(`
        CREATE TRIGGER IF NOT EXISTS msg_data_au AFTER UPDATE ON msg_data BEGIN
          INSERT INTO msg_data_fts(msg_data_fts, rowid, content) VALUES('delete', old.id, old.content);
          INSERT INTO msg_data_fts(rowid, content) VALUES (new.id, new.content);
        END;
      `);

      // 创建删除触发器
      await this.dataSource.query(`
        CREATE TRIGGER IF NOT EXISTS msg_data_ad AFTER DELETE ON msg_data BEGIN
          INSERT INTO msg_data_fts(msg_data_fts, rowid, content) VALUES('delete', old.id, old.content);
        END;
      `);

      console.log('[MsgStorage] FTS5 virtual table initialized');
    } catch (err) {
      console.warn('[MsgStorage] FTS5 init failed, falling back to LIKE search:', err);
    }
  }

  async saveMsg (msg: any) {
    if (!this.isEnabled) {
      this.saveToMemory(msg);
      await this.appendFallback(msg);
      return;
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    let committed = false;
    try {
      const content = this.extractContent(msg.elements);

      // 构建轻量消息实体
      const msgData = new MsgData();
      msgData.msg_id = msg.msgId;
      msgData.msg_seq = msg.msgSeq;
      msgData.msg_random = msg.msgRandom;
      msgData.msg_time = msg.msgTime;
      msgData.sender_id = msg.senderUid;
      msgData.sender_uin = msg.senderUin;
      msgData.peer_id = msg.peerUid;
      msgData.peer_uin = msg.peerUin;
      msgData.chat_type = msg.chatType;
      msgData.content = content;

      // 构建压缩的原始数据实体
      const blob = new MsgBlob();
      blob.msg_id = msg.msgId;
      blob.raw_elements = compressToBuffer(msg.elements);

      // 事务保存：先 MsgData，再 MsgBlob（确保外键约束）
      await runner.manager.save(MsgData, msgData);
      await runner.manager.save(MsgBlob, blob);
      await runner.commitTransaction();
      committed = true;

      // 缓存轻量对象（包含 id 和 created_at）
      const light: MsgDataLight = {
        id: msgData.id,
        msg_id: msgData.msg_id,
        msg_seq: msgData.msg_seq,
        msg_random: msgData.msg_random,
        msg_time: msgData.msg_time,
        sender_id: msgData.sender_id,
        sender_uin: msgData.sender_uin,
        peer_id: msgData.peer_id,
        peer_uin: msgData.peer_uin,
        chat_type: msgData.chat_type,
        content: msgData.content,
        created_at: msgData.created_at,
      };
      this.cache.put(msgData.msg_id, light);

      // Redis 缓存（可选，仅存轻量数据）
      if (this.redis.status === 'ready') {
        await this.redis.setex(`msg:${msg.msgId}`, 3600, JSON.stringify(light));
      }

      // 异步更新用户/群组信息
      this.updateUserInfo(msg);
      if (msg.chatType === 2) {
        this.updateGroupInfo(msg);
      }
    } catch (e) {
      // 仅在未提交时回滚，避免已提交后的缓存/Redis 错误导致误判
      if (!committed && runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      if (!committed) {
        console.error('[MsgStorage] Save msg failed, fallback to memory', e);
        this.saveToMemory(msg);
        await this.appendFallback(msg);
      } else {
        console.warn('[MsgStorage] Post-commit cache/Redis error (data saved):', e);
      }
    } finally {
      await runner.release();
    }
  }

  async saveMsgsBulk (msgs: any[]) {
    if (!this.isEnabled) {
      msgs.forEach(m => this.saveToMemory(m));
      await Promise.all(msgs.map(m => this.appendFallback(m)));
      return;
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    let committed = false;
    try {
      const msgDataList: MsgData[] = [];
      const blobList: MsgBlob[] = [];

      for (const msg of msgs) {
        const m = new MsgData();
        m.msg_id = msg.msgId;
        m.msg_seq = msg.msgSeq;
        m.msg_random = msg.msgRandom;
        m.msg_time = msg.msgTime;
        m.sender_id = msg.senderUid;
        m.sender_uin = msg.senderUin;
        m.peer_id = msg.peerUid;
        m.peer_uin = msg.peerUin;
        m.chat_type = msg.chatType;
        m.content = this.extractContent(msg.elements);
        msgDataList.push(m);

        const b = new MsgBlob();
        b.msg_id = msg.msgId;
        b.raw_elements = compressToBuffer(msg.elements);
        blobList.push(b);
      }

      // 事务批量保存
      await runner.manager.save(MsgData, msgDataList);
      await runner.manager.save(MsgBlob, blobList);
      await runner.commitTransaction();
      committed = true;

      // 批量更新轻量缓存（包含 id 和 created_at）
      for (const m of msgDataList) {
        const light: MsgDataLight = {
          id: m.id,
          msg_id: m.msg_id,
          msg_seq: m.msg_seq,
          msg_random: m.msg_random,
          msg_time: m.msg_time,
          sender_id: m.sender_id,
          sender_uin: m.sender_uin,
          peer_id: m.peer_id,
          peer_uin: m.peer_uin,
          chat_type: m.chat_type,
          content: m.content,
          created_at: m.created_at,
        };
        this.cache.put(m.msg_id, light);
      }
    } catch (e) {
      // 仅在未提交时回滚
      if (!committed && runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      if (!committed) {
        console.error('[MsgStorage] Bulk save failed, fallback to memory', e);
        msgs.forEach(m => this.saveToMemory(m));
        await Promise.all(msgs.map(m => this.appendFallback(m)));
      } else {
        console.warn('[MsgStorage] Post-commit cache error (data saved):', e);
      }
    } finally {
      await runner.release();
    }
  }

  private saveToMemory (msg: any) {
    this.memoryStore.push(msg);
    if (this.memoryStore.length > 1000) {
      this.memoryStore.shift();
    }
  }

  async queryMsg (params: MsgQueryParams) {
    const page = params.page || 1;
    const pageSize = params.pageSize || 50;
    if (!this.isEnabled) return { list: [], total: 0, page, pageSize };

    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (params.startTime && params.endTime) {
      where.msg_time = Between(params.startTime.toString(), params.endTime.toString());
    }

    if (params.senderId) {
      where.sender_id = params.senderId;
    }

    if (params.groupId) {
      where.peer_id = params.groupId;
      where.chat_type = 2;
    }

    let list: MsgData[] = [];
    let total = 0;
    const t0 = Date.now();
    if (params.keyword) {
      try {
        const qb = this.msgRepo.createQueryBuilder('m').where(where);
        const dbType = this.dataSource.options.type as string;
        if (dbType === 'mysql') {
          await this.dataSource.query('SET SESSION innodb_ft_user_stopword_table=DEFAULT');
          qb.andWhere('MATCH(m.content) AGAINST (:kw IN BOOLEAN MODE)', { kw: params.keyword + '*' });
        } else if (dbType === 'postgres' || dbType === 'postgresql') {
          qb.andWhere("to_tsvector('simple', m.content) @@ plainto_tsquery('simple', :kw)", { kw: params.keyword });
        } else if (dbType === 'sqljs' || dbType === 'better-sqlite3' || dbType === 'sqlite') {
          // 使用 FTS5 全文搜索
          qb.andWhere('m.id IN (SELECT rowid FROM msg_data_fts WHERE msg_data_fts MATCH :kw)', { kw: params.keyword });
        } else {
          qb.andWhere('m.content LIKE :kw', { kw: `%${params.keyword}%` });
        }
        qb.orderBy('m.msg_time', 'DESC').skip(skip).take(pageSize);
        [list, total] = await qb.getManyAndCount();
      } catch {
        // FTS5 失败时降级到 LIKE 查询
        const res = await this.msgRepo.findAndCount({
          where: { ...where, content: Like(`%${params.keyword}%`) },
          order: { msg_time: 'DESC' },
          skip,
          take: pageSize,
        });
        list = res[0]; total = res[1];
      }
    } else {
      const res = await this.msgRepo.findAndCount({
        where,
        order: { msg_time: 'DESC' },
        skip,
        take: pageSize,
      });
      list = res[0]; total = res[1];
    }
    const t1 = Date.now();
    if ((t1 - t0) > this.slowThresholdMs) {
      console.warn(`[MsgStorage] Slow query ${t1 - t0}ms params=${JSON.stringify(params)}`);
    }

    return { list, total, page, pageSize };
  }

  private resolveSqlJsDbFile (): string {
    const override = process.env['NAPCAT_DB_PATH'];
    if (override) return override;
    const base = process.env['NAPCAT_WORKDIR'] || process.cwd();
    const dir = path.join(base, 'config', 'db');
    return path.join(dir, 'napcat_sqlite.sqljs');
  }

  private canUseSqljs (): boolean {
    const envPath = process.env['NAPCAT_SQLJS_WASM_PATH'];
    if (envPath) {
      try { require('fs').accessSync(envPath); return true; } catch { return false; }
    }
    const wasmDefault = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    try { require('fs').accessSync(wasmDefault); return true; } catch { return false; }
  }

  private extractContent (elements: any[]): string {
    if (!elements || !Array.isArray(elements)) return '';
    return elements.map(e => {
      if (e.textElement) return e.textElement.content;
      if (e.faceElement) return `[Face:${e.faceElement.faceIndex}]`;
      if (e.picElement) return '[Image]';
      if (e.pttElement) return '[Voice]';
      if (e.videoElement) return '[Video]';
      if (e.fileElement) return `[File:${e.fileElement.fileName}]`;
      if (e.marketFaceElement) return '[MarketFace]';
      if (e.replyElement) return '[Reply]';
      return '';
    }).join('');
  }

  private async updateUserInfo (msg: any) {
    try {
      const user = new UserInfo();
      user.user_id = msg.senderUid;
      user.uin = msg.senderUin;
      user.username = msg.sendNickName || '';
      user.last_updated = new Date();
      await this.userRepo.save(user);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // Ignore duplicate/error
    }
  }

  private async updateGroupInfo (msg: any) {
    try {
      const group = new GroupInfo();
      group.group_id = msg.peerUid; // peerUid is groupCode in group chat
      group.group_name = msg.peerName || '';
      group.last_updated = new Date();
      await this.groupRepo.save(group);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // Ignore
    }
  }

  /**
   * 按需加载指定消息的 raw_elements
   * @param msgId 业务主键 msg_id
   * @returns 解压后的原始消息元素，失败返回 null
   */
  async loadRawElements (msgId: string): Promise<any | null> {
    if (!this.isEnabled) return null;

    try {
      const blob = await this.blobRepo.findOne({ where: { msg_id: msgId } });
      if (!blob) return null;
      return safeDecompress(blob.raw_elements);
    } catch (err) {
      console.warn('[MsgStorage] Load raw_elements failed:', err);
      return null;
    }
  }

  /**
   * 批量加载多个消息的 raw_elements
   * @param msgIds 消息ID列表
   * @returns Map<msg_id, raw_elements>
   */
  async loadRawElementsBatch (msgIds: string[]): Promise<Map<string, any>> {
    const result = new Map<string, any>();
    if (!this.isEnabled || msgIds.length === 0) return result;

    try {
      const blobs = await this.blobRepo
        .createQueryBuilder('b')
        .where('b.msg_id IN (:...ids)', { ids: msgIds })
        .getMany();

      for (const blob of blobs) {
        const raw = safeDecompress(blob.raw_elements);
        // safeDecompress 返回 null 表示解压失败，其他值（包括空数组/对象）都是有效数据
        if (raw !== null) {
          result.set(blob.msg_id, raw);
        }
      }
    } catch (err) {
      console.warn('[MsgStorage] Batch load raw_elements failed:', err);
    }

    return result;
  }

  /**
   * 将轻量消息补全为完整数据（包含 raw_elements）
   * @param light 轻量消息对象
   * @returns 完整消息对象
   */
  async hydrateMsg (light: MsgDataLight): Promise<MsgDataFull> {
    const raw = await this.loadRawElements(light.msg_id);
    return { ...light, raw_elements: raw };
  }

  /**
   * 批量补全消息为完整数据
   * @param lights 轻量消息列表
   * @returns 完整消息列表
   */
  async hydrateMsgs (lights: MsgDataLight[]): Promise<MsgDataFull[]> {
    const msgIds = lights.map(l => l.msg_id);
    const rawMap = await this.loadRawElementsBatch(msgIds);

    return lights.map(light => ({
      ...light,
      raw_elements: rawMap.get(light.msg_id) ?? null,
    }));
  }

  /**
   * 根据消息ID获取单条完整消息
   * @param msgId 消息ID
   * @returns 完整消息对象，不存在返回 null
   */
  async getMsgById (msgId: string): Promise<MsgDataFull | null> {
    // 先检查缓存
    const cached = this.cache.get(msgId);
    if (cached) {
      return this.hydrateMsg(cached);
    }

    if (!this.isEnabled) return null;

    try {
      const msg = await this.msgRepo.findOne({ where: { msg_id: msgId } });
      if (!msg) return null;

      const light: MsgDataLight = {
        id: msg.id,
        msg_id: msg.msg_id,
        msg_seq: msg.msg_seq,
        msg_random: msg.msg_random,
        msg_time: msg.msg_time,
        sender_id: msg.sender_id,
        sender_uin: msg.sender_uin,
        peer_id: msg.peer_id,
        peer_uin: msg.peer_uin,
        chat_type: msg.chat_type,
        content: msg.content,
        created_at: msg.created_at,
      };

      // 加入缓存
      this.cache.put(msgId, light);

      return this.hydrateMsg(light);
    } catch (err) {
      console.warn('[MsgStorage] getMsgById failed:', err);
      return null;
    }
  }
}
