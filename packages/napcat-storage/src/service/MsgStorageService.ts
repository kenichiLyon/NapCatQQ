import { DataSource, Repository, Between, Like } from "typeorm";
import { MsgData, UserInfo, GroupInfo, DbVersion } from "../entities";
import Redis from "ioredis";
import fs from "node:fs/promises";
import path from "node:path";

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
    private userRepo!: Repository<UserInfo>;
    private groupRepo!: Repository<GroupInfo>;
    private isEnabled: boolean = false;
    private memoryStore: any[] = [];
    private slowThresholdMs = 200;
    private fallbackFilePath: string | null = null;

    async init(config: DbConfig) {
        this.fallbackFilePath = this.resolveFallbackPath();
        if (!config.enable) {
            console.log("[MsgStorage] Disabled in config");
            await this.ensureFallbackFile();
            return;
        }

        try {
            const type = (config.type as any);
            if (type === 'sqljs') {
                const dbFile = this.resolveSqlJsDbFile();
                let database: Uint8Array | undefined = undefined;
                try {
                    const buf = await fs.readFile(dbFile);
                    database = new Uint8Array(buf);
                } catch {}
                this.dataSource = new DataSource({
                    type: 'sqljs',
                    entities: [MsgData, UserInfo, GroupInfo, DbVersion],
                    synchronize: true,
                    logging: false,
                    location: 'napcat_sqljs',
                    autoSave: true,
                    autoSaveCallback: async (db: Uint8Array) => {
                        await fs.mkdir(path.dirname(dbFile), { recursive: true });
                        await fs.writeFile(dbFile, Buffer.from(db));
                    },
                    database
                } as any);
            } else {
                this.dataSource = new DataSource({
                    type,
                    host: config.host,
                    port: config.port,
                    username: config.username,
                    password: config.password,
                    database: config.database,
                    entities: [MsgData, UserInfo, GroupInfo, DbVersion],
                    synchronize: true, // Auto schema sync for now
                    logging: false,
                    poolSize: 10, // Equivalent to HikariCP pooling
                    extra: {
                        connectionLimit: 10 // For mysql2
                    }
                });
            }

            await this.dataSource.initialize();
            console.log("[MsgStorage] Database connected");

            this.msgRepo = this.dataSource.getRepository(MsgData);
            this.userRepo = this.dataSource.getRepository(UserInfo);
            this.groupRepo = this.dataSource.getRepository(GroupInfo);

            await this.ensureIndexes(config.type);

            this.redis = new Redis({
                host: config.redisHost,
                port: config.redisPort,
                password: config.redisPassword,
                lazyConnect: true
            });
            await this.redis.connect();
            console.log("[MsgStorage] Redis connected");
            
            this.isEnabled = true;
        } catch (error) {
            console.error("[MsgStorage] Init failed", error);
            await this.ensureFallbackFile();
        }
    }

    private resolveFallbackPath(): string {
        const base = process.env['NAPCAT_WORKDIR'] || process.cwd();
        const dir = path.join(base, 'storage');
        return path.join(dir, 'msg_fallback.jsonl');
    }

    private async ensureFallbackFile() {
        if (!this.fallbackFilePath) return;
        const dir = path.dirname(this.fallbackFilePath);
        await fs.mkdir(dir, { recursive: true });
        try {
            await fs.access(this.fallbackFilePath);
        } catch {
            await fs.writeFile(this.fallbackFilePath, "");
        }
    }

    private async appendFallback(msg: any) {
        if (!this.fallbackFilePath) return;
        const line = JSON.stringify(msg) + "\n";
        try {
            await fs.appendFile(this.fallbackFilePath, line, "utf-8");
        } catch {}
    }

    private async ensureIndexes(dbType: string) {
        try {
            if (dbType === 'mysql') {
                await this.dataSource.query("ALTER TABLE msg_data ADD INDEX idx_msg_time (msg_time)");
                await this.dataSource.query("ALTER TABLE msg_data ADD FULLTEXT INDEX ft_content (content)");
            } else if (dbType === 'postgres' || dbType === 'postgresql') {
                await this.dataSource.query("CREATE INDEX IF NOT EXISTS idx_msg_time ON msg_data (msg_time)");
                await this.dataSource.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
                await this.dataSource.query("CREATE INDEX IF NOT EXISTS idx_content_fts ON msg_data USING GIN (to_tsvector('simple', content))");
            } else if (dbType === 'sqljs') {
                await this.dataSource.query("CREATE INDEX IF NOT EXISTS idx_msg_time ON msg_data (msg_time)");
            }
        } catch {}
    }

    async saveMsg(msg: any) {
        if (!this.isEnabled) {
            this.saveToMemory(msg);
            await this.appendFallback(msg);
            return;
        }
        
        try {
            const content = this.extractContent(msg.elements);
            
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
            msgData.raw_elements = msg.elements;

            await this.msgRepo.save(msgData);

            // Cache in Redis (expire in 1 hour)
            if (this.redis.status === 'ready') {
                await this.redis.setex(`msg:${msg.msgId}`, 3600, JSON.stringify(msgData));
            }

            // Async update user/group info
            this.updateUserInfo(msg);
            if (msg.chatType === 2) { // Group
                this.updateGroupInfo(msg);
            }
        } catch (e) {
            console.error("[MsgStorage] Save msg failed, fallback to memory", e);
            this.saveToMemory(msg);
            await this.appendFallback(msg);
        }
    }

    async saveMsgsBulk(msgs: any[]) {
        if (!this.isEnabled) {
            msgs.forEach(m => this.saveToMemory(m));
            await Promise.all(msgs.map(m => this.appendFallback(m)));
            return;
        }
        const runner = this.dataSource.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
            const contentMsgs = msgs.map(msg => {
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
                m.raw_elements = msg.elements;
                return m;
            });
            await runner.manager.save(MsgData, contentMsgs);
            await runner.commitTransaction();
        } catch (e) {
            await runner.rollbackTransaction();
            msgs.forEach(m => this.saveToMemory(m));
            await Promise.all(msgs.map(m => this.appendFallback(m)));
        } finally {
            await runner.release();
        }
    }

    private saveToMemory(msg: any) {
        this.memoryStore.push(msg);
        if (this.memoryStore.length > 1000) {
            this.memoryStore.shift();
        }
    }

    async queryMsg(params: MsgQueryParams) {
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
                const dbType = (this.dataSource.options.type as string);
                if (dbType === 'mysql') {
                    await this.dataSource.query("SET SESSION innodb_ft_user_stopword_table=DEFAULT");
                    qb.andWhere("MATCH(m.content) AGAINST (:kw IN BOOLEAN MODE)", { kw: params.keyword + '*' });
                } else if (dbType === 'postgres' || dbType === 'postgresql') {
                    qb.andWhere("to_tsvector('simple', m.content) @@ plainto_tsquery('simple', :kw)", { kw: params.keyword });
                } else {
                    qb.andWhere("m.content LIKE :kw", { kw: `%${params.keyword}%` });
                }
                qb.orderBy('m.msg_time', 'DESC').skip(skip).take(pageSize);
                [list, total] = await qb.getManyAndCount();
            } catch {
                const res = await this.msgRepo.findAndCount({
                    where: { ...where, content: Like(`%${params.keyword}%`) },
                    order: { msg_time: "DESC" },
                    skip,
                    take: pageSize
                });
                list = res[0]; total = res[1];
            }
        } else {
            const res = await this.msgRepo.findAndCount({
                where,
                order: { msg_time: "DESC" },
                skip,
                take: pageSize
            });
            list = res[0]; total = res[1];
        }
        const t1 = Date.now();
        if ((t1 - t0) > this.slowThresholdMs) {
            console.warn(`[MsgStorage] Slow query ${t1 - t0}ms params=${JSON.stringify(params)}`);
        }

        return { list, total, page, pageSize };
    }

    private resolveSqlJsDbFile(): string {
        const base = process.env['NAPCAT_WORKDIR'] || process.cwd();
        const dir = path.join(base, 'storage');
        return path.join(dir, 'napcat_sqlite.sqljs');
    }

    private extractContent(elements: any[]): string {
        if (!elements || !Array.isArray(elements)) return "";
        return elements.map(e => {
            if (e.textElement) return e.textElement.content;
            if (e.faceElement) return `[Face:${e.faceElement.faceIndex}]`;
            if (e.picElement) return `[Image]`;
            if (e.pttElement) return `[Voice]`;
            if (e.videoElement) return `[Video]`;
            if (e.fileElement) return `[File:${e.fileElement.fileName}]`;
            if (e.marketFaceElement) return `[MarketFace]`;
            if (e.replyElement) return `[Reply]`;
            return "";
        }).join("");
    }

    private async updateUserInfo(msg: any) {
        try {
            const user = new UserInfo();
            user.user_id = msg.senderUid;
            user.uin = msg.senderUin;
            user.username = msg.sendNickName || "";
            user.last_updated = new Date();
            await this.userRepo.save(user);
        } catch (e) {
            // Ignore duplicate/error
        }
    }

    private async updateGroupInfo(msg: any) {
        try {
            const group = new GroupInfo();
            group.group_id = msg.peerUid; // peerUid is groupCode in group chat
            group.group_name = msg.peerName || "";
            group.last_updated = new Date();
            await this.groupRepo.save(group);
        } catch (e) {
            // Ignore
        }
    }
}
