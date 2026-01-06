import { DataSource, Repository, Between, Like } from "typeorm";
import { MsgData, UserInfo, GroupInfo, DbVersion } from "../entities";
import Redis from "ioredis";

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

    async init(config: DbConfig) {
        if (!config.enable) {
            console.log("[MsgStorage] Disabled in config");
            return;
        }

        try {
            this.dataSource = new DataSource({
                type: config.type as any,
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

            await this.dataSource.initialize();
            console.log("[MsgStorage] Database connected");

            this.msgRepo = this.dataSource.getRepository(MsgData);
            this.userRepo = this.dataSource.getRepository(UserInfo);
            this.groupRepo = this.dataSource.getRepository(GroupInfo);

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
        }
    }

    async saveMsg(msg: any) {
        if (!this.isEnabled) {
            this.saveToMemory(msg);
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
        }
    }

    private saveToMemory(msg: any) {
        this.memoryStore.push(msg);
        if (this.memoryStore.length > 1000) {
            this.memoryStore.shift();
        }
    }

    async queryMsg(params: MsgQueryParams) {
        if (!this.isEnabled) return { list: [], total: 0 };

        const page = params.page || 1;
        const pageSize = params.pageSize || 50;
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

        if (params.keyword) {
            where.content = Like(`%${params.keyword}%`);
        }

        const [list, total] = await this.msgRepo.findAndCount({
            where,
            order: { msg_time: "DESC" },
            skip,
            take: pageSize
        });

        return { list, total, page, pageSize };
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
